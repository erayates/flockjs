import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFlockError } from './flock-error';
import { createRoom } from './index';
import type { TransportAdapter, TransportSignal } from './transports/transport';

type WindowListener = (...args: unknown[]) => void;

class MockWindowEventTarget {
  private readonly listeners = new Map<string, Set<WindowListener>>();

  addEventListener(eventName: string, listener: WindowListener): void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<WindowListener>();
    eventListeners.add(listener);
    this.listeners.set(eventName, eventListeners);
  }

  removeEventListener(eventName: string, listener: WindowListener): void {
    const eventListeners = this.listeners.get(eventName);
    if (!eventListeners) {
      return;
    }

    eventListeners.delete(listener);
    if (eventListeners.size === 0) {
      this.listeners.delete(eventName);
    }
  }

  dispatch(eventName: string): void {
    const eventListeners = this.listeners.get(eventName);
    if (!eventListeners) {
      return;
    }

    for (const listener of eventListeners) {
      listener({ type: eventName });
    }
  }

  getListenerCount(eventName: string): number {
    return this.listeners.get(eventName)?.size ?? 0;
  }
}

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const waitFor = async (condition: () => boolean, timeoutMs = 1_500): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition.');
    }

    await wait(10);
  }
};

class MockReconnectTransportAdapter implements TransportAdapter {
  public readonly kind = 'websocket' as const;

  private handler: ((signal: TransportSignal) => void) | null = null;

  public constructor(
    private readonly connectBehavior: () => Promise<void> = async () => {
      return undefined;
    },
  ) {}

  public async connect(): Promise<void> {
    await this.connectBehavior();
  }

  public async disconnect(): Promise<void> {}

  public send(signal: TransportSignal): void {
    void signal;
  }

  public broadcast(signal: TransportSignal): void {
    void signal;
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

afterEach(() => {
  vi.doUnmock('./transports/select-transport');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function createMockReconnectRoom(
  createAdapter: () => MockReconnectTransportAdapter,
): Promise<ReturnType<typeof createRoom>> {
  vi.resetModules();
  vi.doMock('./transports/select-transport', () => ({
    selectTransportAdapter: () => {
      return createAdapter();
    },
  }));

  const mod = await import('./index');
  return mod.createRoom('room-auto-reconnect-events', {
    transport: 'websocket',
    relayUrl: 'ws://relay.local',
    reconnect: true,
  });
}

describe('Room events', () => {
  it('isolates throwing room event callbacks', async () => {
    const room = createRoom('room-event-isolation', {
      transport: 'broadcast',
    });

    const failingCallback = vi.fn(() => {
      throw new Error('callback failure');
    });
    const healthyCallback = vi.fn();

    room.on('connected', failingCallback);
    room.on('connected', healthyCallback);

    await room.connect();

    expect(failingCallback).toHaveBeenCalledTimes(1);
    expect(healthyCallback).toHaveBeenCalledTimes(1);

    await room.disconnect();
  });

  it('supports on/off with unsubscribe for room lifecycle events', async () => {
    const room = createRoom('room-event-pattern', {
      transport: 'broadcast',
    });

    const onConnected = vi.fn();
    const unsubscribe = room.on('connected', onConnected);

    await room.connect();
    expect(onConnected).toHaveBeenCalledTimes(1);

    room.off('connected', onConnected);
    await room.disconnect();
    await room.connect();
    expect(onConnected).toHaveBeenCalledTimes(1);

    unsubscribe();
    await room.disconnect();
  });

  it('emits reconnecting on subsequent connect attempts after a disconnect', async () => {
    const room = createRoom('room-reconnect-event', {
      transport: 'broadcast',
    });

    const onReconnecting = vi.fn();
    room.on('reconnecting', onReconnecting);

    await room.connect();
    await room.disconnect();
    await room.connect();

    expect(onReconnecting).toHaveBeenCalledTimes(1);
    expect(onReconnecting).toHaveBeenCalledWith({ attempt: 1 });

    await room.disconnect();
  });

  it('emits reconnecting and connected during successful automatic reconnect', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const initialAdapter = new MockReconnectTransportAdapter();
    const reconnectAdapter = new MockReconnectTransportAdapter();
    const adapters = [initialAdapter, reconnectAdapter];
    const room = await createMockReconnectRoom(() => {
      const adapter = adapters.shift();
      if (!adapter) {
        throw new Error('Expected queued adapter.');
      }

      return adapter;
    });

    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    const onReconnecting = vi.fn();
    room.on('connected', onConnected);
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

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);

    expect(onReconnecting).toHaveBeenCalledWith({ attempt: 1 });
    expect(onConnected).toHaveBeenCalledTimes(2);
    expect(onDisconnected).not.toHaveBeenCalled();

    vi.doUnmock('./transports/select-transport');
    vi.resetModules();
    await room.disconnect();
  });

  it('emits terminal error and disconnected after automatic reconnect is exhausted', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const initialAdapter = new MockReconnectTransportAdapter();
    const failedAttemptOne = new MockReconnectTransportAdapter(async () => {
      throw createFlockError('NETWORK_ERROR', 'attempt-one-failed', false);
    });
    const failedAttemptTwo = new MockReconnectTransportAdapter(async () => {
      throw createFlockError('NETWORK_ERROR', 'attempt-two-failed', false);
    });
    const adapters = [initialAdapter, failedAttemptOne, failedAttemptTwo];

    vi.resetModules();
    vi.doMock('./transports/select-transport', () => ({
      selectTransportAdapter: () => {
        const adapter = adapters.shift();
        if (!adapter) {
          throw new Error('Expected queued adapter.');
        }

        return adapter;
      },
    }));

    const mod = await import('./index');
    const room = mod.createRoom('room-auto-reconnect-events', {
      transport: 'websocket',
      relayUrl: 'ws://relay.local',
      reconnect: {
        maxAttempts: 2,
      },
    });

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

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onReconnecting).toHaveBeenNthCalledWith(1, { attempt: 1 });
    expect(onReconnecting).toHaveBeenNthCalledWith(2, { attempt: 2 });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith({
      reason: 'reconnect-exhausted',
    });
  });

  it('handles unload by disconnecting and propagating peer leave', async () => {
    const originalWindow = globalThis.window;
    const windowA = new MockWindowEventTarget();
    const windowB = new MockWindowEventTarget();

    let roomA: ReturnType<typeof createRoom<{ name: string }>> | null = null;
    let roomB: ReturnType<typeof createRoom<{ name: string }>> | null = null;

    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: windowA as unknown as Window,
      });

      roomA = createRoom<{ name: string }>('room-unload-behavior', {
        transport: 'broadcast',
        presence: { name: 'Alice' },
      });
      await roomA.connect();
      await roomA.connect();

      expect(windowA.getListenerCount('beforeunload')).toBe(1);
      expect(windowA.getListenerCount('pagehide')).toBe(1);

      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: windowB as unknown as Window,
      });

      roomB = createRoom<{ name: string }>('room-unload-behavior', {
        transport: 'broadcast',
        presence: { name: 'Bob' },
      });

      const onPeerLeave = vi.fn();
      roomB.on('peer:leave', onPeerLeave);
      await roomB.connect();

      expect(windowB.getListenerCount('beforeunload')).toBe(1);
      expect(windowB.getListenerCount('pagehide')).toBe(1);

      await waitFor(() => roomA?.peerCount === 1 && roomB?.peerCount === 1);

      windowA.dispatch('beforeunload');

      await waitFor(() => roomA?.status === 'disconnected');
      await waitFor(() => roomB?.peerCount === 0);

      expect(onPeerLeave).toHaveBeenCalledTimes(1);
      expect(windowA.getListenerCount('beforeunload')).toBe(0);
      expect(windowA.getListenerCount('pagehide')).toBe(0);

      await roomB.disconnect();
      expect(windowB.getListenerCount('beforeunload')).toBe(0);
      expect(windowB.getListenerCount('pagehide')).toBe(0);
    } finally {
      await roomA?.disconnect();
      await roomB?.disconnect();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
    }
  });

  it('emits and receives room events via useEvents()', async () => {
    const roomA = createRoom<{ name: string }>('room-events-engine', {
      transport: 'broadcast',
      presence: { name: 'Alice' },
    });
    const roomB = createRoom<{ name: string }>('room-events-engine', {
      transport: 'broadcast',
      presence: { name: 'Bob' },
    });

    await roomA.connect();
    await roomB.connect();
    await waitFor(() => roomA.peerCount === 1 && roomB.peerCount === 1);

    const eventsA = roomA.useEvents();
    const eventsB = roomB.useEvents();

    const onReaction = vi.fn();
    const offReaction = eventsA.on('reaction', onReaction);

    eventsB.emit('reaction', { emoji: '🔥' });
    await waitFor(() => onReaction.mock.calls.length === 1);

    expect(onReaction).toHaveBeenCalledWith(
      { emoji: '🔥' },
      expect.objectContaining({
        id: roomB.peerId,
        name: 'Bob',
      }),
    );

    const onWhisper = vi.fn();
    const offWhisper = eventsA.on('whisper', onWhisper);

    eventsB.emitTo(roomA.peerId, 'whisper', { text: 'hello' });
    await waitFor(() => onWhisper.mock.calls.length === 1);

    offReaction();
    offWhisper();
    await roomA.disconnect();
    await roomB.disconnect();
  });
});
