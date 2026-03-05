import { describe, expect, it, vi } from 'vitest';

import { createRoom } from './index';

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

describe('Room events', () => {
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

  it('handles unload by disconnecting and propagating peer leave', async () => {
    const originalWindow = globalThis.window;
    const windowA = new MockWindowEventTarget();
    const windowB = new MockWindowEventTarget();

    let roomA:
      | ReturnType<typeof createRoom<{ name: string }>>
      | null = null;
    let roomB:
      | ReturnType<typeof createRoom<{ name: string }>>
      | null = null;

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
    const offReaction = eventsA.on<{ emoji: string }>('reaction', onReaction);

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
    const offWhisper = eventsA.on<{ text: string }>('whisper', onWhisper);

    eventsB.emitTo(roomA.peerId, 'whisper', { text: 'hello' });
    await waitFor(() => onWhisper.mock.calls.length === 1);

    offReaction();
    offWhisper();
    await roomA.disconnect();
    await roomB.disconnect();
  });
});
