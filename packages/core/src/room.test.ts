import { afterEach, describe, expect, it } from 'vitest';

import { createRoom, FlockError } from './index';

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

afterEach(async () => {
  await wait(10);
});

describe('createRoom', () => {
  it('returns a Room instance with expected defaults', () => {
    const room = createRoom('room-api-baseline');

    expect(room.id).toBe('room-api-baseline');
    expect(room.status).toBe('idle');
    expect(room.peerId).toBeTypeOf('string');
    expect(room.peerCount).toBe(0);
    expect(room.peers).toEqual([]);
  });

  it('connects and disconnects with expected status transitions', async () => {
    const room = createRoom('room-lifecycle', {
      transport: 'broadcast',
    });

    const connection = room.connect();
    expect(['connecting', 'connected']).toContain(room.status);

    await connection;
    expect(room.status).toBe('connected');

    await room.disconnect();
    expect(room.status).toBe('disconnected');
  });

  it('throws a typed error for unsupported websocket transport mode', async () => {
    const room = createRoom('room-unsupported', {
      transport: 'websocket',
    });

    const connectPromise = room.connect();

    await expect(connectPromise).rejects.toBeInstanceOf(FlockError);
    await expect(connectPromise).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      recoverable: false,
    });
    expect(room.status).toBe('error');
  });

  it('throws a typed error when WebRTC runtime dependencies are unavailable', async () => {
    const room = createRoom('room-webrtc-runtime', {
      transport: 'webrtc',
      relayUrl: 'ws://localhost:8787',
    });

    const connectPromise = room.connect();

    await expect(connectPromise).rejects.toBeInstanceOf(FlockError);
    await expect(connectPromise).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      recoverable: false,
    });
    expect(room.status).toBe('error');
  });

  it('falls back to in-memory transport when BroadcastChannel is unavailable', async () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel;

    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const roomA = createRoom<{ name: string }>('room-fallback', {
      transport: 'auto',
      presence: { name: 'Alice' },
    });
    const roomB = createRoom<{ name: string }>('room-fallback', {
      transport: 'auto',
      presence: { name: 'Bob' },
    });

    await roomA.connect();
    await roomB.connect();

    await waitFor(() => roomA.peerCount === 1 && roomB.peerCount === 1);
    expect(roomA.peers[0]?.name).toBe('Bob');
    expect(roomB.peers[0]?.name).toBe('Alice');

    await roomA.disconnect();
    await roomB.disconnect();

    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
  });

  it('falls back to non-randomUUID peer ids when crypto.randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    const fallbackCrypto = {
      ...originalCrypto,
      randomUUID: undefined,
    };

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: fallbackCrypto,
    });

    try {
      const roomA = createRoom('room-peerid-fallback-a');
      const roomB = createRoom('room-peerid-fallback-b');

      expect(roomA.peerId).toMatch(/^peer-[a-z0-9]+-[a-z0-9]+$/);
      expect(roomB.peerId).toMatch(/^peer-[a-z0-9]+-[a-z0-9]+$/);
      expect(roomA.peerId).not.toBe(roomB.peerId);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: originalCrypto,
      });
    }
  });
});
