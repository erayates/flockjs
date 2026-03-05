import { createAwarenessEngine } from './engines/awareness';
import { createCursorEngine } from './engines/cursors';
import { createEventEngine } from './engines/events';
import { createPresenceEngine } from './engines/presence';
import { createStateEngine } from './engines/state';
import { TypedEventEmitter } from './event-emitter';
import { createFlockError } from './flock-error';
import { selectTransportAdapter } from './transports/select-transport';
import type { TransportAdapter, TransportSignal } from './transports/transport';
import type {
  AwarenessEngine,
  AwarenessState,
  CursorEngine,
  CursorOptions,
  CursorPosition,
  EventEngine,
  EventOptions,
  FlockError,
  Peer,
  PresenceData,
  PresenceEngine,
  Room,
  RoomEventHandler,
  RoomEventMap,
  RoomEventName,
  RoomOptions,
  RoomStatus,
  StateEngine,
  StateOptions,
  Unsubscribe,
} from './types';

const LOCKED_PRESENCE_KEYS = new Set(['id', 'joinedAt', 'lastSeen']);
const FLOCK_ERROR_CODES = new Set<FlockError['code']>([
  'ROOM_FULL',
  'AUTH_FAILED',
  'NETWORK_ERROR',
  'ENCRYPTION_ERROR',
]);

interface EventMessagePayload {
  name: string;
  payload: unknown;
  loopback?: boolean;
}

interface RoomSignalPayload<TPresence extends PresenceData> {
  peer?: Peer<TPresence>;
  event?: EventMessagePayload;
  awareness?: AwarenessState;
  cursor?: CursorPosition;
}

interface ConnectContext {
  isReconnectAttempt: boolean;
}

type PeerEventCallback<TPresence extends PresenceData> = (peers: Peer<TPresence>[]) => void;
type CursorCallback = (positions: CursorPosition[]) => void;
type AwarenessCallback = (peers: AwarenessState[]) => void;
type InternalEventCallback<TPresence extends PresenceData> = (
  payload: unknown,
  from: Peer<TPresence>,
) => void;

function createPeerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFlockError(value: unknown): value is FlockError {
  if (!(value instanceof Error) || !isRecord(value)) {
    return false;
  }

  const code = value.code;
  const recoverable = value.recoverable;

  return (
    typeof code === 'string' &&
    FLOCK_ERROR_CODES.has(code as FlockError['code']) &&
    typeof recoverable === 'boolean'
  );
}

function toTransportError(error: unknown): FlockError {
  if (isFlockError(error)) {
    return error;
  }

  return createFlockError(
    'NETWORK_ERROR',
    error instanceof Error ? error.message : 'Unknown transport connection error.',
    false,
    error,
  );
}

function sanitizePresencePatch<TPresence extends PresenceData>(patch: Partial<TPresence>): Partial<TPresence> {
  const sanitized: Partial<TPresence> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (LOCKED_PRESENCE_KEYS.has(key)) {
      continue;
    }

    (sanitized as Record<string, unknown>)[key] = value;
  }

  return sanitized;
}

function parsePeerPayload<TPresence extends PresenceData>(payload: unknown): Peer<TPresence> | null {
  if (!isRecord(payload)) {
    return null;
  }

  const id = payload.id;
  const joinedAt = payload.joinedAt;
  const lastSeen = payload.lastSeen;

  if (typeof id !== 'string' || typeof joinedAt !== 'number' || typeof lastSeen !== 'number') {
    return null;
  }

  return payload as Peer<TPresence>;
}

export class RoomImpl<TPresence extends PresenceData = PresenceData> implements Room<TPresence> {
  public readonly id: string;

  public readonly peerId: string;

  private readonly options: RoomOptions<TPresence>;

  private currentStatus: RoomStatus = 'idle';

  private readonly roomEventEmitter = new TypedEventEmitter<RoomEventMap<TPresence>>();

  private readonly remotePeers = new Map<string, Peer<TPresence>>();

  private selfPeer: Peer<TPresence>;

  private transport: TransportAdapter | null = null;

  private transportUnsubscribe: Unsubscribe | null = null;

  private connectionPromise: Promise<void> | null = null;

  private hasConnectedBefore = false;

  private reconnectAttempt = 0;

  private readonly peerSubscribers = new Set<PeerEventCallback<TPresence>>();

  private readonly cursorPositions = new Map<string, CursorPosition>();

  private readonly cursorSubscribers = new Set<CursorCallback>();

  private readonly awarenessByPeer = new Map<string, AwarenessState>();

  private readonly awarenessSubscribers = new Set<AwarenessCallback>();

  private readonly customEventHandlers = new Map<string, Set<InternalEventCallback<TPresence>>>();

  private presenceEngineInstance: PresenceEngine<TPresence> | null = null;

  private cursorEngineInstance: CursorEngine | null = null;

  private awarenessEngineInstance: AwarenessEngine | null = null;

  public constructor(roomId: string, options: RoomOptions<TPresence> = {}) {
    this.id = roomId;
    this.options = options;
    this.peerId = createPeerId();

    const now = Date.now();
    const initialPresence = sanitizePresencePatch(options.presence ?? {});

    this.selfPeer = {
      id: this.peerId,
      joinedAt: now,
      lastSeen: now,
      ...initialPresence,
    } as Peer<TPresence>;

    this.awarenessByPeer.set(this.peerId, { peerId: this.peerId });
  }

  public get status(): RoomStatus {
    return this.currentStatus;
  }

  public get peers(): Peer<TPresence>[] {
    return Array.from(this.remotePeers.values());
  }

  public get peerCount(): number {
    return this.remotePeers.size;
  }

  public async connect(): Promise<void> {
    if (this.currentStatus === 'connected') {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    const task = this.connectInternal({
      isReconnectAttempt:
        this.hasConnectedBefore &&
        (this.currentStatus === 'disconnected' || this.currentStatus === 'error'),
    });
    this.connectionPromise = task;

    try {
      await task;
    } finally {
      this.connectionPromise = null;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.connectionPromise) {
      await this.connectionPromise.catch(() => {
        return undefined;
      });
    }

    if (!this.transport) {
      this.setStatus('disconnected');
      this.roomEventEmitter.emit('disconnected', { reason: 'manual' });
      return;
    }

    this.sendSignal({
      type: 'leave',
      payload: {
        peer: this.selfPeer,
      },
    });

    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;

    await this.transport.disconnect();
    this.transport = null;

    this.remotePeers.clear();
    this.cursorPositions.clear();
    this.awarenessByPeer.clear();
    this.awarenessByPeer.set(this.peerId, { peerId: this.peerId });

    this.notifyPeerSubscribers();
    this.notifyCursorSubscribers();
    this.notifyAwarenessSubscribers();

    this.setStatus('disconnected');
    this.roomEventEmitter.emit('disconnected', { reason: 'manual' });
  }

  public usePresence(): PresenceEngine<TPresence> {
    if (!this.presenceEngineInstance) {
      this.presenceEngineInstance = createPresenceEngine({
        updateSelf: (data) => {
          this.updateSelfPresence(data);
        },
        replaceSelf: (data) => {
          this.replaceSelfPresence(data);
        },
        getSelf: () => {
          return this.selfPeer;
        },
        getPeer: (peerId) => {
          if (peerId === this.peerId) {
            return this.selfPeer;
          }

          return this.remotePeers.get(peerId) ?? null;
        },
        getAllPeers: () => {
          return this.getSelfAndPeersSnapshot();
        },
        subscribe: (callback) => {
          this.peerSubscribers.add(callback);
          callback(this.getSelfAndPeersSnapshot());

          return () => {
            this.peerSubscribers.delete(callback);
          };
        },
      });
    }

    return this.presenceEngineInstance;
  }

  public useCursors(options?: CursorOptions): CursorEngine {
    if (!this.cursorEngineInstance) {
      this.cursorEngineInstance = createCursorEngine(
        {
          setSelfPosition: (position) => {
            this.setSelfCursorPosition(position);
          },
          getPositions: () => {
            return Array.from(this.cursorPositions.values());
          },
          subscribe: (callback) => {
            this.cursorSubscribers.add(callback);
            callback(Array.from(this.cursorPositions.values()));

            return () => {
              this.cursorSubscribers.delete(callback);
            };
          },
        },
        options,
      );
    }

    return this.cursorEngineInstance;
  }

  public useState<T>(options: StateOptions<T>): StateEngine<T> {
    return createStateEngine(options);
  }

  public useAwareness(): AwarenessEngine {
    if (!this.awarenessEngineInstance) {
      this.awarenessEngineInstance = createAwarenessEngine({
        updateSelfAwareness: (patch) => {
          const existing = this.awarenessByPeer.get(this.peerId) ?? { peerId: this.peerId };
          const next: AwarenessState = {
            ...existing,
            ...patch,
            peerId: this.peerId,
          };

          this.awarenessByPeer.set(this.peerId, next);
          this.sendSignal({
            type: 'awareness:update',
            payload: {
              awareness: next,
            },
          });
          this.notifyAwarenessSubscribers();
        },
        getAllAwareness: () => {
          return Array.from(this.awarenessByPeer.values());
        },
        subscribeAwareness: (callback) => {
          this.awarenessSubscribers.add(callback);
          callback(Array.from(this.awarenessByPeer.values()));

          return () => {
            this.awarenessSubscribers.delete(callback);
          };
        },
      });
    }

    return this.awarenessEngineInstance;
  }

  public useEvents(options?: EventOptions): EventEngine<TPresence> {
    return createEventEngine(
      {
        emitEvent: (name, payload, toPeerId, loopback) => {
          const eventPayload: EventMessagePayload = {
            name,
            payload,
            loopback,
          };

          const eventSignal: Omit<TransportSignal, 'roomId' | 'fromPeerId'> = {
            type: 'event',
            payload: {
              event: eventPayload,
            },
          };

          if (toPeerId !== undefined) {
            eventSignal.toPeerId = toPeerId;
          }

          this.sendSignal(eventSignal);

          if (loopback && (!toPeerId || toPeerId === this.peerId)) {
            this.emitCustomEvent(name, payload, this.selfPeer);
          }
        },
        onEvent: (name, callback) => {
          const handlers =
            this.customEventHandlers.get(name) ?? new Set<InternalEventCallback<TPresence>>();
          handlers.add(callback as InternalEventCallback<TPresence>);
          this.customEventHandlers.set(name, handlers);

          return () => {
            this.removeCustomEventHandler(name, callback as InternalEventCallback<TPresence>);
          };
        },
        offEvent: (name, callback) => {
          this.removeCustomEventHandler(name, callback as InternalEventCallback<TPresence>);
        },
      },
      options,
    );
  }

  public on<TEvent extends RoomEventName>(
    event: TEvent,
    cb: RoomEventHandler<TPresence, TEvent>,
  ): Unsubscribe {
    return this.roomEventEmitter.on(event, cb as RoomEventHandler<TPresence, TEvent>);
  }

  public off<TEvent extends RoomEventName>(
    event: TEvent,
    cb: RoomEventHandler<TPresence, TEvent>,
  ): void {
    this.roomEventEmitter.off(event, cb as RoomEventHandler<TPresence, TEvent>);
  }

  private async connectInternal(context: ConnectContext): Promise<void> {
    if (context.isReconnectAttempt) {
      this.reconnectAttempt += 1;
      this.setStatus('reconnecting');
      this.roomEventEmitter.emit('reconnecting', { attempt: this.reconnectAttempt });
    }

    this.setStatus('connecting');

    try {
      const transport = selectTransportAdapter(this.id, this.peerId, this.options);
      this.transport = transport;
      this.transportUnsubscribe = transport.subscribe((signal) => {
        this.handleSignal(signal);
      });

      await transport.connect();

      this.hasConnectedBefore = true;
      this.reconnectAttempt = 0;
      this.setStatus('connected');
      this.roomEventEmitter.emit('connected');
      this.notifyPeerSubscribers();

      this.sendSignal({
        type: 'hello',
        payload: {
          peer: this.selfPeer,
        },
      });
    } catch (error) {
      const flockError = toTransportError(error);
      this.setStatus('error');
      this.roomEventEmitter.emit('error', flockError);
      this.transportUnsubscribe?.();
      this.transportUnsubscribe = null;
      this.transport = null;
      throw flockError;
    }
  }

  private setStatus(status: RoomStatus): void {
    this.currentStatus = status;
  }

  private shouldHandleSignal(signal: TransportSignal): boolean {
    if (signal.roomId !== this.id) {
      return false;
    }

    if (signal.fromPeerId === this.peerId) {
      return false;
    }

    if (signal.toPeerId && signal.toPeerId !== this.peerId) {
      return false;
    }

    return true;
  }

  private getSignalPayload(signal: TransportSignal): RoomSignalPayload<TPresence> {
    const payload = signal.payload;
    if (!payload || !isRecord(payload)) {
      return {};
    }

    return payload as RoomSignalPayload<TPresence>;
  }

  private handleSignal(signal: TransportSignal): void {
    if (!this.shouldHandleSignal(signal)) {
      return;
    }

    const payload = this.getSignalPayload(signal);

    switch (signal.type) {
      case 'hello':
        this.handleHelloSignal(signal, payload);
        return;
      case 'welcome':
      case 'presence:update':
        this.handlePresenceSignal(payload);
        return;
      case 'leave':
        this.removeRemotePeer(signal.fromPeerId);
        return;
      case 'cursor:update':
        this.handleCursorSignal(signal.fromPeerId, payload);
        return;
      case 'awareness:update':
        this.handleAwarenessSignal(signal.fromPeerId, payload);
        return;
      case 'event':
        this.handleCustomEventSignal(signal.fromPeerId, payload);
        return;
      default:
        return;
    }
  }

  private handleHelloSignal(signal: TransportSignal, payload: RoomSignalPayload<TPresence>): void {
    const peer = parsePeerPayload<TPresence>(payload.peer);
    if (!peer) {
      return;
    }

    this.upsertRemotePeer(peer);
    this.sendSignal({
      type: 'welcome',
      toPeerId: signal.fromPeerId,
      payload: {
        peer: this.selfPeer,
      },
    });
  }

  private handlePresenceSignal(payload: RoomSignalPayload<TPresence>): void {
    const peer = parsePeerPayload<TPresence>(payload.peer);
    if (!peer) {
      return;
    }

    this.upsertRemotePeer(peer);
  }

  private handleCursorSignal(fromPeerId: string, payload: RoomSignalPayload<TPresence>): void {
    const cursor = payload.cursor;
    if (!cursor || !isRecord(cursor)) {
      return;
    }

    const normalized = {
      ...(cursor as CursorPosition),
      userId: fromPeerId,
    } as CursorPosition;

    this.cursorPositions.set(fromPeerId, normalized);
    this.notifyCursorSubscribers();
  }

  private handleAwarenessSignal(fromPeerId: string, payload: RoomSignalPayload<TPresence>): void {
    const awareness = payload.awareness;
    if (!awareness || !isRecord(awareness)) {
      return;
    }

    const normalized: AwarenessState = {
      ...awareness,
      peerId: fromPeerId,
    };
    this.awarenessByPeer.set(fromPeerId, normalized);
    this.notifyAwarenessSubscribers();
  }

  private handleCustomEventSignal(fromPeerId: string, payload: RoomSignalPayload<TPresence>): void {
    const event = payload.event;
    if (!event || !isRecord(event) || typeof event.name !== 'string') {
      return;
    }

    const fromPeer = this.remotePeers.get(fromPeerId);
    if (!fromPeer) {
      return;
    }

    this.emitCustomEvent(event.name, event.payload, fromPeer);
  }

  private sendSignal(signal: Omit<TransportSignal, 'roomId' | 'fromPeerId'>): void {
    if (!this.transport) {
      return;
    }

    this.transport.send({
      ...signal,
      roomId: this.id,
      fromPeerId: this.peerId,
    });
  }

  private upsertRemotePeer(peer: Peer<TPresence>): void {
    if (peer.id === this.peerId) {
      return;
    }

    const now = Date.now();
    const existing = this.remotePeers.get(peer.id);

    const normalized: Peer<TPresence> = {
      ...existing,
      ...peer,
      id: peer.id,
      joinedAt: peer.joinedAt ?? existing?.joinedAt ?? now,
      lastSeen: now,
    };

    this.remotePeers.set(peer.id, normalized);

    if (existing) {
      this.roomEventEmitter.emit('peer:update', normalized);
    } else {
      this.roomEventEmitter.emit('peer:join', normalized);
    }

    const maxPeers = this.options.maxPeers;
    if (maxPeers !== undefined && this.remotePeers.size + 1 >= maxPeers) {
      this.roomEventEmitter.emit('room:full');
    }

    this.notifyPeerSubscribers();
  }

  private removeRemotePeer(peerId: string): void {
    const existing = this.remotePeers.get(peerId);
    if (!existing) {
      return;
    }

    this.remotePeers.delete(peerId);
    this.cursorPositions.delete(peerId);
    this.awarenessByPeer.delete(peerId);

    this.roomEventEmitter.emit('peer:leave', existing);

    if (this.remotePeers.size === 0) {
      this.roomEventEmitter.emit('room:empty');
    }

    this.notifyPeerSubscribers();
    this.notifyCursorSubscribers();
    this.notifyAwarenessSubscribers();
  }

  private updateSelfPresence(data: Partial<TPresence>): void {
    const sanitized = sanitizePresencePatch(data);
    this.applySelfPresence({
      ...this.selfPeer,
      ...sanitized,
      lastSeen: Date.now(),
    });
  }

  private replaceSelfPresence(data: Partial<TPresence>): void {
    const sanitized = sanitizePresencePatch(data);
    this.applySelfPresence({
      id: this.selfPeer.id,
      joinedAt: this.selfPeer.joinedAt,
      lastSeen: Date.now(),
      ...sanitized,
    } as Peer<TPresence>);
  }

  private applySelfPresence(next: Peer<TPresence>): void {
    this.selfPeer = next;
    this.broadcastSelfPresence();
    this.notifyPeerSubscribers();
  }

  private broadcastSelfPresence(): void {
    this.sendSignal({
      type: 'presence:update',
      payload: {
        peer: this.selfPeer,
      },
    });
  }

  private getSelfAndPeersSnapshot(): Peer<TPresence>[] {
    return [this.selfPeer, ...this.peers];
  }

  private notifyPeerSubscribers(): void {
    const snapshot = this.getSelfAndPeersSnapshot();
    for (const subscriber of this.peerSubscribers) {
      subscriber(snapshot);
    }
  }

  private setSelfCursorPosition(position: Partial<CursorPosition>): void {
    const existing = this.cursorPositions.get(this.peerId);
    const next: CursorPosition = {
      userId: this.peerId,
      name: this.getPeerDisplayName(this.selfPeer),
      color: this.getPeerColor(this.selfPeer),
      x: 0,
      y: 0,
      xAbsolute: 0,
      yAbsolute: 0,
      idle: false,
      ...existing,
      ...position,
    };

    this.cursorPositions.set(this.peerId, next);
    this.sendSignal({
      type: 'cursor:update',
      payload: {
        cursor: next,
      },
    });
    this.notifyCursorSubscribers();
  }

  private notifyCursorSubscribers(): void {
    const positions = Array.from(this.cursorPositions.values());
    for (const subscriber of this.cursorSubscribers) {
      subscriber(positions);
    }
  }

  private notifyAwarenessSubscribers(): void {
    const snapshot = Array.from(this.awarenessByPeer.values());
    for (const subscriber of this.awarenessSubscribers) {
      subscriber(snapshot);
    }
  }

  private emitCustomEvent(name: string, payload: unknown, from: Peer<TPresence>): void {
    const handlers = this.customEventHandlers.get(name);
    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      handler(payload, from);
    }
  }

  private removeCustomEventHandler(name: string, callback: InternalEventCallback<TPresence>): void {
    const handlers = this.customEventHandlers.get(name);
    if (!handlers) {
      return;
    }

    handlers.delete(callback);
    if (handlers.size === 0) {
      this.customEventHandlers.delete(name);
    }
  }

  private getPeerDisplayName(peer: Peer<TPresence>): string {
    const value = (peer as Record<string, unknown>).name;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return peer.id;
  }

  private getPeerColor(peer: Peer<TPresence>): string {
    const value = (peer as Record<string, unknown>).color;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return '#4F46E5';
  }
}

export function createRoom<TPresence extends PresenceData = PresenceData>(
  roomId: string,
  options: RoomOptions<TPresence> = {},
): Room<TPresence> {
  return new RoomImpl<TPresence>(roomId, options);
}
