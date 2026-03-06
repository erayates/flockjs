import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAwarenessEngine } from './engines/awareness';
import { createCursorEngine } from './engines/cursors';
import { createPresenceEngine } from './engines/presence';
import { createStateEngine } from './engines/state';
import { createRoom } from './index';
import {
  createBroadcastTransportAdapter,
  isBroadcastChannelAvailable,
} from './transports/broadcast';
import { createInMemoryTransportAdapter } from './transports/in-memory';
import { selectTransportAdapter } from './transports/select-transport';
import type { TransportAdapter, TransportSignal } from './transports/transport';
import { getTransportProtocolCapabilities } from './transports/transport.protocol';

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

  public readonly sentSignals: TransportSignal[] = [];

  private handler: ((signal: TransportSignal) => void) | null = null;

  public async connect(): Promise<void> {}

  public async disconnect(): Promise<void> {}

  public send(signal: TransportSignal): void {
    this.sentSignals.push(signal);
  }

  public broadcast(signal: TransportSignal): void {
    this.sentSignals.push(signal);
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

describe('Engine helpers and transport adapters', () => {
  it('state engine supports set, patch, subscribe, undo and reset', () => {
    const state = createStateEngine({
      initialValue: {
        count: 0,
        label: 'initial',
      },
    });

    const subscriber = vi.fn();
    const unsubscribe = state.subscribe(subscriber);

    state.set({ count: 1, label: 'set' });
    state.patch({ label: 'patched' });
    state.undo();
    state.reset();

    expect(state.get()).toEqual({ count: 0, label: 'initial' });
    expect(subscriber).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it('awareness, cursor and presence engines proxy context behavior', () => {
    const awarenessContext = {
      updateSelfAwareness: vi.fn(),
      getAllAwareness: vi.fn(() => [{ peerId: 'p1' }]),
      subscribeAwareness: vi.fn((cb: (peers: Array<{ peerId: string }>) => void) => {
        cb([{ peerId: 'p1' }]);
        return () => {
          return undefined;
        };
      }),
    };

    const awareness = createAwarenessEngine(awarenessContext);
    awareness.set({ typing: true });
    awareness.setTyping(false);
    awareness.setFocus('el');
    awareness.setSelection({ from: 1, to: 2, elementId: 'el' });

    const awarenessSub = vi.fn();
    awareness.subscribe(awarenessSub);
    expect(awareness.getAll()).toEqual([{ peerId: 'p1' }]);

    const cursorContext = {
      setSelfPosition: vi.fn(),
      getPositions: vi.fn(() => []),
      subscribe: vi.fn((cb: (positions: unknown[]) => void) => {
        cb([]);
        return () => {
          return undefined;
        };
      }),
    };

    const cursorEngine = createCursorEngine(cursorContext, {
      throttleMs: 16,
    });
    cursorEngine.render({ style: 'default' });
    cursorEngine.mount({} as HTMLElement);
    cursorEngine.render({ style: 'default' });
    cursorEngine.setPosition({ x: 1, y: 2 });
    cursorEngine.subscribe(() => {
      return undefined;
    });
    cursorEngine.unmount();

    const presenceContext = {
      updateSelf: vi.fn(),
      replaceSelf: vi.fn(),
      getSelf: vi.fn(() => ({ id: 'self', joinedAt: 1, lastSeen: 1 })),
      getPeer: vi.fn(() => null),
      getAllPeers: vi.fn(() => []),
      subscribe: vi.fn((cb: (peers: unknown[]) => void) => {
        cb([]);
        return () => {
          return undefined;
        };
      }),
    };

    const presence = createPresenceEngine(presenceContext);
    presence.update({ name: 'alice' });
    presence.replace({ name: 'bob' });
    presence.subscribe(() => {
      return undefined;
    });
    presence.get('none');
    presence.getAll();
    presence.getSelf();

    expect(awarenessContext.updateSelfAwareness).toHaveBeenCalled();
    expect(cursorContext.setSelfPosition).toHaveBeenCalled();
    expect(presenceContext.updateSelf).toHaveBeenCalled();
  });

  it('transport adapters send and receive baseline messages', async () => {
    const inMemoryProtocol = getTransportProtocolCapabilities('in-memory');
    const broadcastProtocol = getTransportProtocolCapabilities('broadcast');
    const inMemoryA = createInMemoryTransportAdapter('room-adapter', 'a');
    const inMemoryB = createInMemoryTransportAdapter('room-adapter', 'b');

    const listener = vi.fn();
    inMemoryB.onMessage(listener);

    await inMemoryA.connect();
    await inMemoryB.connect();

    inMemoryA.send({
      type: 'hello',
      roomId: 'room-adapter',
      fromPeerId: 'a',
      timestamp: 1,
      payload: {
        peer: {
          id: 'a',
          joinedAt: 1,
          lastSeen: 1,
        },
        protocol: inMemoryProtocol,
      },
    });

    await waitFor(() => listener.mock.calls.length > 0);

    await inMemoryA.disconnect();
    await inMemoryB.disconnect();

    if (isBroadcastChannelAvailable()) {
      const broadcastA = createBroadcastTransportAdapter('room-broadcast-adapter');
      const broadcastB = createBroadcastTransportAdapter('room-broadcast-adapter');
      const onMessage = vi.fn();
      broadcastB.onMessage(onMessage);
      await broadcastA.connect();
      await broadcastB.connect();
      broadcastA.send({
        type: 'hello',
        roomId: 'room-broadcast-adapter',
        fromPeerId: 'a',
        timestamp: 1,
        payload: {
          peer: {
            id: 'a',
            joinedAt: 1,
            lastSeen: 1,
          },
          protocol: broadcastProtocol,
        },
      });
      await waitFor(() => onMessage.mock.calls.length > 0);
      await broadcastA.disconnect();
      await broadcastB.disconnect();
    }

    expect(() => {
      selectTransportAdapter('r', 'p', { transport: 'websocket' });
    }).toThrow(/requires `relayUrl`/i);
  });
});

describe('Room engine integration branches', () => {
  it('covers awareness, cursors, state, events and maxPeers lifecycle paths', async () => {
    const roomA = createRoom<{ name: string; role: 'editor' | 'viewer' }>(
      'room-engine-integration',
      {
        transport: 'broadcast',
        maxPeers: 2,
        presence: { name: 'A', role: 'editor' },
      },
    );
    const roomB = createRoom<{ name: string; role: 'editor' | 'viewer' }>(
      'room-engine-integration',
      {
        transport: 'broadcast',
        presence: { name: 'B', role: 'viewer' },
      },
    );

    const roomFull = vi.fn();
    const roomEmpty = vi.fn();
    roomA.on('room:full', roomFull);
    roomA.on('room:empty', roomEmpty);

    await roomA.connect();
    await roomB.connect();
    await roomA.connect();

    await waitFor(() => roomA.peerCount === 1);
    expect(roomFull).toHaveBeenCalled();

    const awarenessA = roomA.useAwareness();
    const awarenessSeen = vi.fn();
    awarenessA.subscribe(awarenessSeen);

    const awarenessB = roomB.useAwareness();
    awarenessB.set({ typing: true });
    awarenessB.setTyping(true);
    awarenessB.setFocus('input-1');
    awarenessB.setSelection({ from: 0, to: 1, elementId: 'input-1' });

    await waitFor(() => awarenessA.getAll().some((item) => item.peerId === roomB.peerId));

    const cursorsA = roomA.useCursors();
    const cursorSeen = vi.fn();
    cursorsA.subscribe(cursorSeen);

    roomB.useCursors().setPosition({ x: 0.25, y: 0.75 });
    await waitFor(() =>
      cursorsA.getPositions().some((position) => position.userId === roomB.peerId),
    );

    const state = roomA.useState({
      initialValue: { count: 0 },
    });
    const stateSeen = vi.fn();
    state.subscribe(stateSeen);
    state.set({ count: 1 });
    state.patch({ count: 2 });
    state.undo();
    state.reset();
    expect(state.get()).toEqual({ count: 0 });
    expect(stateSeen).toHaveBeenCalled();

    const eventsA = roomA.useEvents({ loopback: false });
    const onMessage = vi.fn();
    eventsA.on('message', onMessage);

    roomA.useEvents({ loopback: false }).emit('message', { text: 'self' });
    await wait(20);
    expect(onMessage).toHaveBeenCalledTimes(0);

    roomB.useEvents().emitTo(roomA.peerId, 'message', { text: 'hello' });
    await waitFor(() => onMessage.mock.calls.length === 1);

    roomB.usePresence().replace({ name: 'B2', role: 'editor' });
    await waitFor(() => roomA.peers[0]?.name === 'B2');

    await roomB.disconnect();
    await waitFor(() => roomA.peerCount === 0);
    expect(roomEmpty).toHaveBeenCalled();

    await roomA.disconnect();

    const roomC = createRoom('room-disconnect-idle', {
      transport: 'broadcast',
    });
    await roomC.disconnect();
    expect(roomC.status).toBe('disconnected');
  });
});

describe('Room engines across reconnect', () => {
  it('keeps engine instances and local state usable after reconnect', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.resetModules();

    const initialAdapter = new MockReconnectTransportAdapter();
    const reconnectAdapter = new MockReconnectTransportAdapter();
    const adapters = [initialAdapter, reconnectAdapter];

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
    const room = mod.createRoom<{ name: string }>('room-engines-reconnect', {
      transport: 'websocket',
      relayUrl: 'ws://relay.local',
      reconnect: true,
      presence: {
        name: 'Alice',
      },
    });

    const awareness = room.useAwareness();
    const cursors = room.useCursors();
    const state = room.useState({
      initialValue: {
        count: 0,
      },
    });
    const events = room.useEvents();
    const onMessage = vi.fn();
    events.on('message', onMessage);

    awareness.set({
      typing: true,
    });
    cursors.setPosition({
      x: 0.5,
      y: 0.25,
    });
    state.set({
      count: 3,
    });

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

    expect(state.get()).toEqual({
      count: 3,
    });

    const replayedTypes = reconnectAdapter.sentSignals.map((signal) => signal.type);
    expect(replayedTypes).toContain('hello');
    expect(replayedTypes).toContain('cursor:update');
    expect(replayedTypes).toContain('awareness:update');

    reconnectAdapter.emit({
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

    reconnectAdapter.emit({
      type: 'event',
      roomId: room.id,
      fromPeerId: 'peer-b',
      timestamp: 1,
      payload: {
        name: 'message',
        payload: {
          text: 'hello',
        },
      },
    });

    await waitFor(() => onMessage.mock.calls.length === 1);

    expect(onMessage).toHaveBeenCalledWith(
      {
        text: 'hello',
      },
      expect.objectContaining({
        id: 'peer-b',
      }),
    );

    await room.disconnect();
  });
});
