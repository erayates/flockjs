import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlockError } from '../flock-error';
import type { TransportAdapter, TransportSignal } from './transport';
import { createWebRTCFallbackTransportAdapter } from './webrtc-fallback';

const webrtcConnectErrors: unknown[] = [];
const broadcastConnectErrors: unknown[] = [];
const createdWebRTCTransports: MockTransportAdapter[] = [];
const createdBroadcastTransports: MockTransportAdapter[] = [];
let broadcastAvailable = true;

class MockTransportAdapter implements TransportAdapter {
  public connectCalls = 0;

  public disconnectCalls = 0;

  public readonly sentSignals: TransportSignal[] = [];

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  public constructor(
    public readonly kind: TransportAdapter['kind'],
    private readonly connectError?: Error,
  ) {}

  public async connect(): Promise<void> {
    this.connectCalls += 1;

    if (this.connectError !== undefined) {
      throw this.connectError;
    }
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  public send(signal: TransportSignal): void {
    this.sentSignals.push(signal);
  }

  public subscribe(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  public emit(signal: TransportSignal): void {
    for (const listener of this.listeners) {
      listener(signal);
    }
  }
}

function createSignalingError(
  kind:
    | 'socket-unavailable'
    | 'socket-error'
    | 'socket-closed-during-join'
    | 'join-timeout'
    | 'server-rejected',
  serverCode?: string,
): Error {
  return createFlockError('NETWORK_ERROR', `signaling-${kind}`, false, {
    source: 'webrtc-signaling',
    kind,
    ...(serverCode === undefined ? {} : { serverCode }),
  });
}

vi.mock('./broadcast', () => ({
  createBroadcastTransportAdapter: () => {
    const transport = new MockTransportAdapter('broadcast', broadcastConnectErrors.shift());
    createdBroadcastTransports.push(transport);
    return transport;
  },
  isBroadcastChannelAvailable: () => {
    return broadcastAvailable;
  },
}));

vi.mock('./webrtc', () => ({
  createWebRTCTransportAdapter: () => {
    const transport = new MockTransportAdapter('webrtc', webrtcConnectErrors.shift());
    createdWebRTCTransports.push(transport);
    return transport;
  },
}));

describe('WebRTCFallbackTransportAdapter', () => {
  beforeEach(() => {
    webrtcConnectErrors.length = 0;
    broadcastConnectErrors.length = 0;
    createdWebRTCTransports.length = 0;
    createdBroadcastTransports.length = 0;
    broadcastAvailable = true;
  });

  it.each([
    'socket-unavailable',
    'join-timeout',
    'socket-error',
    'socket-closed-during-join',
  ] as const)('falls back to BroadcastChannel on %s failures during connect', async (kind) => {
    webrtcConnectErrors.push(createSignalingError(kind));

    const adapter = createWebRTCFallbackTransportAdapter('room-fallback', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });
    const received: TransportSignal[] = [];
    adapter.subscribe((signal) => {
      received.push(signal);
    });

    await adapter.connect();

    expect(createdWebRTCTransports).toHaveLength(1);
    expect(createdWebRTCTransports[0]?.connectCalls).toBe(1);
    expect(createdWebRTCTransports[0]?.disconnectCalls).toBe(1);
    expect(createdBroadcastTransports).toHaveLength(1);
    expect(createdBroadcastTransports[0]?.connectCalls).toBe(1);

    const inboundSignal: TransportSignal = {
      type: 'hello',
      roomId: 'room-fallback',
      fromPeerId: 'peer-b',
    };
    createdBroadcastTransports[0]?.emit(inboundSignal);
    expect(received).toEqual([inboundSignal]);

    const outboundSignal: TransportSignal = {
      type: 'event',
      roomId: 'room-fallback',
      fromPeerId: 'peer-a',
      payload: {
        ok: true,
      },
    };
    adapter.send(outboundSignal);
    expect(createdBroadcastTransports[0]?.sentSignals).toEqual([outboundSignal]);

    await adapter.disconnect();
    expect(createdBroadcastTransports[0]?.disconnectCalls).toBe(1);
  });

  it('does not fall back when the relay rejects the join request', async () => {
    const error = createSignalingError('server-rejected', 'AUTH_FAILED');
    webrtcConnectErrors.push(error);

    const adapter = createWebRTCFallbackTransportAdapter('room-auth', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    await expect(adapter.connect()).rejects.toBe(error);
    expect(createdBroadcastTransports).toHaveLength(0);
    expect(createdWebRTCTransports[0]?.disconnectCalls).toBe(1);
  });

  it('does not fall back when BroadcastChannel is unavailable', async () => {
    broadcastAvailable = false;
    const error = createSignalingError('join-timeout');
    webrtcConnectErrors.push(error);

    const adapter = createWebRTCFallbackTransportAdapter('room-no-broadcast', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    await expect(adapter.connect()).rejects.toBe(error);
    expect(createdBroadcastTransports).toHaveLength(0);
  });
});
