import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRoom } from './index';
import { createInitialStateSnapshot, setStateSnapshot } from './internal/state';
import { createPersistedStateStorageKey } from './internal/state.persistence';
import type { TransportAdapter, TransportSignal } from './transports/transport';
import type { Room } from './types';

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

class MockTransportAdapter implements TransportAdapter {
  public readonly kind = 'webrtc' as const;

  public readonly sentSignals: TransportSignal[] = [];

  private handler: ((signal: TransportSignal) => void) | null = null;

  public connect(): Promise<void> {
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    return Promise.resolve();
  }

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

interface MockLocalStorageController {
  getItemMock: ReturnType<typeof vi.fn>;
  removeItemMock: ReturnType<typeof vi.fn>;
  setItemMock: ReturnType<typeof vi.fn>;
  storage: Storage;
  store: Map<string, string>;
}

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installMockLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

function restoreMockLocalStorage(): void {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
    return;
  }

  Reflect.deleteProperty(globalThis, 'localStorage');
}

function createMockLocalStorage(
  overrides: Partial<Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>> = {},
): MockLocalStorageController {
  const store = new Map<string, string>();
  const getItemMock = vi.fn((key: string) => {
    return store.get(key) ?? null;
  });
  const removeItemMock = vi.fn((key: string) => {
    store.delete(key);
  });
  const setItemMock = vi.fn((key: string, value: string) => {
    store.set(key, value);
  });
  const storage = {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: getItemMock,
    key: vi.fn((index: number) => {
      return Array.from(store.keys())[index] ?? null;
    }),
    removeItem: removeItemMock,
    setItem: setItemMock,
    ...overrides,
  } satisfies Storage;

  return {
    getItemMock,
    removeItemMock,
    setItemMock,
    storage,
    store,
  };
}

function readPersistedEnvelope(
  store: Map<string, string>,
  roomId: string,
): Record<string, unknown> {
  const rawValue = store.get(createPersistedStateStorageKey(roomId));
  if (!rawValue) {
    throw new Error(`Missing persisted state for room "${roomId}".`);
  }

  return JSON.parse(rawValue) as Record<string, unknown>;
}

async function createMockedRoom(
  createAdapter: () => MockTransportAdapter,
): Promise<Room<{ name: string }>> {
  vi.resetModules();
  vi.doMock('./transports/select-transport', () => ({
    selectTransportAdapter: () => {
      return createAdapter();
    },
  }));

  const mod = await import('./index');
  return mod.createRoom<{ name: string }>('room-state-mock', {
    transport: 'webrtc',
    relayUrl: 'ws://relay.local',
    presence: {
      name: 'Alice',
    },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  restoreMockLocalStorage();
  vi.doUnmock('./transports/select-transport');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Room shared state', () => {
  it('caches a singleton state engine and keeps the first initialValue', () => {
    const room = createRoom('room-state-singleton', {
      transport: 'broadcast',
    });

    const first = room.useState({
      initialValue: {
        count: 0,
      },
    });
    const second = room.useState({
      initialValue: {
        count: 999,
      },
    });

    expect(first).toBe(second);

    first.set({
      count: 3,
    });
    second.reset();

    expect(first.get()).toEqual({
      count: 0,
    });
  });

  it('syncs set, patch, late join, shared undo, and shared reset across peers', async () => {
    const roomA = createRoom<{ name: string }>('room-state-sync', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
      },
    });
    const roomB = createRoom<{ name: string }>('room-state-sync', {
      transport: 'broadcast',
      presence: {
        name: 'Bob',
      },
    });

    const stateA = roomA.useState({
      initialValue: {
        count: 0,
      },
    });
    const stateB = roomB.useState({
      initialValue: {
        count: 0,
      },
    });
    const seenByA = vi.fn();
    stateA.subscribe(seenByA);

    await roomA.connect();
    await roomB.connect();
    await waitFor(() => roomA.peerCount === 1 && roomB.peerCount === 1);

    stateA.set({
      count: 1,
    });
    await waitFor(() => stateB.get().count === 1);

    stateB.patch({
      count: 2,
    });
    await waitFor(() => stateA.get().count === 2);

    const roomLate = createRoom<{ name: string }>('room-state-sync', {
      transport: 'broadcast',
      presence: {
        name: 'Carol',
      },
    });

    await roomLate.connect();
    const lateState = roomLate.useState({
      initialValue: {
        count: 999,
      },
    });
    await waitFor(() => {
      return lateState.get().count === 2;
    }, 1_000);

    lateState.undo();
    await waitFor(() => stateA.get().count === 1 && stateB.get().count === 1);

    stateA.reset();
    await waitFor(() => {
      return stateB.get().count === 0 && lateState.get().count === 0;
    }, 1_000);

    expect(
      seenByA.mock.calls.some((call) => {
        return call[1]?.changedBy === roomB.peerId && call[1]?.reason === 'patch';
      }),
    ).toBe(true);
    expect(
      seenByA.mock.calls.some((call) => {
        return call[1]?.changedBy === roomLate.peerId && call[1]?.reason === 'undo';
      }),
    ).toBe(true);

    await roomLate.disconnect();
    await roomA.disconnect();
    await roomB.disconnect();
  });

  it('resolves incoming concurrent updates with vector clocks, timestamps, and changedBy', async () => {
    const adapter = new MockTransportAdapter();
    const room = await createMockedRoom(() => {
      return adapter;
    });

    const state = room.useState({
      initialValue: {
        count: 0,
      },
    });

    await room.connect();

    adapter.emit({
      type: 'state:update',
      roomId: room.id,
      fromPeerId: 'peer-b',
      timestamp: 10,
      payload: {
        value: {
          count: 1,
        },
        history: [
          {
            count: 0,
          },
        ],
        vectorClock: {
          'peer-b': 1,
        },
        changedBy: 'peer-b',
        timestamp: 10,
        reason: 'set',
      },
    });
    expect(state.get()).toEqual({
      count: 1,
    });

    adapter.emit({
      type: 'state:update',
      roomId: room.id,
      fromPeerId: 'peer-c',
      timestamp: 20,
      payload: {
        value: {
          count: 2,
        },
        history: [
          {
            count: 0,
          },
        ],
        vectorClock: {
          'peer-c': 1,
        },
        changedBy: 'peer-c',
        timestamp: 20,
        reason: 'set',
      },
    });
    expect(state.get()).toEqual({
      count: 2,
    });

    adapter.emit({
      type: 'state:update',
      roomId: room.id,
      fromPeerId: 'peer-b',
      timestamp: 5,
      payload: {
        value: {
          count: 3,
        },
        history: [
          {
            count: 0,
          },
          {
            count: 2,
          },
        ],
        vectorClock: {
          'peer-b': 1,
          'peer-c': 1,
        },
        changedBy: 'peer-b',
        timestamp: 5,
        reason: 'patch',
      },
    });
    expect(state.get()).toEqual({
      count: 3,
    });

    adapter.emit({
      type: 'state:update',
      roomId: room.id,
      fromPeerId: 'peer-a',
      timestamp: 5,
      payload: {
        value: {
          count: 4,
        },
        history: [
          {
            count: 0,
          },
          {
            count: 2,
          },
        ],
        vectorClock: {
          'peer-b': 1,
          'peer-c': 1,
        },
        changedBy: 'peer-a',
        timestamp: 5,
        reason: 'patch',
      },
    });
    expect(state.get()).toEqual({
      count: 3,
    });

    adapter.emit({
      type: 'state:update',
      roomId: room.id,
      fromPeerId: 'peer-z',
      timestamp: 5,
      payload: {
        value: {
          count: 5,
        },
        history: [
          {
            count: 0,
          },
          {
            count: 2,
          },
        ],
        vectorClock: {
          'peer-b': 1,
          'peer-c': 1,
        },
        changedBy: 'peer-z',
        timestamp: 5,
        reason: 'patch',
      },
    });
    expect(state.get()).toEqual({
      count: 5,
    });

    await room.disconnect();
  });

  it('writes nothing to localStorage when persist is disabled', () => {
    const localStorageController = createMockLocalStorage();
    installMockLocalStorage(localStorageController.storage);

    const room = createRoom('room-state-no-persist', {
      transport: 'broadcast',
    });
    const state = room.useState({
      initialValue: {
        count: 0,
      },
    });

    state.set({
      count: 1,
    });
    state.reset();

    expect(localStorageController.getItemMock).not.toHaveBeenCalled();
    expect(localStorageController.setItemMock).not.toHaveBeenCalled();
    expect(localStorageController.removeItemMock).not.toHaveBeenCalled();
    expect(localStorageController.store.size).toBe(0);
  });

  it('persists LWW state snapshots under the fixed localStorage key and restores them', async () => {
    const localStorageController = createMockLocalStorage();
    installMockLocalStorage(localStorageController.storage);

    const roomId = 'room-state-persist-restore';
    const roomA = createRoom(roomId, {
      transport: 'broadcast',
    });
    const stateA = roomA.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    stateA.set({
      count: 2,
    });

    const persistedEnvelope = readPersistedEnvelope(localStorageController.store, roomId);
    expect(persistedEnvelope).toMatchObject({
      version: 1,
      strategy: 'lww',
      snapshot: {
        value: {
          count: 2,
        },
        changedBy: roomA.peerId,
        reason: 'set',
      },
    });

    await roomA.connect();
    await roomA.disconnect();

    const roomB = createRoom(roomId, {
      transport: 'broadcast',
    });
    const stateB = roomB.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    await roomB.connect();

    expect(stateB.get()).toEqual({
      count: 2,
    });

    await roomB.disconnect();
  });

  it('keeps newer remote state over an older persisted snapshot and re-persists the winner', async () => {
    const localStorageController = createMockLocalStorage();
    installMockLocalStorage(localStorageController.storage);
    const roomId = 'room-state-mock';
    const persistedSnapshot = setStateSnapshot(
      createInitialStateSnapshot(
        {
          count: 0,
        },
        'persisted-peer',
        1,
      ),
      {
        count: 1,
      },
      'persisted-peer',
      2,
    );
    localStorageController.store.set(
      createPersistedStateStorageKey(roomId),
      JSON.stringify({
        version: 1,
        strategy: 'lww',
        snapshot: persistedSnapshot,
      }),
    );

    const adapter = new MockTransportAdapter();
    const mockedRoom = await createMockedRoom(() => {
      return adapter;
    });

    await mockedRoom.connect();

    adapter.emit({
      type: 'state:update',
      roomId: mockedRoom.id,
      fromPeerId: 'peer-b',
      timestamp: 10,
      payload: {
        value: {
          count: 2,
        },
        history: [
          {
            count: 0,
          },
        ],
        vectorClock: {
          'peer-b': 1,
        },
        changedBy: 'peer-b',
        timestamp: 10,
        reason: 'set',
      },
    });

    const state = mockedRoom.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    expect(state.get()).toEqual({
      count: 2,
    });
    expect(readPersistedEnvelope(localStorageController.store, mockedRoom.id)).toMatchObject({
      snapshot: {
        value: {
          count: 2,
        },
        changedBy: 'peer-b',
        reason: 'set',
      },
    });

    await mockedRoom.disconnect();
  });

  it('persists accepted remote state updates after persistence is enabled', async () => {
    const localStorageController = createMockLocalStorage();
    installMockLocalStorage(localStorageController.storage);

    const adapter = new MockTransportAdapter();
    const room = await createMockedRoom(() => {
      return adapter;
    });
    const state = room.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    await room.connect();

    adapter.emit({
      type: 'state:update',
      roomId: room.id,
      fromPeerId: 'peer-b',
      timestamp: 20,
      payload: {
        value: {
          count: 3,
        },
        history: [
          {
            count: 0,
          },
        ],
        vectorClock: {
          'peer-b': 1,
        },
        changedBy: 'peer-b',
        timestamp: 20,
        reason: 'set',
      },
    });

    expect(state.get()).toEqual({
      count: 3,
    });
    expect(readPersistedEnvelope(localStorageController.store, room.id)).toMatchObject({
      snapshot: {
        value: {
          count: 3,
        },
        changedBy: 'peer-b',
        reason: 'set',
      },
    });

    await room.disconnect();
  });

  it('ignores malformed and version-mismatched persisted state records', () => {
    const localStorageController = createMockLocalStorage();
    installMockLocalStorage(localStorageController.storage);

    const malformedRoomId = 'room-state-persist-malformed';
    localStorageController.store.set(createPersistedStateStorageKey(malformedRoomId), '{bad-json');

    const malformedRoom = createRoom(malformedRoomId, {
      transport: 'broadcast',
    });
    const malformedState = malformedRoom.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    expect(malformedState.get()).toEqual({
      count: 0,
    });

    const staleRoomId = 'room-state-persist-version';
    const staleSnapshot = createInitialStateSnapshot(
      {
        count: 9,
      },
      'peer-stale',
      1,
    );
    localStorageController.store.set(
      createPersistedStateStorageKey(staleRoomId),
      JSON.stringify({
        version: 999,
        strategy: 'lww',
        snapshot: staleSnapshot,
      }),
    );

    const staleRoom = createRoom(staleRoomId, {
      transport: 'broadcast',
    });
    const staleState = staleRoom.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    expect(staleState.get()).toEqual({
      count: 0,
    });
  });

  it('handles localStorage read/write failures without throwing', async () => {
    const storageError = new Error('Quota exceeded');
    const localStorageController = createMockLocalStorage({
      getItem: vi.fn(() => {
        throw storageError;
      }),
      setItem: vi.fn(() => {
        throw storageError;
      }),
    });
    installMockLocalStorage(localStorageController.storage);

    const room = createRoom('room-state-persist-errors', {
      transport: 'broadcast',
    });

    expect(() => {
      room.useState({
        initialValue: {
          count: 0,
        },
        persist: true,
      });
    }).not.toThrow();

    const state = room.useState({
      initialValue: {
        count: 0,
      },
      persist: true,
    });

    expect(() => {
      state.set({
        count: 1,
      });
    }).not.toThrow();
    await expect(room.connect()).resolves.toBeUndefined();
    await room.disconnect();
  });

  it('rejects persist:true when CRDT state is requested', () => {
    const room = createRoom('room-state-persist-crdt', {
      transport: 'broadcast',
    });

    expect(() => {
      room.useState({
        initialValue: {
          count: 0,
        },
        strategy: 'crdt',
        persist: true,
      });
    }).toThrow(/only supported.*lww/i);
  });
});
