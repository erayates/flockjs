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

  it('merges and replaces presence while keeping getSelf accurate and subscriptions current', async () => {
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

    const presenceA = roomA.usePresence();
    const presenceB = roomB.usePresence();
    const updates = vi.fn();
    const stop = presenceA.subscribe(updates);

    presenceA.update({
      color: '#121212',
    });

    expect(presenceA.getSelf()).toEqual(
      expect.objectContaining({
        id: roomA.peerId,
        name: 'Alice',
        role: 'editor',
        color: '#121212',
      }),
    );

    presenceB.update({
      role: 'editor',
      color: '#999999',
    });

    await waitFor(() => roomA.peers[0]?.role === 'editor');
    expect(roomA.usePresence().get(roomB.peerId)).toEqual(
      expect.objectContaining({
        id: roomB.peerId,
        name: 'Bob',
        role: 'editor',
        color: '#999999',
      }),
    );
    expect(presenceB.getSelf()).toEqual(
      expect.objectContaining({
        id: roomB.peerId,
        name: 'Bob',
        role: 'editor',
        color: '#999999',
      }),
    );

    presenceB.replace({
      name: 'Bobby',
    });

    await waitFor(() => roomA.usePresence().get(roomB.peerId)?.name === 'Bobby');

    expect(roomA.usePresence().get(roomB.peerId)).toEqual(
      expect.objectContaining({
        id: roomB.peerId,
        name: 'Bobby',
      }),
    );
    expect(roomA.usePresence().get(roomB.peerId)).not.toHaveProperty('role');
    expect(roomA.usePresence().get(roomB.peerId)).not.toHaveProperty('color');
    expect(presenceB.getSelf()).toEqual(
      expect.objectContaining({
        id: roomB.peerId,
        joinedAt: expect.any(Number),
        lastSeen: expect.any(Number),
        name: 'Bobby',
      }),
    );
    expect(presenceB.getSelf()).not.toHaveProperty('role');
    expect(presenceB.getSelf()).not.toHaveProperty('color');

    const latestSnapshot = updates.mock.calls[updates.mock.calls.length - 1]?.[0];
    expect(latestSnapshot).toEqual([
      expect.objectContaining({
        id: roomA.peerId,
        name: 'Alice',
        color: '#121212',
      }),
      expect.objectContaining({
        id: roomB.peerId,
        name: 'Bobby',
      }),
    ]);

    stop();
    await roomA.disconnect();
    await roomB.disconnect();
  });

  it('syncs current presence to late joiners within 1s and clears presence on disconnect', async () => {
    const roomA = createRoom<TestPresence>('room-presence-late-join', {
      transport: 'broadcast',
      presence: {
        name: 'Alice',
        role: 'editor',
        color: '#555555',
      },
    });

    const roomB = createRoom<TestPresence>('room-presence-late-join', {
      transport: 'broadcast',
      presence: {
        name: 'Bob',
        role: 'viewer',
        color: '#666666',
      },
    });

    const presenceA = roomA.usePresence();
    const presenceB = roomB.usePresence();
    const snapshotsA = vi.fn();
    const stop = presenceA.subscribe(snapshotsA);

    await roomA.connect();

    presenceA.update({
      role: 'viewer',
      color: '#777777',
    });

    await roomB.connect();
    await waitFor(() => presenceB.get(roomA.peerId)?.color === '#777777', 1_000);

    expect(presenceB.get(roomA.peerId)).toEqual(
      expect.objectContaining({
        id: roomA.peerId,
        name: 'Alice',
        role: 'viewer',
        color: '#777777',
      }),
    );

    await roomB.disconnect();
    await waitFor(() => presenceA.get(roomB.peerId) === null);

    expect(presenceA.get(roomB.peerId)).toBeNull();
    expect(snapshotsA.mock.calls[snapshotsA.mock.calls.length - 1]?.[0]).toEqual([
      expect.objectContaining({
        id: roomA.peerId,
        name: 'Alice',
      }),
    ]);

    stop();
    await roomA.disconnect();
  });
});
