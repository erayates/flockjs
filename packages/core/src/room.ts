import { createAwarenessEngine } from './engines/awareness';
import { createCursorEngine } from './engines/cursors';
import { createEventEngine } from './engines/events';
import { createPresenceEngine } from './engines/presence';
import { createStateEngine } from './engines/state';
import { TypedEventEmitter } from './event-emitter';
import { createFlockError, FlockError } from './flock-error';
import { createRuntimePeerId, getWindowEventTarget, type WindowEventTarget } from './internal/env';
import { readString } from './internal/guards';
import { logRoomError } from './internal/logger';
import { normalizeMaxPeers } from './internal/max-peers';
import { PeerRegistry } from './internal/peer-registry';
import {
  computeReconnectDelay,
  delayWithAbort,
  type ResolvedReconnectOptions,
  resolveReconnectOptions,
} from './internal/reconnect';
import { coerceTypedPeer } from './internal/typed-peer';
import { selectTransportAdapter } from './transports/select-transport';
import type {
  RoomTransportSignal,
  TransportAdapter,
  TransportSignal,
} from './transports/transport';
import {
  getTransportProtocolCapabilities,
  normalizeTransportSignal,
} from './transports/transport.protocol';
import type {
  AwarenessEngine,
  AwarenessState,
  CursorEngine,
  CursorOptions,
  CursorPosition,
  EventEngine,
  EventOptions,
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
const PRESENCE_HEARTBEAT_MS = 30_000;

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

function isFlockError(value: unknown): value is FlockError {
  return value instanceof FlockError;
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
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

function createReconnectExhaustedError(
  attempts: number,
  reason: string | null,
  lastError: unknown,
): FlockError {
  return createFlockError(
    'NETWORK_ERROR',
    `Reconnect attempts exhausted after ${attempts} attempt${attempts === 1 ? '' : 's'}.`,
    true,
    {
      source: 'room-reconnect',
      kind: 'max-attempts-exhausted',
      attempts,
      ...(reason ? { reason } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    },
  );
}

function sanitizePresencePatch<TPresence extends PresenceData>(
  patch: Partial<TPresence>,
): Partial<TPresence> {
  const sanitized: Partial<TPresence> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (LOCKED_PRESENCE_KEYS.has(key)) {
      continue;
    }

    Reflect.set(sanitized, key, value);
  }

  return sanitized;
}

function isInternalTransportSignal(signal: TransportSignal): boolean {
  return signal.type === 'transport:error' || signal.type === 'transport:disconnected';
}

export class RoomImpl<TPresence extends PresenceData = PresenceData> implements Room<TPresence> {
  public readonly id: string;

  public readonly peerId: string;

  private readonly options: RoomOptions<TPresence>;

  private readonly maxPeers: number | undefined;

  private currentStatus: RoomStatus = 'idle';

  private readonly roomEventEmitter = new TypedEventEmitter<RoomEventMap<TPresence>>();

  private readonly peerRegistry: PeerRegistry<TPresence>;

  private readonly reconnectOptions: ResolvedReconnectOptions | null;

  private transport: TransportAdapter | null = null;

  private transportUnsubscribe: Unsubscribe | null = null;

  private pendingTransportUnsubscribe: Unsubscribe | null = null;

  private connectionPromise: Promise<void> | null = null;

  private reconnectPromise: Promise<void> | null = null;

  private reconnectController: AbortController | null = null;

  private hasConnectedBefore = false;

  private reconnectAttempt = 0;

  private lastDisconnectReason: string | null = null;

  private unloadHandlersRegistered = false;

  private unloadEventTarget: WindowEventTarget | null = null;

  private presenceHeartbeat: ReturnType<typeof globalThis.setInterval> | null = null;

  private readonly onBeforeUnload = (): void => {
    this.handleWindowUnload();
  };

  private readonly onPageHide = (): void => {
    this.handleWindowUnload();
  };

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
    this.maxPeers = normalizeMaxPeers(options.maxPeers);
    this.reconnectOptions = resolveReconnectOptions(options.reconnect);
    this.peerId = createRuntimePeerId();

    const now = Date.now();
    const initialPresence = sanitizePresencePatch(options.presence ?? {});

    const initialSelfPeer: Peer<TPresence> = {
      id: this.peerId,
      joinedAt: now,
      lastSeen: now,
      ...initialPresence,
    };

    this.peerRegistry = new PeerRegistry(initialSelfPeer, {
      onPeerJoin: (peer) => {
        this.handlePeerRegistryJoin(peer);
      },
      onPeerUpdate: (peer) => {
        this.handlePeerRegistryUpdate(peer);
      },
      onPeerLeave: (peer) => {
        this.handlePeerRegistryLeave(peer);
      },
      onSnapshotChange: () => {
        this.notifyPeerSubscribers();
      },
    });

    this.awarenessByPeer.set(this.peerId, { peerId: this.peerId });
  }

  private get selfPeer(): Peer<TPresence> {
    return this.peerRegistry.getSelf();
  }

  public get status(): RoomStatus {
    return this.currentStatus;
  }

  public get peers(): Peer<TPresence>[] {
    return this.peerRegistry.getRemotes();
  }

  public get peerCount(): number {
    return this.peerRegistry.getRemoteCount();
  }

  public connect(): Promise<void> {
    if (this.currentStatus === 'connected') {
      return Promise.resolve();
    }

    if (this.reconnectPromise) {
      return this.reconnectPromise;
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

    void task.then(
      () => {
        if (this.connectionPromise === task) {
          this.connectionPromise = null;
        }
      },
      () => {
        if (this.connectionPromise === task) {
          this.connectionPromise = null;
        }
      },
    );

    return task;
  }

  public async disconnect(): Promise<void> {
    this.cancelReconnect();

    if (this.reconnectPromise) {
      await this.reconnectPromise.catch(() => {
        return undefined;
      });
    }

    if (this.connectionPromise) {
      await this.connectionPromise.catch(() => {
        return undefined;
      });
    }

    this.unregisterUnloadHandlers();
    this.stopPresenceHeartbeat();

    if (!this.transport) {
      this.lastDisconnectReason = 'manual';
      this.clearRemoteState();
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

    this.lastDisconnectReason = 'manual';
    this.clearRemoteState();

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
          return this.peerRegistry.getSelf();
        },
        getPeer: (peerId) => {
          return this.peerRegistry.get(peerId);
        },
        getAllPeers: () => {
          return this.peerRegistry.getAll();
        },
        subscribe: (callback) => {
          this.peerSubscribers.add(callback);
          callback(this.peerRegistry.getAll());

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
      const getRemoteCursorPositions = (): CursorPosition[] => {
        return Array.from(this.cursorPositions.values()).filter((position) => {
          return position.userId !== this.peerId;
        });
      };

      this.cursorEngineInstance = createCursorEngine(
        {
          setSelfPosition: (position) => {
            this.setSelfCursorPosition(position);
          },
          getPositions: () => {
            return getRemoteCursorPositions();
          },
          subscribe: (callback) => {
            const wrappedCallback = (): void => {
              callback(getRemoteCursorPositions());
            };

            this.cursorSubscribers.add(wrappedCallback);
            wrappedCallback();

            return () => {
              this.cursorSubscribers.delete(wrappedCallback);
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
            payload: { awareness: next },
          });
          this.notifyAwarenessSubscribers();
        },
        getAllAwareness: () => {
          return this.getAwarenessSnapshot();
        },
        subscribeAwareness: (callback) => {
          this.awarenessSubscribers.add(callback);
          callback(this.getRemoteAwarenessSnapshot());

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
          const eventPayload = {
            name,
            payload,
            loopback,
          };

          const eventSignal: Omit<RoomTransportSignal, 'roomId' | 'fromPeerId' | 'timestamp'> = {
            type: 'event',
            payload: eventPayload,
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
          handlers.add(callback);
          this.customEventHandlers.set(name, handlers);

          return () => {
            this.removeCustomEventHandler(name, callback);
          };
        },
        offEvent: (name, callback) => {
          this.removeCustomEventHandler(name, callback);
        },
      },
      options,
    );
  }

  public on<TEvent extends RoomEventName>(
    event: TEvent,
    cb: RoomEventHandler<TPresence, TEvent>,
  ): Unsubscribe {
    return this.roomEventEmitter.on(event, cb);
  }

  public off<TEvent extends RoomEventName>(
    event: TEvent,
    cb: RoomEventHandler<TPresence, TEvent>,
  ): void {
    this.roomEventEmitter.off(event, cb);
  }

  private async connectInternal(context: ConnectContext): Promise<void> {
    if (context.isReconnectAttempt) {
      this.reconnectAttempt += 1;
      this.setStatus('reconnecting');
      this.roomEventEmitter.emit('reconnecting', { attempt: this.reconnectAttempt });
    }

    this.setStatus('connecting');

    try {
      const transport = await this.openTransportAttempt();
      this.activateConnectedTransport(transport);
    } catch (error) {
      this.failInitialConnect(error);
    }
  }

  private setStatus(status: RoomStatus): void {
    this.currentStatus = status;
  }

  private registerUnloadHandlers(): void {
    if (this.unloadHandlersRegistered) {
      return;
    }

    const eventTarget = getWindowEventTarget();
    if (!eventTarget) {
      return;
    }

    eventTarget.addEventListener('beforeunload', this.onBeforeUnload);
    eventTarget.addEventListener('pagehide', this.onPageHide);

    this.unloadEventTarget = eventTarget;
    this.unloadHandlersRegistered = true;
  }

  private unregisterUnloadHandlers(): void {
    if (!this.unloadHandlersRegistered) {
      return;
    }

    const eventTarget = this.unloadEventTarget;
    if (eventTarget) {
      eventTarget.removeEventListener('beforeunload', this.onBeforeUnload);
      eventTarget.removeEventListener('pagehide', this.onPageHide);
    }

    this.unloadEventTarget = null;
    this.unloadHandlersRegistered = false;
  }

  private handleWindowUnload(): void {
    void this.disconnect();
  }

  private shouldHandleSignal(signal: TransportSignal): boolean {
    if (signal.roomId !== this.id) {
      return false;
    }

    if (signal.fromPeerId === this.peerId && !isInternalTransportSignal(signal)) {
      return false;
    }

    if ('toPeerId' in signal && signal.toPeerId && signal.toPeerId !== this.peerId) {
      return false;
    }

    return true;
  }

  private handleSignal(signal: TransportSignal): void {
    if (!this.shouldHandleSignal(signal)) {
      return;
    }

    switch (signal.type) {
      case 'hello':
        this.handleHelloSignal(signal);
        return;
      case 'welcome':
      case 'presence:update':
        this.handlePresenceSignal(signal);
        return;
      case 'leave':
        this.handleLeaveSignal(signal);
        return;
      case 'cursor:update':
        this.handleCursorSignal(signal);
        return;
      case 'awareness:update':
        this.handleAwarenessSignal(signal);
        return;
      case 'event':
        this.handleCustomEventSignal(signal);
        return;
      case 'transport:error':
        this.handleTransportErrorSignal(signal.payload);
        return;
      case 'transport:disconnected':
        void this.handleTransportDisconnectedSignal(signal.payload);
        return;
      default:
        return;
    }
  }

  private handleHelloSignal(signal: Extract<RoomTransportSignal, { type: 'hello' }>): void {
    this.peerRegistry.upsertRemote(coerceTypedPeer<TPresence>(signal.payload.peer));
    this.sendSignal({
      type: 'welcome',
      toPeerId: signal.fromPeerId,
      payload: {
        peer: this.selfPeer,
        protocol: getTransportProtocolCapabilities(this.transport?.kind ?? 'in-memory'),
      },
    });
  }

  private handlePresenceSignal(
    signal:
      | Extract<RoomTransportSignal, { type: 'welcome' }>
      | Extract<RoomTransportSignal, { type: 'presence:update' }>,
  ): void {
    this.peerRegistry.upsertRemote(coerceTypedPeer<TPresence>(signal.payload.peer));

    if (signal.type === 'welcome') {
      this.sendSelfPresence(signal.fromPeerId);
    }
  }

  private handleLeaveSignal(signal: Extract<RoomTransportSignal, { type: 'leave' }>): void {
    const peer = signal.payload.peer;
    if (peer && peer.id === signal.fromPeerId) {
      this.peerRegistry.removeRemoteImmediately(signal.fromPeerId);
      return;
    }

    this.peerRegistry.markRemoteDisconnected(signal.fromPeerId);
  }

  private handleCursorSignal(
    signal: Extract<RoomTransportSignal, { type: 'cursor:update' }>,
  ): void {
    this.cursorPositions.set(signal.fromPeerId, signal.payload.cursor);
    this.notifyCursorSubscribers();
  }

  private handleAwarenessSignal(
    signal: Extract<RoomTransportSignal, { type: 'awareness:update' }>,
  ): void {
    this.awarenessByPeer.set(signal.fromPeerId, signal.payload.awareness);
    this.notifyAwarenessSubscribers();
  }

  private handleCustomEventSignal(signal: Extract<RoomTransportSignal, { type: 'event' }>): void {
    const fromPeer = this.peerRegistry.get(signal.fromPeerId);
    if (!fromPeer) {
      return;
    }

    this.emitCustomEvent(signal.payload.name, signal.payload.payload, fromPeer);
  }

  private handleTransportErrorSignal(payload: { error: FlockError }): void {
    this.emitRoomError(toTransportError(payload.error));
  }

  private async handleTransportDisconnectedSignal(payload: { reason?: string }): Promise<void> {
    if (
      !this.transport &&
      (this.currentStatus === 'disconnected' || this.currentStatus === 'reconnecting')
    ) {
      return;
    }

    this.unregisterUnloadHandlers();
    this.stopPresenceHeartbeat();

    const reason = payload.reason ?? 'transport-disconnected';
    this.lastDisconnectReason = reason;

    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;

    const transport = this.transport;
    this.transport = null;

    if (transport) {
      await transport.disconnect().catch(() => {
        return undefined;
      });
    }

    this.peerRegistry.markAllRemotesDisconnected();

    if (!this.shouldAutoReconnect()) {
      this.setStatus('disconnected');
      this.roomEventEmitter.emit('disconnected', { reason });
      return;
    }

    this.startReconnectLoop(reason);
  }

  private sendSignal(
    signal: Omit<RoomTransportSignal, 'roomId' | 'fromPeerId' | 'timestamp'>,
  ): void {
    if (!this.transport) {
      return;
    }

    const outboundSignal = normalizeTransportSignal({
      ...signal,
      roomId: this.id,
      fromPeerId: this.peerId,
      timestamp: Date.now(),
    });
    if (!outboundSignal) {
      return;
    }

    if (outboundSignal.toPeerId) {
      this.transport.send(outboundSignal);
      return;
    }

    this.transport.broadcast(outboundSignal);
  }

  private clearRemoteState(): void {
    this.peerRegistry.clearRemotePeers({
      emitLeaveEvents: false,
    });
    this.cursorPositions.clear();
    this.awarenessByPeer.clear();
    this.awarenessByPeer.set(this.peerId, { peerId: this.peerId });

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
    });
  }

  private applySelfPresence(next: Peer<TPresence>): void {
    this.peerRegistry.setSelf(next);
    this.sendSelfPresence();
  }

  private refreshSelfPresenceLastSeen(): void {
    this.applySelfPresence({
      ...this.selfPeer,
      lastSeen: Date.now(),
    });
  }

  private sendSelfPresence(toPeerId?: string): void {
    this.sendSignal({
      type: 'presence:update',
      ...(toPeerId ? { toPeerId } : {}),
      payload: { peer: this.selfPeer },
    });
  }

  private getSelfAndPeersSnapshot(): Peer<TPresence>[] {
    return this.peerRegistry.getAll();
  }

  private async openTransportAttempt(): Promise<TransportAdapter> {
    const transport = selectTransportAdapter(this.id, this.peerId, this.options);
    const unsubscribe = transport.onMessage((signal) => {
      this.handleSignal(signal);
    });

    try {
      await transport.connect();
      this.pendingTransportUnsubscribe = unsubscribe;
      return transport;
    } catch (error) {
      unsubscribe();
      await transport.disconnect().catch(() => {
        return undefined;
      });
      throw error;
    }
  }

  private activateConnectedTransport(transport: TransportAdapter): void {
    this.transport = transport;
    this.transportUnsubscribe = this.pendingTransportUnsubscribe;
    this.pendingTransportUnsubscribe = null;

    this.registerUnloadHandlers();
    this.hasConnectedBefore = true;
    this.reconnectAttempt = 0;
    this.lastDisconnectReason = null;
    this.setStatus('connected');
    this.roomEventEmitter.emit('connected', undefined);
    this.notifyPeerSubscribers();
    this.startPresenceHeartbeat();

    this.sendSignal({
      type: 'hello',
      payload: {
        peer: this.selfPeer,
        protocol: getTransportProtocolCapabilities(transport.kind),
      },
    });
    this.replayLocalEphemeralState();
  }

  private failInitialConnect(error: unknown): never {
    const flockError = toTransportError(error);
    this.unregisterUnloadHandlers();
    this.stopPresenceHeartbeat();
    this.clearRemoteState();
    this.pendingTransportUnsubscribe?.();
    this.pendingTransportUnsubscribe = null;
    this.transportUnsubscribe?.();
    this.transportUnsubscribe = null;
    this.transport = null;
    this.setStatus('error');
    if (flockError.code === 'ROOM_FULL') {
      this.roomEventEmitter.emit('room:full', undefined);
    }
    this.emitRoomError(flockError);
    throw flockError;
  }

  private shouldAutoReconnect(): boolean {
    return (
      this.reconnectOptions !== null && this.hasConnectedBefore && this.reconnectPromise === null
    );
  }

  private startReconnectLoop(reason: string): void {
    if (this.reconnectPromise) {
      return;
    }

    this.setStatus('reconnecting');
    const task = this.runReconnectLoop(reason);
    this.reconnectPromise = task;

    void task.then(
      () => {
        if (this.reconnectPromise === task) {
          this.reconnectPromise = null;
        }
      },
      () => {
        if (this.reconnectPromise === task) {
          this.reconnectPromise = null;
        }
      },
    );
  }

  private async runReconnectLoop(reason: string): Promise<void> {
    const reconnectOptions = this.reconnectOptions;
    if (!reconnectOptions) {
      return;
    }

    this.lastDisconnectReason = reason;

    const controller = new AbortController();
    this.reconnectController = controller;
    let lastError: unknown;

    for (let attempt = 1; attempt <= reconnectOptions.maxAttempts; attempt += 1) {
      if (this.wasReconnectAborted(controller)) {
        this.clearReconnectController(controller);
        return;
      }

      this.reconnectAttempt = attempt;
      this.setStatus('reconnecting');
      this.roomEventEmitter.emit('reconnecting', { attempt });

      try {
        const delayMs = computeReconnectDelay(attempt, reconnectOptions, Math.random);
        await delayWithAbort(delayMs, controller.signal);
      } catch (error) {
        if (isAbortError(error)) {
          this.clearReconnectController(controller);
          return;
        }

        throw error;
      }

      if (this.wasReconnectAborted(controller)) {
        this.clearReconnectController(controller);
        return;
      }

      try {
        const transport = await this.openTransportAttempt();

        if (this.wasReconnectAborted(controller)) {
          await this.disposeTransportAttempt(transport);
          this.clearReconnectController(controller);
          return;
        }

        this.activateConnectedTransport(transport);
        this.clearReconnectController(controller);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    this.clearReconnectController(controller);
    this.reconnectAttempt = 0;
    this.setStatus('disconnected');
    this.emitRoomError(
      createReconnectExhaustedError(
        reconnectOptions.maxAttempts,
        this.lastDisconnectReason,
        lastError,
      ),
    );
    this.roomEventEmitter.emit('disconnected', { reason: 'reconnect-exhausted' });
  }

  private clearReconnectController(controller: AbortController): void {
    if (this.reconnectController === controller) {
      this.reconnectController = null;
    }
  }

  private wasReconnectAborted(controller: AbortController): boolean {
    return controller.signal.aborted;
  }

  private cancelReconnect(): void {
    this.reconnectController?.abort();
    this.reconnectController = null;
  }

  private async disposeTransportAttempt(transport: TransportAdapter): Promise<void> {
    this.pendingTransportUnsubscribe?.();
    this.pendingTransportUnsubscribe = null;
    await transport.disconnect().catch(() => {
      return undefined;
    });
  }

  private replayLocalEphemeralState(): void {
    const selfCursor = this.cursorPositions.get(this.peerId);
    if (selfCursor) {
      this.sendSignal({
        type: 'cursor:update',
        payload: {
          cursor: selfCursor,
        },
      });
    }

    const selfAwareness = this.awarenessByPeer.get(this.peerId);
    if (selfAwareness && this.hasReplayableAwareness(selfAwareness)) {
      this.sendSignal({
        type: 'awareness:update',
        payload: {
          awareness: selfAwareness,
        },
      });
    }
  }

  private startPresenceHeartbeat(): void {
    this.stopPresenceHeartbeat();
    this.presenceHeartbeat = globalThis.setInterval(() => {
      this.refreshSelfPresenceLastSeen();
    }, PRESENCE_HEARTBEAT_MS);
  }

  private stopPresenceHeartbeat(): void {
    if (this.presenceHeartbeat === null) {
      return;
    }

    globalThis.clearInterval(this.presenceHeartbeat);
    this.presenceHeartbeat = null;
  }

  private notifyPeerSubscribers(): void {
    const snapshot = this.getSelfAndPeersSnapshot();
    for (const subscriber of this.peerSubscribers) {
      subscriber(snapshot);
    }
  }

  private handlePeerRegistryJoin(peer: Peer<TPresence>): void {
    this.roomEventEmitter.emit('peer:join', peer);

    if (this.maxPeers !== undefined && this.peerRegistry.getRemoteCount() + 1 >= this.maxPeers) {
      this.roomEventEmitter.emit('room:full', undefined);
    }
  }

  private emitRoomError(error: FlockError): void {
    logRoomError(this.options.debug, error);
    this.roomEventEmitter.emit('error', error);
  }

  private handlePeerRegistryUpdate(peer: Peer<TPresence>): void {
    this.roomEventEmitter.emit('peer:update', peer);
  }

  private handlePeerRegistryLeave(peer: Peer<TPresence>): void {
    this.cursorPositions.delete(peer.id);
    this.awarenessByPeer.delete(peer.id);

    this.roomEventEmitter.emit('peer:leave', peer);

    if (this.peerRegistry.getRemoteCount() === 0) {
      this.roomEventEmitter.emit('room:empty', undefined);
    }

    this.notifyCursorSubscribers();
    this.notifyAwarenessSubscribers();
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
      payload: { cursor: next },
    });
    this.notifyCursorSubscribers();
  }

  private notifyCursorSubscribers(): void {
    const positions = Array.from(this.cursorPositions.values());
    for (const subscriber of this.cursorSubscribers) {
      subscriber(positions);
    }
  }

  private getAwarenessSnapshot(): AwarenessState[] {
    return Array.from(this.awarenessByPeer.values());
  }

  private getRemoteAwarenessSnapshot(): AwarenessState[] {
    return this.getAwarenessSnapshot().filter((awareness) => {
      return awareness.peerId !== this.peerId;
    });
  }

  private notifyAwarenessSubscribers(): void {
    const snapshot = this.getRemoteAwarenessSnapshot();
    for (const subscriber of this.awarenessSubscribers) {
      subscriber(snapshot);
    }
  }

  private hasReplayableAwareness(awareness: AwarenessState): boolean {
    return Object.keys(awareness).some((key) => key !== 'peerId');
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
    if (typeof peer.name === 'string' && peer.name.trim().length > 0) {
      return peer.name;
    }

    const value = readString(peer, 'name');
    if (value && value.trim().length > 0) {
      return value;
    }

    return peer.id;
  }

  private getPeerColor(peer: Peer<TPresence>): string {
    if (typeof peer.color === 'string' && peer.color.trim().length > 0) {
      return peer.color;
    }

    const value = readString(peer, 'color');
    if (value && value.trim().length > 0) {
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
