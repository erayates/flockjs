import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFlockError } from './flock-error';
import { createRoom, FlockError } from './index';
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

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class MockTransportAdapter implements TransportAdapter {
  public readonly kind = 'webrtc' as const;

  private handler: ((signal: TransportSignal) => void) | null = null;

  public connect(): Promise<void> {
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    return Promise.resolve();
  }

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

afterEach(async () => {
  vi.useRealTimers();
  await wait(10);
});

describe('createRoom', () => {
  it('returns a Room instance with expected defaults', () => {
    const room = createRoom('room-api-baseline');

    expect(room.id).toBe('room-api-baseline');
    expect(room.status).toBe('idle');
    expect(room.peerId).toBeTypeOf('string');
    expect(room.peerId).toMatch(UUID_V4_PATTERN);
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

  it('throws a typed error when websocket transport is missing relayUrl', async () => {
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

  it('falls back to BroadcastChannel when signaling is unavailable during connect', async () => {
    vi.resetModules();

    const originalRTCPeerConnection = globalThis.RTCPeerConnection;
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: class MockRTCPeerConnection {},
    });

    vi.doMock('./transports/webrtc.signaling', () => ({
      isWebRTCSignalingFallbackEligibleError: (error: unknown): boolean => {
        const readFailureKind = (candidate: unknown): string | null => {
          if (typeof candidate !== 'object' || candidate === null) {
            return null;
          }

          const kind = Reflect.get(candidate, 'kind');
          if (typeof kind === 'string') {
            return kind;
          }

          const cause = Reflect.get(candidate, 'cause');
          return readFailureKind(cause);
        };

        const kind = readFailureKind(error);
        return kind === 'join-timeout';
      },
      WebRTCSignalingClient: class MockWebRTCSignalingClient {
        public async connect(): Promise<string[]> {
          throw createFlockError(
            'NETWORK_ERROR',
            'Timed out waiting for signaling join acknowledgement (25ms).',
            false,
            {
              source: 'webrtc-signaling',
              kind: 'join-timeout',
            },
          );
        }

        public async disconnect(): Promise<void> {
          return undefined;
        }

        public sendSignal(): void {
          return undefined;
        }
      },
    }));

    let roomA: Room<{ name: string }> | null = null;
    let roomB: Room<{ name: string }> | null = null;

    try {
      const { createRoom: createMockedRoom } = await import('./index');

      roomA = createMockedRoom<{ name: string }>('room-webrtc-fallback', {
        transport: 'webrtc',
        relayUrl: 'ws://relay.local',
        presence: { name: 'Alice' },
      });
      roomB = createMockedRoom<{ name: string }>('room-webrtc-fallback', {
        transport: 'webrtc',
        relayUrl: 'ws://relay.local',
        presence: { name: 'Bob' },
      });

      await roomA.connect();
      await roomB.connect();

      await waitFor(() => roomA?.peerCount === 1 && roomB?.peerCount === 1);
      expect(roomA.peers[0]?.name).toBe('Bob');
      expect(roomB.peers[0]?.name).toBe('Alice');

      await roomA.disconnect();
      await roomB.disconnect();
    } finally {
      vi.doUnmock('./transports/webrtc.signaling');
      vi.resetModules();

      if (roomA) {
        await roomA.disconnect().catch(() => {
          return undefined;
        });
      }

      if (roomB) {
        await roomB.disconnect().catch(() => {
          return undefined;
        });
      }

      Object.defineProperty(globalThis, 'RTCPeerConnection', {
        configurable: true,
        writable: true,
        value: originalRTCPeerConnection,
      });
    }
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

  it('cancels inferred peer removal when the same peer rejoins before the grace period expires', async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const adapter = new MockTransportAdapter();
    vi.doMock('./transports/select-transport', () => ({
      selectTransportAdapter: () => {
        return adapter;
      },
    }));

    let room: Room<{ name: string }> | null = null;

    try {
      const mod = await import('./index');
      room = mod.createRoom<{ name: string }>('room-peer-rejoin-race', {
        transport: 'webrtc',
        relayUrl: 'ws://relay.local',
        presence: {
          name: 'Alice',
        },
      });

      const onPeerJoin = vi.fn();
      const onPeerLeave = vi.fn();
      const onPeerUpdate = vi.fn();
      room.on('peer:join', onPeerJoin);
      room.on('peer:leave', onPeerLeave);
      room.on('peer:update', onPeerUpdate);

      await room.connect();

      adapter.emit({
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

      expect(room.peerCount).toBe(1);
      expect(onPeerJoin).toHaveBeenCalledTimes(1);

      adapter.emit({
        type: 'leave',
        roomId: room.id,
        fromPeerId: 'peer-b',
        payload: {},
      });

      expect(room.peerCount).toBe(1);
      await vi.advanceTimersByTimeAsync(4_000);

      adapter.emit({
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

      await vi.advanceTimersByTimeAsync(1_000);

      expect(room.peerCount).toBe(1);
      expect(room.peers).toEqual([
        expect.objectContaining({
          id: 'peer-b',
          name: 'Bob',
        }),
      ]);
      expect(room.usePresence().get('peer-b')).toEqual(
        expect.objectContaining({
          id: 'peer-b',
          name: 'Bob',
        }),
      );
      expect(onPeerJoin).toHaveBeenCalledTimes(1);
      expect(onPeerUpdate).not.toHaveBeenCalled();
      expect(onPeerLeave).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./transports/select-transport');
      vi.resetModules();
      await room?.disconnect();
      vi.useRealTimers();
    }
  });

  it('falls back to crypto.getRandomValues for UUID v4 peer ids when randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    let sequence = 0;
    const fallbackCrypto = {
      getRandomValues(array: Uint8Array): Uint8Array {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = (sequence + index + 1) & 0xff;
        }

        sequence += 17;
        return array;
      },
    };

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: fallbackCrypto,
    });

    try {
      const roomA = createRoom('room-peerid-fallback-a');
      const roomB = createRoom('room-peerid-fallback-b');

      expect(roomA.peerId).toMatch(UUID_V4_PATTERN);
      expect(roomB.peerId).toMatch(UUID_V4_PATTERN);
      expect(roomA.peerId).not.toBe(roomB.peerId);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: originalCrypto,
      });
    }
  });

  it('throws immediately when secure crypto for peer IDs is unavailable', () => {
    const originalCrypto = globalThis.crypto;

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      expect(() => {
        createRoom('room-peerid-no-secure-random');
      }).toThrowError(FlockError);

      try {
        createRoom('room-peerid-no-secure-random');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'NETWORK_ERROR',
          recoverable: false,
          cause: {
            source: 'peer-id',
            kind: 'secure-random-unavailable',
          },
        });
      }
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: originalCrypto,
      });
    }
  });
});
