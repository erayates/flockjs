import { describe, expect, it, vi } from 'vitest';

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
