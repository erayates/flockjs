import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlockError } from './flock-error';
import type { TransportAdapter, TransportSignal } from './transports/transport';
import type { Room, RoomOptions } from './types';

type AdapterFactory = () => ControlledTransportAdapter;

class ControlledTransportAdapter implements TransportAdapter {
  public readonly kind = 'websocket' as const;

  public connectCalls = 0;

  public disconnectCalls = 0;

  public readonly sentSignals: TransportSignal[] = [];

  public readonly broadcastSignals: TransportSignal[] = [];

  private handler: ((signal: TransportSignal) => void) | null = null;

  public constructor(
    private readonly connectBehavior: () => Promise<void> = async () => {
      return undefined;
    },
  ) {}

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    await this.connectBehavior();
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  public send(signal: TransportSignal): void {
    this.sentSignals.push(signal);
  }

  public broadcast(signal: TransportSignal): void {
    this.broadcastSignals.push(signal);
  }

  public onMessage(handler: (signal: TransportSignal) => void): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) {
        this.handler = null;
      }
    };
  }

  public emit(signal: TransportSignal): void {
    this.handler?.(signal);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function createReconnectRoom<TPresence extends Record<string, unknown>>(
  adapterFactory: AdapterFactory,
  options: RoomOptions<TPresence>,
): Promise<Room<TPresence>> {
  vi.resetModules();
  vi.doMock('./transports/select-transport', () => ({
    selectTransportAdapter: () => {
      return adapterFactory();
    },
  }));

  const mod = await import('./index');
  return mod.createRoom<TPresence>('room-reconnect', options);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  vi.doUnmock('./transports/select-transport');
  vi.restoreAllMocks();
  vi.useRealTimers();
  await flushMicrotasks();
});

describe('Room auto reconnect', () => {
  it('reconnects after an unexpected disconnect and replays local ephemeral state', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const initialAdapter = new ControlledTransportAdapter();
    const reconnectAdapter = new ControlledTransportAdapter();
    const adapters = [initialAdapter, reconnectAdapter];
    const room = await createReconnectRoom<{ name: string }>(
      () => {
        const adapter = adapters.shift();
        if (!adapter) {
          throw new Error('Expected queued adapter.');
        }

        return adapter;
      },
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
        reconnect: true,
        presence: { name: 'Alice' },
      },
    );

    const onConnected = vi.fn();
    const onReconnecting = vi.fn();
    const onDisconnected = vi.fn();
    const onPeerJoin = vi.fn();
    const onPeerLeave = vi.fn();
    room.on('connected', onConnected);
    room.on('reconnecting', onReconnecting);
    room.on('disconnected', onDisconnected);
    room.on('peer:join', onPeerJoin);
    room.on('peer:leave', onPeerLeave);

    const awareness = room.useAwareness();
    const cursors = room.useCursors();
    const state = room.useState({
      initialValue: {
        count: 0,
      },
    });

    awareness.setTyping(true);
    cursors.setPosition({ x: 0.25, y: 0.75 });
    state.set({ count: 2 });
    expect(cursors.getPositions()).toEqual([]);

    await room.connect();

    initialAdapter.emit({
      type: 'hello',
      roomId: room.id,
      fromPeerId: 'peer-b',
      payload: {
        peer: {
          id: 'peer-b',
          joinedAt: 1,
          lastSeen: 1,
          name: 'Bob',
        },
      },
    });
    expect(room.peerCount).toBe(1);

    initialAdapter.emit({
      type: 'transport:disconnected',
      roomId: room.id,
      fromPeerId: room.peerId,
      payload: {
        reason: 'socket-gone',
      },
    });

    await flushMicrotasks();

    expect(room.status).toBe('reconnecting');
    expect(onReconnecting).toHaveBeenCalledWith({ attempt: 1 });
    expect(onDisconnected).not.toHaveBeenCalled();

    const reconnectPromise = room.connect();
    expect(room.connect()).toBe(reconnectPromise);

    await vi.advanceTimersByTimeAsync(99);
    expect(reconnectAdapter.connectCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await reconnectPromise;

    expect(room.status).toBe('connected');
    expect(onConnected).toHaveBeenCalledTimes(2);
    expect(room.peerCount).toBe(1);
    expect(state.get()).toEqual({ count: 2 });

    const reconnectSignalTypes = reconnectAdapter.broadcastSignals.map((signal) => signal.type);
    expect(reconnectSignalTypes).toContain('hello');
    expect(reconnectSignalTypes).toContain('cursor:update');
    expect(reconnectSignalTypes).toContain('awareness:update');
    expect(reconnectSignalTypes).toContain('state:update');

    reconnectAdapter.emit({
      type: 'hello',
      roomId: room.id,
      fromPeerId: 'peer-b',
      payload: {
        peer: {
          id: 'peer-b',
          joinedAt: 1,
          lastSeen: 2,
          name: 'Bob',
        },
      },
    });

    await vi.advanceTimersByTimeAsync(5_000);

    expect(room.peerCount).toBe(1);
    expect(onPeerJoin).toHaveBeenCalledTimes(1);
    expect(onPeerLeave).not.toHaveBeenCalled();

    await room.disconnect();
  });

  it('cancels reconnect retries when disconnect is called during backoff', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const initialAdapter = new ControlledTransportAdapter();
    const reconnectAdapter = new ControlledTransportAdapter();
    const adapters = [initialAdapter, reconnectAdapter];
    const room = await createReconnectRoom(
      () => {
        const adapter = adapters.shift();
        if (!adapter) {
          throw new Error('Expected queued adapter.');
        }

        return adapter;
      },
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
        reconnect: true,
      },
    );

    const onDisconnected = vi.fn();
    const onConnected = vi.fn();
    room.on('disconnected', onDisconnected);
    room.on('connected', onConnected);

    await room.connect();

    initialAdapter.emit({
      type: 'transport:disconnected',
      roomId: room.id,
      fromPeerId: room.peerId,
      payload: {
        reason: 'socket-gone',
      },
    });

    await flushMicrotasks();
    await room.disconnect();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(room.status).toBe('disconnected');
    expect(reconnectAdapter.connectCalls).toBe(0);
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith({ reason: 'manual' });
  });

  it('emits a terminal reconnect error and disconnected after max attempts are exhausted', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const initialAdapter = new ControlledTransportAdapter();
    const failedAttemptOne = new ControlledTransportAdapter(async () => {
      throw createFlockError('NETWORK_ERROR', 'attempt-one-failed', false);
    });
    const failedAttemptTwo = new ControlledTransportAdapter(async () => {
      throw createFlockError('NETWORK_ERROR', 'attempt-two-failed', false);
    });
    const adapters = [initialAdapter, failedAttemptOne, failedAttemptTwo];
    const room = await createReconnectRoom(
      () => {
        const adapter = adapters.shift();
        if (!adapter) {
          throw new Error('Expected queued adapter.');
        }

        return adapter;
      },
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
        reconnect: {
          maxAttempts: 2,
        },
      },
    );

    const onError = vi.fn();
    const onDisconnected = vi.fn();
    const onReconnecting = vi.fn();
    room.on('error', onError);
    room.on('disconnected', onDisconnected);
    room.on('reconnecting', onReconnecting);

    await room.connect();

    initialAdapter.emit({
      type: 'transport:disconnected',
      roomId: room.id,
      fromPeerId: room.peerId,
      payload: {
        reason: 'socket-gone',
      },
    });

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    expect(onReconnecting).toHaveBeenNthCalledWith(1, { attempt: 1 });
    expect(onReconnecting).toHaveBeenNthCalledWith(2, { attempt: 2 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NETWORK_ERROR',
        recoverable: true,
        cause: expect.objectContaining({
          source: 'room-reconnect',
          kind: 'max-attempts-exhausted',
          attempts: 2,
          reason: 'socket-gone',
        }),
      }),
    );
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith({
      reason: 'reconnect-exhausted',
    });
    expect(room.status).toBe('disconnected');
  });
});
