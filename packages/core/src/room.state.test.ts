import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRoom } from './index';
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
    await waitFor(
      () => {
        return lateState.get().count === 2;
      },
      1_000,
    );

    lateState.undo();
    await waitFor(() => stateA.get().count === 1 && stateB.get().count === 1);

    stateA.reset();
    await waitFor(
      () => {
        return stateB.get().count === 0 && lateState.get().count === 0;
      },
      1_000,
    );

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
});
