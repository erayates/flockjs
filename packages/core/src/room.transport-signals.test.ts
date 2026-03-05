import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TransportAdapter, TransportSignal } from './transports/transport';
import type { Room } from './types';

class MockTransportAdapter implements TransportAdapter {
  public readonly kind = 'webrtc' as const;

  public disconnectCalls = 0;

  private handler: ((signal: TransportSignal) => void) | null = null;

  public connect(): Promise<void> {
    return Promise.resolve();
  }

  public disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    return Promise.resolve();
  }

  public send(signal: TransportSignal): void {
    void signal;
    return undefined;
  }

  public broadcast(signal: TransportSignal): void {
    void signal;
    return undefined;
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

async function createMockedRoom(adapter: MockTransportAdapter): Promise<Room> {
  vi.resetModules();
  vi.doMock('./transports/select-transport', () => ({
    selectTransportAdapter: () => {
      return adapter;
    },
  }));

  const mod = await import('./index');

  return mod.createRoom('room-transport-signals', {
    transport: 'webrtc',
    relayUrl: 'ws://relay.local',
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Room transport signal mapping', () => {
  it('maps internal transport error signals to room error events', async () => {
    const adapter = new MockTransportAdapter();
    const room = await createMockedRoom(adapter);

    const onError = vi.fn();
    room.on('error', onError);

    await room.connect();

    adapter.emit({
      type: 'transport:error',
      roomId: room.id,
      fromPeerId: room.peerId,
      payload: {
        error: new Error('ice gather failed'),
      },
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'FlockError',
        code: 'NETWORK_ERROR',
        message: 'ice gather failed',
      }),
    );

    await room.disconnect();
  });

  it('maps internal transport disconnect signals to disconnected status and delayed cleanup', async () => {
    vi.useFakeTimers();

    const adapter = new MockTransportAdapter();
    const room = await createMockedRoom(adapter);

    const onDisconnected = vi.fn();
    const onPeerLeave = vi.fn();
    room.on('disconnected', onDisconnected);
    room.on('peer:leave', onPeerLeave);

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
        },
      },
    });
    expect(room.peerCount).toBe(1);

    adapter.emit({
      type: 'transport:disconnected',
      roomId: room.id,
      fromPeerId: room.peerId,
      payload: {
        reason: 'socket-gone',
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(room.status).toBe('disconnected');
    expect(room.peerCount).toBe(1);
    expect(adapter.disconnectCalls).toBe(1);
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith({
      reason: 'socket-gone',
    });
    expect(onPeerLeave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(room.peerCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(room.peerCount).toBe(0);
    expect(onPeerLeave).toHaveBeenCalledTimes(1);

    adapter.emit({
      type: 'transport:disconnected',
      roomId: room.id,
      fromPeerId: room.peerId,
      payload: {
        reason: 'socket-gone',
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(adapter.disconnectCalls).toBe(1);

    room.off('disconnected', onDisconnected);
    await room.disconnect();
  });
});
