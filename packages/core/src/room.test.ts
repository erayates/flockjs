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

  public readonly sentSignals: TransportSignal[] = [];

  public readonly broadcastSignals: TransportSignal[] = [];

  private handler: ((signal: TransportSignal) => void) | null = null;

  public constructor(
    private readonly connectBehavior: () => Promise<void> = async () => {
      return undefined;
    },
  ) {}

  public connect(): Promise<void> {
    return this.connectBehavior();
  }

  public disconnect(): Promise<void> {
    return Promise.resolve();
  }

  public send(signal: TransportSignal): void {
    this.sentSignals.push(signal);
  }

  public broadcast(signal: TransportSignal): void {
    this.broadcastSignals.push(signal);
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
  vi.restoreAllMocks();
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

  it('emits room:full before error when initial connect is rejected for capacity', async () => {
    vi.resetModules();

    let adapter: MockTransportAdapter | null = null;
    vi.doMock('./transports/select-transport', () => ({
      selectTransportAdapter: () => {
        if (!adapter) {
          throw new Error('Expected mocked adapter.');
        }

        return adapter;
      },
    }));

    try {
      const flockErrorMod = await import('./flock-error');
      const mod = await import('./index');
      adapter = new MockTransportAdapter(async () => {
        throw flockErrorMod.createFlockError('ROOM_FULL', 'Room is full.', true, {
          source: 'websocket-relay',
          serverCode: 'ROOM_FULL',
        });
      });
      const room = mod.createRoom('room-full-connect', {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      });

      const events: string[] = [];
      const onRoomFull = vi.fn(() => {
        events.push('room:full');
      });
      let emittedError: unknown;
      const onError = vi.fn((error: unknown) => {
        emittedError = error;
        events.push('error');
      });
      room.on('room:full', onRoomFull);
      room.on('error', onError);

      const connectPromise = room.connect();

      await expect(connectPromise).rejects.toMatchObject({
        code: 'ROOM_FULL',
        recoverable: true,
        message: 'Room is full.',
      });
      const rejectedError = await connectPromise.catch((error: unknown) => {
        return error;
      });
      expect(room.status).toBe('error');
      expect(onRoomFull).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['room:full', 'error']);
      expect(emittedError).toBe(rejectedError);
    } finally {
      vi.doUnmock('./transports/select-transport');
      vi.resetModules();
    }
  });

  it('logs structured room errors in debug transport mode', async () => {
    vi.resetModules();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {
      return undefined;
    });

    let adapter: MockTransportAdapter | null = null;
    vi.doMock('./transports/select-transport', () => ({
      selectTransportAdapter: () => {
        if (!adapter) {
          throw new Error('Expected mocked adapter.');
        }

        return adapter;
      },
    }));

    try {
      const flockErrorMod = await import('./flock-error');
      const mod = await import('./index');
      adapter = new MockTransportAdapter(async () => {
        throw flockErrorMod.createFlockError('ROOM_FULL', 'Room is full.', true, {
          source: 'websocket-relay',
          serverCode: 'ROOM_FULL',
        });
      });
      const room = mod.createRoom('room-full-debug', {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
        debug: {
          transport: true,
        },
      });

      await expect(room.connect()).rejects.toMatchObject({
        code: 'ROOM_FULL',
      });

      expect(debugSpy).toHaveBeenCalledWith('[flockjs][room] error', {
        code: 'ROOM_FULL',
        message: 'Room is full.',
        recoverable: true,
        cause: {
          source: 'websocket-relay',
          serverCode: 'ROOM_FULL',
        },
      });
    } finally {
      vi.doUnmock('./transports/select-transport');
      vi.resetModules();
    }
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

  it('broadcasts presence heartbeats every 30s while connected and stops after disconnect', async () => {
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
      room = mod.createRoom<{ name: string }>('room-presence-heartbeat', {
        transport: 'webrtc',
        relayUrl: 'ws://relay.local',
        presence: {
          name: 'Alice',
        },
      });

      const presence = room.usePresence();
      const snapshots = vi.fn();
      presence.subscribe(snapshots);

      await room.connect();

      const initialLastSeen = presence.getSelf().lastSeen;
      const getHeartbeatSignals = (): TransportSignal[] => {
        return adapter.broadcastSignals.filter((signal) => signal.type === 'presence:update');
      };

      expect(getHeartbeatSignals()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(getHeartbeatSignals()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(getHeartbeatSignals()).toHaveLength(1);
      expect(presence.getSelf().lastSeen).toBeGreaterThan(initialLastSeen);
      expect(snapshots.mock.calls.length).toBeGreaterThanOrEqual(3);

      const heartbeatCountAfterDisconnect = getHeartbeatSignals().length;
      await room.disconnect();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getHeartbeatSignals()).toHaveLength(heartbeatCountAfterDisconnect);
    } finally {
      vi.doUnmock('./transports/select-transport');
      vi.resetModules();
      await room?.disconnect();
      vi.useRealTimers();
    }
  });

  it('reconciles current self presence back to welcoming peers', async () => {
    vi.resetModules();

    const adapter = new MockTransportAdapter();
    vi.doMock('./transports/select-transport', () => ({
      selectTransportAdapter: () => {
        return adapter;
      },
    }));

    let room: Room<{ name: string; role?: 'editor' | 'viewer' }> | null = null;

    try {
      const mod = await import('./index');
      room = mod.createRoom<{ name: string; role?: 'editor' | 'viewer' }>(
        'room-presence-reconcile',
        {
          transport: 'webrtc',
          relayUrl: 'ws://relay.local',
          presence: {
            name: 'Alice',
          },
        },
      );

      room.usePresence().update({
        role: 'editor',
      });

      await room.connect();

      adapter.emit({
        type: 'welcome',
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

      expect(adapter.sentSignals).toContainEqual(
        expect.objectContaining({
          type: 'presence:update',
          toPeerId: 'peer-b',
          payload: {
            peer: expect.objectContaining({
              id: room.peerId,
              name: 'Alice',
              role: 'editor',
            }),
          },
        }),
      );
    } finally {
      vi.doUnmock('./transports/select-transport');
      vi.resetModules();
      await room?.disconnect();
    }
  });

  it('notifies presence subscribers for remote lastSeen heartbeats without emitting peer:update', async () => {
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
      room = mod.createRoom<{ name: string }>('room-remote-presence-heartbeat', {
        transport: 'webrtc',
        relayUrl: 'ws://relay.local',
        presence: {
          name: 'Alice',
        },
      });

      await room.connect();

      const presence = room.usePresence();
      const snapshots = vi.fn();
      presence.subscribe(snapshots);

      const onPeerUpdate = vi.fn();
      room.on('peer:update', onPeerUpdate);

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

      snapshots.mockClear();
      onPeerUpdate.mockClear();

      const previousLastSeen = presence.get('peer-b')?.lastSeen ?? 0;

      await vi.advanceTimersByTimeAsync(1_000);

      adapter.emit({
        type: 'presence:update',
        roomId: room.id,
        fromPeerId: 'peer-b',
        payload: {
          peer: {
            id: 'peer-b',
            joinedAt: 1,
            lastSeen: 2,
            name: 'Bob',
          },
        },
      });

      expect(presence.get('peer-b')?.lastSeen).toBeGreaterThan(previousLastSeen);
      expect(snapshots).toHaveBeenCalledTimes(1);
      expect(snapshots).toHaveBeenCalledWith([
        expect.objectContaining({
          id: room.peerId,
          name: 'Alice',
        }),
        expect.objectContaining({
          id: 'peer-b',
          name: 'Bob',
        }),
      ]);
      expect(onPeerUpdate).not.toHaveBeenCalled();
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
