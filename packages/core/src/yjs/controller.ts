import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';

import { TypedEventEmitter } from '../event-emitter';
import type { CrdtAwarenessWirePayload, CrdtSyncWirePayload } from '../protocol/peer-message';
import type {
  AwarenessState,
  FlockYjsProvider,
  FlockYjsProviderEventHandler,
  FlockYjsProviderEventMap,
  FlockYjsProviderEventName,
  FlockYjsProviderStatus,
  Peer,
  PresenceData,
} from '../types';
import {
  LocalCrdtTransactionOrigin,
  REMOTE_AWARENESS_ORIGIN,
  RemoteCrdtTransactionOrigin,
} from './origin';

interface AwarenessUpdateChange {
  added: number[];
  updated: number[];
  removed: number[];
}

interface OutboundCrdtSyncSignal {
  type: 'crdt:sync';
  toPeerId?: string;
  payload: CrdtSyncWirePayload;
}

interface OutboundCrdtAwarenessSignal {
  type: 'crdt:awareness';
  toPeerId?: string;
  payload: CrdtAwarenessWirePayload;
}

type OutboundCrdtSignal = OutboundCrdtSyncSignal | OutboundCrdtAwarenessSignal;

export interface RoomYjsControllerContext<TPresence extends PresenceData = PresenceData> {
  peerId: string;
  connectRoom(): Promise<void>;
  disconnectRoom(): Promise<void>;
  getSelfPeer(): Peer<TPresence>;
  sendSignal(signal: OutboundCrdtSignal): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mergePeerIdentity(
  peer: Peer<PresenceData>,
  current: Record<string, unknown> | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(current ?? {}),
    peerId: peer.id,
  };

  if (peer.name !== undefined) {
    next.name = peer.name;
  }

  if (peer.color !== undefined) {
    next.color = peer.color;
  }

  if (peer.avatar !== undefined) {
    next.avatar = peer.avatar;
  }

  const currentUser = isRecord(next.user) ? { ...next.user } : {};
  currentUser.id = peer.id;

  if (peer.name !== undefined) {
    currentUser.name = peer.name;
  }

  if (peer.color !== undefined) {
    currentUser.color = peer.color;
  }

  if (peer.avatar !== undefined) {
    currentUser.avatar = peer.avatar;
  }

  next.user = currentUser;
  return next;
}

function toBinaryPayload(value: Uint8Array | number[]): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value);
}

function readAwarenessState(value: unknown, fallbackPeerId?: string): AwarenessState | null {
  if (!isRecord(value)) {
    return null;
  }

  const peerId =
    typeof value.peerId === 'string' && value.peerId.length > 0 ? value.peerId : fallbackPeerId;
  if (!peerId) {
    return null;
  }

  return {
    ...value,
    peerId,
  };
}

export class RoomYjsController<
  TPresence extends PresenceData = PresenceData,
> implements FlockYjsProvider {
  public readonly doc = new Y.Doc();

  public readonly awareness = new Awareness(this.doc);

  private readonly providerEvents = new TypedEventEmitter<FlockYjsProviderEventMap>();

  private readonly pendingSyncPeers = new Set<string>();

  private connectionStatus: FlockYjsProviderStatus = 'disconnected';

  private syncedState = false;

  private localAwarenessState: Record<string, unknown> | null;

  private restoreLocalAwarenessAfterDisconnect = false;

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin instanceof RemoteCrdtTransactionOrigin) {
      return;
    }

    if (this.connectionStatus !== 'connected') {
      return;
    }

    this.context.sendSignal({
      type: 'crdt:sync',
      payload:
        origin instanceof LocalCrdtTransactionOrigin
          ? {
              kind: 'update',
              data: update,
              meta: origin.meta,
            }
          : {
              kind: 'update',
              data: update,
            },
    });
  };

  private readonly handleAwarenessUpdate = (
    change: AwarenessUpdateChange,
    origin: unknown,
  ): void => {
    if (origin === REMOTE_AWARENESS_ORIGIN) {
      return;
    }

    if (this.connectionStatus !== 'connected') {
      return;
    }

    const clientIds = [...change.added, ...change.updated, ...change.removed];
    if (clientIds.length === 0) {
      return;
    }

    this.context.sendSignal({
      type: 'crdt:awareness',
      payload: {
        data: encodeAwarenessUpdate(this.awareness, clientIds),
      },
    });
  };

  public constructor(
    private readonly context: RoomYjsControllerContext<TPresence>,
  ) {
    this.localAwarenessState = mergePeerIdentity(this.context.getSelfPeer(), null);

    this.doc.on('update', this.handleDocumentUpdate);
    this.awareness.on('update', this.handleAwarenessUpdate);
    this.awareness.setLocalState(this.localAwarenessState);
  }

  public get synced(): boolean {
    return this.syncedState;
  }

  public get status(): FlockYjsProviderStatus {
    return this.connectionStatus;
  }

  public connect(): Promise<void> {
    return this.context.connectRoom();
  }

  public disconnect(): Promise<void> {
    return this.context.disconnectRoom();
  }

  public async destroy(): Promise<void> {
    this.providerEvents.clear();
    await this.disconnect();
  }

  public on<TEvent extends FlockYjsProviderEventName>(
    event: TEvent,
    cb: FlockYjsProviderEventHandler<TEvent>,
  ): () => void {
    return this.providerEvents.on(event, cb);
  }

  public off<TEvent extends FlockYjsProviderEventName>(
    event: TEvent,
    cb: FlockYjsProviderEventHandler<TEvent>,
  ): void {
    this.providerEvents.off(event, cb);
  }

  public handleRoomConnected(): void {
    this.restoreLocalAwarenessAfterDisconnect = false;
    this.restoreLocalAwarenessState();
    this.setStatus('connected');
    this.updateSyncedState(this.pendingSyncPeers.size === 0);
  }

  public prepareForDisconnect(): void {
    const localState = this.awareness.getLocalState();
    if (!localState) {
      return;
    }

    this.localAwarenessState = mergePeerIdentity(this.context.getSelfPeer(), localState);
    this.restoreLocalAwarenessAfterDisconnect = true;
    this.awareness.setLocalState(null);
  }

  public handleRoomDisconnected(): void {
    this.pendingSyncPeers.clear();
    this.removeRemoteAwarenessStates();
    this.setStatus('disconnected');
    this.updateSyncedState(false);

    if (this.restoreLocalAwarenessAfterDisconnect) {
      this.restoreLocalAwarenessState();
      this.restoreLocalAwarenessAfterDisconnect = false;
    }
  }

  public syncPeer(peerId: string): void {
    if (this.connectionStatus !== 'connected') {
      return;
    }

    this.pendingSyncPeers.add(peerId);
    this.updateSyncedState(false);
    this.context.sendSignal({
      type: 'crdt:sync',
      toPeerId: peerId,
      payload: {
        kind: 'state-vector',
        data: Y.encodeStateVector(this.doc),
      },
    });

    const localState = this.awareness.getLocalState();
    if (!localState) {
      return;
    }

    this.context.sendSignal({
      type: 'crdt:awareness',
      toPeerId: peerId,
      payload: {
        data: encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
      },
    });
  }

  public handleSyncSignal(
    fromPeerId: string,
    payload: CrdtSyncWirePayload,
    timestamp: number,
  ): void {
    if (payload.kind === 'state-vector') {
      this.context.sendSignal({
        type: 'crdt:sync',
        toPeerId: fromPeerId,
        payload: {
          kind: 'update',
          data: Y.encodeStateAsUpdate(this.doc, toBinaryPayload(payload.data)),
        },
      });
      return;
    }

    Y.applyUpdate(
      this.doc,
      toBinaryPayload(payload.data),
      new RemoteCrdtTransactionOrigin(fromPeerId, timestamp, payload.meta),
    );
    this.pendingSyncPeers.delete(fromPeerId);
    this.updateSyncedState(
      this.connectionStatus === 'connected' && this.pendingSyncPeers.size === 0,
    );
  }

  public handleAwarenessSignal(payload: CrdtAwarenessWirePayload): void {
    applyAwarenessUpdate(this.awareness, toBinaryPayload(payload.data), REMOTE_AWARENESS_ORIGIN);
  }

  public handlePeerLeft(peerId: string): void {
    this.pendingSyncPeers.delete(peerId);
    const clientIds = this.findClientIdsForPeer(peerId);
    if (clientIds.length > 0) {
      removeAwarenessStates(this.awareness, clientIds, REMOTE_AWARENESS_ORIGIN);
    }

    this.updateSyncedState(
      this.connectionStatus === 'connected' && this.pendingSyncPeers.size === 0,
    );
  }

  public updateLocalAwareness(patch: Record<string, unknown>): void {
    this.localAwarenessState = {
      ...mergePeerIdentity(this.context.getSelfPeer(), this.localAwarenessState),
      ...patch,
      peerId: this.context.peerId,
    };
    this.awareness.setLocalState(this.localAwarenessState);
  }

  public syncSelfPeer(): void {
    this.localAwarenessState = mergePeerIdentity(
      this.context.getSelfPeer(),
      this.localAwarenessState,
    );

    if (!this.restoreLocalAwarenessAfterDisconnect || this.connectionStatus === 'connected') {
      this.awareness.setLocalState(this.localAwarenessState);
    }
  }

  public getAllAwareness(): AwarenessState[] {
    const states: AwarenessState[] = [];

    for (const [clientId, value] of this.awareness.getStates()) {
      const fallbackPeerId = clientId === this.awareness.clientID ? this.context.peerId : undefined;
      const awarenessState = readAwarenessState(value, fallbackPeerId);
      if (awarenessState) {
        states.push(awarenessState);
      }
    }

    return states;
  }

  public getRemoteAwareness(): AwarenessState[] {
    return this.getAllAwareness().filter((state) => {
      return state.peerId !== this.context.peerId;
    });
  }

  private restoreLocalAwarenessState(): void {
    this.localAwarenessState = mergePeerIdentity(
      this.context.getSelfPeer(),
      this.localAwarenessState,
    );
    this.awareness.setLocalState(this.localAwarenessState);
  }

  private removeRemoteAwarenessStates(): void {
    const remoteClientIds = Array.from(this.awareness.getStates().keys()).filter((clientId) => {
      return clientId !== this.awareness.clientID;
    });
    if (remoteClientIds.length === 0) {
      return;
    }

    removeAwarenessStates(this.awareness, remoteClientIds, REMOTE_AWARENESS_ORIGIN);
  }

  private findClientIdsForPeer(peerId: string): number[] {
    const clientIds: number[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) {
        continue;
      }

      if (isRecord(state) && state.peerId === peerId) {
        clientIds.push(clientId);
      }
    }

    return clientIds;
  }

  private setStatus(status: FlockYjsProviderStatus): void {
    if (this.connectionStatus === status) {
      return;
    }

    this.connectionStatus = status;
    this.providerEvents.emit('status', { status });
  }

  private updateSyncedState(synced: boolean): void {
    if (this.syncedState === synced) {
      return;
    }

    this.syncedState = synced;
    this.providerEvents.emit('sync', { synced });
  }
}
