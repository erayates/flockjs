import { afterEach, describe, expect, it, vi } from 'vitest';

import { selectTransportAdapter } from './select-transport';

class StubBroadcastChannel {
  public constructor(public readonly name: string) {
    void name;
  }

  public addEventListener(): void {
    return undefined;
  }

  public removeEventListener(): void {
    return undefined;
  }

  public postMessage(): void {
    return undefined;
  }

  public close(): void {
    return undefined;
  }
}

class StubRTCPeerConnection {}

class StubWebSocket {
  public readonly readyState = 0;

  public constructor(public readonly url: string) {
    void url;
  }

  public addEventListener(): void {
    return undefined;
  }

  public removeEventListener(): void {
    return undefined;
  }

  public send(): void {
    return undefined;
  }

  public close(): void {
    return undefined;
  }
}

describe('selectTransportAdapter', () => {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalRTCPeerConnection = globalThis.RTCPeerConnection;
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: originalRTCPeerConnection,
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: originalWebSocket,
    });
    vi.restoreAllMocks();
  });

  it('selects BroadcastChannel in auto mode when available', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: StubBroadcastChannel as unknown as typeof BroadcastChannel,
    });
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: StubRTCPeerConnection as unknown as typeof RTCPeerConnection,
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: StubWebSocket as unknown as typeof WebSocket,
    });

    const adapter = selectTransportAdapter('room-select', 'peer-a', {
      transport: 'auto',
      relayUrl: 'ws://relay.local',
    });

    expect(adapter.kind).toBe('broadcast');
  });

  it('selects WebRTC in auto mode when BroadcastChannel is unavailable and relay-backed WebRTC is viable', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: StubRTCPeerConnection as unknown as typeof RTCPeerConnection,
    });

    const adapter = selectTransportAdapter('room-select', 'peer-a', {
      transport: 'auto',
      relayUrl: 'ws://relay.local',
    });

    expect(adapter.kind).toBe('webrtc');
  });

  it('selects websocket in auto mode when BroadcastChannel is unavailable, WebRTC is unavailable, and relayUrl exists', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: StubWebSocket as unknown as typeof WebSocket,
    });

    const adapter = selectTransportAdapter('room-select', 'peer-a', {
      transport: 'auto',
      relayUrl: 'ws://relay.local',
    });

    expect(adapter.kind).toBe('websocket');
  });

  it('selects in-memory in auto mode when no browser-capable transport is available', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const adapter = selectTransportAdapter('room-select', 'peer-a', {
      transport: 'auto',
    });

    expect(adapter.kind).toBe('in-memory');
  });

  it('implements explicit websocket mode instead of throwing a planned placeholder', () => {
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: StubWebSocket as unknown as typeof WebSocket,
    });

    const adapter = selectTransportAdapter('room-select', 'peer-a', {
      transport: 'websocket',
      relayUrl: 'ws://relay.local',
    });

    expect(adapter.kind).toBe('websocket');
  });

  it('logs transport selection in debug mode with the expected reason', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {
      return undefined;
    });

    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: StubBroadcastChannel as unknown as typeof BroadcastChannel,
    });

    selectTransportAdapter('room-select', 'peer-a', {
      transport: 'auto',
      debug: {
        transport: true,
      },
    });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith('[flockjs][transport] selection', {
      requestedMode: 'auto',
      selectedTransport: 'broadcast',
      reason: 'BroadcastChannel available',
    });
  });
});
