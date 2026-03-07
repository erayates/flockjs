import type { Peer, PresenceData } from '../types';

const DEFAULT_DISCONNECT_GRACE_MS = 5_000;

export interface PeerRegistryTimerHandle {
  cancel(): void;
}

export interface PeerRegistryClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): PeerRegistryTimerHandle;
  clearTimeout(timer: PeerRegistryTimerHandle): void;
}

export interface RemotePeerEntry<TPresence extends PresenceData = PresenceData> {
  peer: Peer<TPresence>;
  removalToken: number | null;
  removalTimer: PeerRegistryTimerHandle | null;
  removalDeadline: number | null;
}

interface PeerRegistryCallbacks<TPresence extends PresenceData> {
  onPeerJoin?(peer: Peer<TPresence>): void;
  onPeerUpdate?(peer: Peer<TPresence>): void;
  onPeerLeave?(peer: Peer<TPresence>): void;
  onSnapshotChange?(): void;
}

interface PeerRegistryOptions<
  TPresence extends PresenceData,
> extends PeerRegistryCallbacks<TPresence> {
  disconnectGraceMs?: number;
  clock?: PeerRegistryClock;
}

function createDefaultClock(): PeerRegistryClock {
  return {
    now() {
      return Date.now();
    },
    setTimeout(callback, delayMs) {
      const timeout = globalThis.setTimeout(callback, delayMs);
      return {
        cancel() {
          globalThis.clearTimeout(timeout);
        },
      };
    },
    clearTimeout(timer) {
      timer.cancel();
    },
  };
}

function hasMeaningfulPeerChange<TPresence extends PresenceData>(
  previous: Peer<TPresence>,
  next: Peer<TPresence>,
): boolean {
  const keys = new Set<string>([...Object.keys(previous), ...Object.keys(next)]);
  keys.delete('lastSeen');

  for (const key of keys) {
    if (Reflect.get(previous, key) !== Reflect.get(next, key)) {
      return true;
    }
  }

  return false;
}

export class PeerRegistry<TPresence extends PresenceData = PresenceData> {
  private selfPeer: Peer<TPresence>;

  private readonly remotePeers = new Map<string, RemotePeerEntry<TPresence>>();

  private readonly disconnectGraceMs: number;

  private readonly clock: PeerRegistryClock;

  private nextRemovalToken = 1;

  private readonly callbacks: PeerRegistryCallbacks<TPresence> = {};

  public constructor(selfPeer: Peer<TPresence>, options: PeerRegistryOptions<TPresence> = {}) {
    this.selfPeer = selfPeer;
    this.disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.clock = options.clock ?? createDefaultClock();

    if (typeof options.onPeerJoin === 'function') {
      this.callbacks.onPeerJoin = (peer) => {
        options.onPeerJoin?.(peer);
      };
    }

    if (typeof options.onPeerUpdate === 'function') {
      this.callbacks.onPeerUpdate = (peer) => {
        options.onPeerUpdate?.(peer);
      };
    }

    if (typeof options.onPeerLeave === 'function') {
      this.callbacks.onPeerLeave = (peer) => {
        options.onPeerLeave?.(peer);
      };
    }

    if (typeof options.onSnapshotChange === 'function') {
      this.callbacks.onSnapshotChange = () => {
        options.onSnapshotChange?.();
      };
    }
  }

  public getSelf(): Peer<TPresence> {
    return this.selfPeer;
  }

  public setSelf(next: Peer<TPresence>): void {
    this.selfPeer = next;
    this.callbacks.onSnapshotChange?.();
  }

  public get(peerId: string): Peer<TPresence> | null {
    if (peerId === this.selfPeer.id) {
      return this.selfPeer;
    }

    return this.remotePeers.get(peerId)?.peer ?? null;
  }

  public getAll(): Peer<TPresence>[] {
    return [this.selfPeer, ...this.getRemotes()];
  }

  public getRemotes(): Peer<TPresence>[] {
    return Array.from(this.remotePeers.values(), (entry) => {
      return entry.peer;
    });
  }

  public getRemoteCount(): number {
    return this.remotePeers.size;
  }

  public upsertRemote(peer: Peer<TPresence>): void {
    if (peer.id === this.selfPeer.id) {
      return;
    }

    const existing = this.remotePeers.get(peer.id);
    const normalized: Peer<TPresence> = {
      ...peer,
      id: peer.id,
      joinedAt: existing?.peer.joinedAt ?? peer.joinedAt,
      lastSeen: this.clock.now(),
    };

    if (!existing) {
      this.remotePeers.set(peer.id, {
        peer: normalized,
        removalToken: null,
        removalTimer: null,
        removalDeadline: null,
      });
      this.callbacks.onPeerJoin?.(normalized);
      this.callbacks.onSnapshotChange?.();
      return;
    }

    const lastSeenChanged = existing.peer.lastSeen !== normalized.lastSeen;
    this.cancelRemoval(existing);
    const changed = hasMeaningfulPeerChange(existing.peer, normalized);
    existing.peer = normalized;

    if (!changed) {
      if (lastSeenChanged) {
        this.callbacks.onSnapshotChange?.();
      }

      return;
    }

    this.callbacks.onPeerUpdate?.(normalized);
    this.callbacks.onSnapshotChange?.();
  }

  public removeRemoteImmediately(peerId: string): void {
    const entry = this.remotePeers.get(peerId);
    if (!entry) {
      return;
    }

    this.cancelRemoval(entry);
    this.remotePeers.delete(peerId);
    this.callbacks.onPeerLeave?.(entry.peer);
    this.callbacks.onSnapshotChange?.();
  }

  public markRemoteDisconnected(peerId: string): void {
    const entry = this.remotePeers.get(peerId);
    if (!entry || entry.removalTimer !== null) {
      return;
    }

    const removalToken = this.nextRemovalToken++;
    entry.removalToken = removalToken;
    entry.removalDeadline = this.clock.now() + this.disconnectGraceMs;
    entry.removalTimer = this.clock.setTimeout(() => {
      this.finalizeScheduledRemoval(peerId, removalToken);
    }, this.disconnectGraceMs);
  }

  public markAllRemotesDisconnected(): void {
    for (const peerId of this.remotePeers.keys()) {
      this.markRemoteDisconnected(peerId);
    }
  }

  public clearRemotePeers(options: { emitLeaveEvents: boolean }): void {
    if (this.remotePeers.size === 0) {
      return;
    }

    if (options.emitLeaveEvents) {
      for (const peerId of Array.from(this.remotePeers.keys())) {
        this.removeRemoteImmediately(peerId);
      }

      return;
    }

    for (const entry of this.remotePeers.values()) {
      this.cancelRemoval(entry);
    }

    this.remotePeers.clear();
    this.callbacks.onSnapshotChange?.();
  }

  public dispose(): void {
    for (const entry of this.remotePeers.values()) {
      this.cancelRemoval(entry);
    }

    this.remotePeers.clear();
  }

  private finalizeScheduledRemoval(peerId: string, removalToken: number): void {
    const entry = this.remotePeers.get(peerId);
    if (!entry || entry.removalToken !== removalToken) {
      return;
    }

    this.clearRemoval(entry);
    this.remotePeers.delete(peerId);
    this.callbacks.onPeerLeave?.(entry.peer);
    this.callbacks.onSnapshotChange?.();
  }

  private cancelRemoval(entry: RemotePeerEntry<TPresence>): void {
    if (entry.removalTimer !== null) {
      this.clock.clearTimeout(entry.removalTimer);
    }

    this.clearRemoval(entry);
  }

  private clearRemoval(entry: RemotePeerEntry<TPresence>): void {
    entry.removalToken = null;
    entry.removalTimer = null;
    entry.removalDeadline = null;
  }
}
