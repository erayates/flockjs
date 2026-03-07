import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRoom } from './index';

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const waitFor = async (condition: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition.');
    }

    await wait(10);
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Room CRDT/Yjs', () => {
  it('returns singleton Y.Doc/provider instances and emits provider lifecycle events', async () => {
    const room = createRoom<{ name: string; color: string }>('room-crdt-provider', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
        color: '#111111',
      },
    });

    const doc = room.getYDoc();
    const provider = room.getYProvider();
    const onStatus = vi.fn();
    const onSync = vi.fn();

    provider.on('status', onStatus);
    provider.on('sync', onSync);

    expect(room.getYDoc()).toBe(doc);
    expect(room.getYProvider()).toBe(provider);
    expect(provider.doc).toBe(doc);
    expect(provider.awareness.getLocalState()).toMatchObject({
      peerId: room.peerId,
      name: 'Alice',
      color: '#111111',
      user: {
        id: room.peerId,
        name: 'Alice',
        color: '#111111',
      },
    });

    await provider.connect();
    await waitFor(() => provider.synced);

    expect(provider.status).toBe('connected');
    expect(onStatus).toHaveBeenCalledWith({ status: 'connected' });
    expect(onSync).toHaveBeenCalledWith({ synced: true });

    await provider.disconnect();

    expect(provider.status).toBe('disconnected');
    expect(onStatus).toHaveBeenCalledWith({ status: 'disconnected' });
  });

  it('supports CRDT-backed state engine operations and local undo across peers', async () => {
    const roomA = createRoom<{ name: string }>('room-crdt-state', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
      },
    });
    const roomB = createRoom<{ name: string }>('room-crdt-state', {
      transport: 'broadcast',
      presence: {
        name: 'Bob',
      },
    });

    const stateA = roomA.useState({
      initialValue: {
        count: 0,
        nested: {
          label: 'initial',
        },
      },
      strategy: 'crdt',
    });
    const stateB = roomB.useState({
      initialValue: {
        count: 0,
        nested: {
          label: 'initial',
        },
      },
      strategy: 'crdt',
    });
    const seenByB = vi.fn();
    stateB.subscribe(seenByB);

    await roomA.connect();
    await roomB.connect();
    await waitFor(() => roomA.peerCount === 1 && roomB.peerCount === 1);
    await waitFor(() => roomA.getYProvider().synced && roomB.getYProvider().synced);

    stateA.set({
      count: 1,
      nested: {
        label: 'set',
      },
    });
    await waitFor(() => stateB.get().count === 1);

    stateA.undo();
    await waitFor(() => stateB.get().count === 0);

    stateB.patch({
      nested: {
        label: 'patched',
      },
    });
    await waitFor(() => stateA.get().nested.label === 'patched');

    stateA.reset();
    await waitFor(() => stateB.get().nested.label === 'initial');

    expect(
      seenByB.mock.calls.some((call) => {
        return call[1]?.changedBy === roomA.peerId && call[1]?.reason === 'set';
      }),
    ).toBe(true);
    expect(
      seenByB.mock.calls.some((call) => {
        return call[1]?.changedBy === roomA.peerId && call[1]?.reason === 'undo';
      }),
    ).toBe(true);

    await roomA.disconnect();
    await roomB.disconnect();
  });

  it('syncs Y.Text, Y.Array, and Y.Map changes across 3 peers and late joiners', async () => {
    const roomA = createRoom('room-crdt-doc', {
      transport: 'broadcast',
    });
    const roomB = createRoom('room-crdt-doc', {
      transport: 'broadcast',
    });
    const roomC = createRoom('room-crdt-doc', {
      transport: 'broadcast',
    });

    const docA = roomA.getYDoc();
    const docB = roomB.getYDoc();
    const docC = roomC.getYDoc();

    await roomA.connect();
    await roomB.connect();
    await roomC.connect();
    await waitFor(() => roomA.peerCount === 2 && roomB.peerCount === 2 && roomC.peerCount === 2);

    const textA = docA.getText('content');
    const textB = docB.getText('content');
    const textC = docC.getText('content');
    const arrayA = docA.getArray<string>('items');
    const arrayB = docB.getArray<string>('items');
    const arrayC = docC.getArray<string>('items');
    const mapA = docA.getMap<number>('meta');
    const mapB = docB.getMap<number>('meta');
    const mapC = docC.getMap<number>('meta');

    textA.insert(0, 'A');
    textB.insert(0, 'B');
    textC.insert(0, 'C');
    arrayA.push(['alpha']);
    arrayB.push(['beta']);
    arrayC.push(['gamma']);
    mapA.set('a', 1);
    mapB.set('b', 2);
    mapC.set('c', 3);

    await waitFor(() => {
      return (
        textA.toJSON().length === 3 &&
        textB.toJSON().length === 3 &&
        textC.toJSON().length === 3 &&
        arrayA.length === 3 &&
        arrayB.length === 3 &&
        arrayC.length === 3 &&
        mapA.size === 3 &&
        mapB.size === 3 &&
        mapC.size === 3
      );
    });

    expect(textA.toJSON().split('').sort()).toEqual(['A', 'B', 'C']);
    expect(textB.toJSON().split('').sort()).toEqual(['A', 'B', 'C']);
    expect(textC.toJSON().split('').sort()).toEqual(['A', 'B', 'C']);
    expect(arrayA.toArray().slice().sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(arrayB.toArray().slice().sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(arrayC.toArray().slice().sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(mapA.toJSON()).toEqual({ a: 1, b: 2, c: 3 });
    expect(mapB.toJSON()).toEqual({ a: 1, b: 2, c: 3 });
    expect(mapC.toJSON()).toEqual({ a: 1, b: 2, c: 3 });

    const lateRoom = createRoom('room-crdt-doc', {
      transport: 'broadcast',
    });
    const lateDoc = lateRoom.getYDoc();
    await lateRoom.connect();

    await waitFor(() => {
      return (
        lateDoc.getText('content').toJSON().length === 3 &&
        lateDoc.getArray('items').length === 3 &&
        lateDoc.getMap('meta').size === 3
      );
    });

    expect(lateDoc.getText('content').toJSON().split('').sort()).toEqual(['A', 'B', 'C']);
    expect(lateDoc.getArray('items').toArray().slice().sort()).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(lateDoc.getMap('meta').toJSON()).toEqual({ a: 1, b: 2, c: 3 });

    await lateRoom.disconnect();
    await roomA.disconnect();
    await roomB.disconnect();
    await roomC.disconnect();
  });

  it('shares awareness state between room awareness and the Yjs provider', async () => {
    const roomA = createRoom<{ name: string; color: string }>('room-crdt-awareness', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
        color: '#ff0000',
      },
    });
    const roomB = createRoom<{ name: string; color: string }>('room-crdt-awareness', {
      transport: 'broadcast',
      presence: {
        name: 'Bob',
        color: '#00ff00',
      },
    });

    const providerA = roomA.getYProvider();
    const providerB = roomB.getYProvider();
    const awarenessA = roomA.useAwareness();
    const awarenessB = roomB.useAwareness();

    await roomA.connect();
    await roomB.connect();
    await waitFor(() => roomA.peerCount === 1 && roomB.peerCount === 1);

    awarenessA.set({
      typing: true,
      focus: 'editor-a',
    });

    await waitFor(() => {
      return awarenessB.getAll().some((state) => {
        return state.peerId === roomA.peerId && state.typing === true && state.focus === 'editor-a';
      });
    });

    expect(providerA.awareness.getLocalState()).toMatchObject({
      peerId: roomA.peerId,
      typing: true,
      focus: 'editor-a',
    });

    providerB.awareness.setLocalStateField('selection', {
      from: 1,
      to: 3,
      elementId: 'editor-b',
    });

    await waitFor(() => {
      return awarenessA.getAll().some((state) => {
        return (
          state.peerId === roomB.peerId &&
          state.selection &&
          typeof state.selection === 'object' &&
          state.selection.elementId === 'editor-b'
        );
      });
    });

    await roomA.disconnect();
    await roomB.disconnect();
  });
});
