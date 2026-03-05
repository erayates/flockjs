import { describe, expect, it, vi } from 'vitest';

import { createRoom } from './index';

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

interface TestPresence {
  name: string;
  role: 'editor' | 'viewer';
  color: string;
}

describe('Room peer discovery and presence', () => {
  it('discovers peers with hello/welcome and keeps room.peers live', async () => {
    const roomA = createRoom<TestPresence>('room-discovery', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
        role: 'editor',
        color: '#111111',
      },
    });

    const roomB = createRoom<TestPresence>('room-discovery', {
      transport: 'broadcast',
      presence: {
        name: 'Bob',
        role: 'viewer',
        color: '#222222',
      },
    });

    const onPeerJoin = vi.fn();
    const onPeerUpdate = vi.fn();
    const onPeerLeave = vi.fn();

    roomA.on('peer:join', onPeerJoin);
    roomA.on('peer:update', onPeerUpdate);
    roomA.on('peer:leave', onPeerLeave);

    await Promise.all([roomA.connect(), roomB.connect()]);

    await waitFor(() => roomA.peerCount === 1 && roomB.peerCount === 1);

    expect(roomA.peers).toEqual([
      expect.objectContaining({
        id: roomB.peerId,
        name: 'Bob',
        role: 'viewer',
      }),
    ]);
    expect(onPeerJoin).toHaveBeenCalledTimes(1);
    expect(onPeerUpdate).not.toHaveBeenCalled();

    await roomB.disconnect();
    await waitFor(() => roomA.peerCount === 0);

    expect(roomA.peers).toEqual([]);
    expect(onPeerLeave).toHaveBeenCalledTimes(1);

    await roomA.disconnect();
  });

  it('updates peer presence and notifies presence subscriptions', async () => {
    const roomA = createRoom<TestPresence>('room-presence-update', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
        role: 'editor',
        color: '#333333',
      },
    });

    const roomB = createRoom<TestPresence>('room-presence-update', {
      transport: 'broadcast',
      presence: {
        name: 'Bob',
        role: 'viewer',
        color: '#444444',
      },
    });

    await roomA.connect();
    await roomB.connect();
    await waitFor(() => roomA.peerCount === 1);

    const updates = vi.fn();
    const presenceA = roomA.usePresence();
    const stop = presenceA.subscribe(updates);

    roomB.usePresence().update({
      role: 'editor',
      color: '#999999',
    });

    await waitFor(() => roomA.peers[0]?.role === 'editor');
    expect(roomA.peers[0]?.color).toBe('#999999');
    expect(updates).toHaveBeenCalled();

    stop();
    await roomA.disconnect();
    await roomB.disconnect();
  });
});
