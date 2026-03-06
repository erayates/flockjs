import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTransportProtocolCapabilities } from './transport.protocol';
import type { SignalingSignalMessage } from './webrtc.protocol';
import type { WebRTCSignalingClientOptions } from './webrtc.signaling';

const DATA_CHANNEL_OPEN: RTCDataChannelState = 'open';
const DATA_CHANNEL_CLOSED: RTCDataChannelState = 'closed';

const connectPeersQueue: string[][] = [];
const signalingInstances: MockSignalingClient[] = [];

class MockSignalingClient {
  public readonly sentSignals: Array<
    Omit<SignalingSignalMessage, 'type' | 'roomId' | 'fromPeerId'>
  > = [];

  public disconnectCalls = 0;

  public constructor(public readonly options: WebRTCSignalingClientOptions) {
    signalingInstances.push(this);
  }

  public async connect(): Promise<string[]> {
    return connectPeersQueue.shift() ?? [];
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  public sendSignal(message: Omit<SignalingSignalMessage, 'type' | 'roomId' | 'fromPeerId'>): void {
    this.sentSignals.push(message);
  }

  public emitPeerJoined(peerId: string): void {
    this.options.onPeerJoined(peerId);
  }

  public emitPeerLeft(peerId: string): void {
    this.options.onPeerLeft(peerId);
  }

  public emitSignal(message: SignalingSignalMessage): void {
    this.options.onSignal(message);
  }

  public emitDisconnected(reason?: string): void {
    this.options.onDisconnected(reason);
  }
}

vi.mock('./webrtc.signaling', () => ({
  WebRTCSignalingClient: MockSignalingClient,
}));

class MockRTCDataChannel {
  public readonly sent: unknown[] = [];

  public readyState: RTCDataChannelState = DATA_CHANNEL_OPEN;

  public onopen: (() => void) | null = null;

  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  public onclose: (() => void) | null = null;

  public onerror: (() => void) | null = null;

  public constructor(
    public readonly label: string,
    public readonly options: RTCDataChannelInit,
  ) {}

  public send(payload: unknown): void {
    this.sent.push(payload);
  }

  public close(): void {
    this.readyState = DATA_CHANNEL_CLOSED;
    this.onclose?.();
  }

  public open(): void {
    this.readyState = DATA_CHANNEL_OPEN;
    this.onopen?.();
  }

  public receive(payload: unknown): void {
    this.onmessage?.({ data: payload } as MessageEvent<unknown>);
  }
}

class MockRTCPeerConnection {
  public static instances: MockRTCPeerConnection[] = [];

  public static nextIceGatheringState: RTCIceGatheringState = 'complete';

  public static autoOpenDataChannels = true;

  public static reset(): void {
    this.instances = [];
    this.nextIceGatheringState = 'complete';
    this.autoOpenDataChannels = true;
  }

  public readonly dataChannels: MockRTCDataChannel[] = [];

  public readonly addedCandidates: RTCIceCandidateInit[] = [];

  public onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;

  public ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  public onconnectionstatechange: (() => void) | null = null;

  public iceGatheringState: RTCIceGatheringState;

  public connectionState: RTCPeerConnectionState = 'new';

  public localDescription: RTCSessionDescriptionInit | null = null;

  public remoteDescription: RTCSessionDescriptionInit | null = null;

  public closeCalls = 0;

  public constructor(public readonly configuration: RTCConfiguration) {
    this.iceGatheringState = MockRTCPeerConnection.nextIceGatheringState;
    MockRTCPeerConnection.instances.push(this);
  }

  public createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    const channel = new MockRTCDataChannel(label, options ?? {});
    this.dataChannels.push(channel);

    if (MockRTCPeerConnection.autoOpenDataChannels) {
      queueMicrotask(() => {
        channel.open();
      });
    }

    return channel as unknown as RTCDataChannel;
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'offer',
      sdp: 'offer-sdp',
    };
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'answer',
      sdp: 'answer-sdp',
    };
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate);
  }

  public close(): void {
    this.connectionState = 'closed';
    this.closeCalls += 1;
  }

  public emitIceCandidate(candidate: RTCIceCandidate | null): void {
    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);
  }

  public emitRemoteDataChannel(channel: MockRTCDataChannel): void {
    this.ondatachannel?.({ channel: channel as unknown as RTCDataChannel } as RTCDataChannelEvent);
  }

  public setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

function parseEnvelope(payload: string): Record<string, unknown> {
  return JSON.parse(payload) as Record<string, unknown>;
}

async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for condition after ${timeoutMs}ms.`);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

const originalRTCPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
  vi.resetModules();
  connectPeersQueue.length = 0;
  signalingInstances.length = 0;
  MockRTCPeerConnection.reset();

  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    writable: true,
    value: MockRTCPeerConnection as unknown as typeof RTCPeerConnection,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    writable: true,
    value: originalRTCPeerConnection,
  });
});

describe('WebRTCTransportAdapter', () => {
  const protocol = getTransportProtocolCapabilities('webrtc');

  it('throws when relayUrl or RTCPeerConnection is unavailable', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    expect(() =>
      createWebRTCTransportAdapter('room-no-relay', 'peer-a', {
        transport: 'webrtc',
      }),
    ).toThrow(/requires `relayUrl`/i);

    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    expect(() =>
      createWebRTCTransportAdapter('room-no-rtc', 'peer-a', {
        transport: 'webrtc',
        relayUrl: 'ws://relay.local',
      }),
    ).toThrow(/RTCPeerConnection is not available/i);
  });

  it('creates initiator offers, sends ICE candidates, and emits bootstrap hello', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push(['peer-b']);

    const adapter = createWebRTCTransportAdapter('room-defaults', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    await adapter.connect();
    await waitFor(() => MockRTCPeerConnection.instances.length === 1);

    const peerConnection = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    const signalingClient = signalingInstances[0] as MockSignalingClient;
    const dataChannel = peerConnection.dataChannels[0] as MockRTCDataChannel;

    expect(peerConnection.configuration.iceServers).toEqual([
      {
        urls: 'stun:stun.l.google.com:19302',
      },
    ]);
    expect(signalingClient.options.joinTimeoutMs).toBe(5_000);
    expect(dataChannel.label).toBe('flockjs-v1');
    expect(dataChannel.options.ordered).toBe(true);
    expect(dataChannel.options.maxRetransmits).toBeUndefined();

    expect(signalingClient.sentSignals.some((item) => item.description?.type === 'offer')).toBe(
      true,
    );

    const candidateWithToJson = {
      toJSON: () => ({
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0,
      }),
    } as unknown as RTCIceCandidate;

    peerConnection.emitIceCandidate(candidateWithToJson);
    expect(signalingClient.sentSignals.at(-1)).toMatchObject({
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:1',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    });

    await waitFor(() => dataChannel.sent.length > 0);

    const hello = parseEnvelope(dataChannel.sent[0] as string);
    expect(hello).toMatchObject({
      source: 'flockjs',
      version: 1,
      signal: {
        type: 'hello',
        roomId: 'room-defaults',
        fromPeerId: 'peer-a',
        payload: {
          protocol,
        },
      },
    });

    await adapter.disconnect();
  });

  it('serializes ICE candidates without toJSON and preserves nullable fields', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push(['peer-b']);

    const adapter = createWebRTCTransportAdapter('room-candidate-fallback', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    await adapter.connect();
    await waitFor(() => MockRTCPeerConnection.instances.length === 1);

    const peerConnection = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    const signalingClient = signalingInstances[0] as MockSignalingClient;

    peerConnection.emitIceCandidate({
      candidate: 'candidate:fallback',
      sdpMid: null,
      sdpMLineIndex: null,
      usernameFragment: null,
    } as RTCIceCandidate);

    expect(signalingClient.sentSignals.at(-1)).toMatchObject({
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:fallback',
        sdpMid: null,
      },
    });

    await adapter.disconnect();
  });

  it('respects custom STUN URLs and maxPeers connection cap', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push(['peer-b', 'peer-c']);

    const adapter = createWebRTCTransportAdapter('room-limits', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
      maxPeers: 2,
      stunUrls: ['stun:custom.example:3478'],
    });

    await adapter.connect();
    await waitFor(() => MockRTCPeerConnection.instances.length === 1);

    const peerConnection = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    expect(peerConnection.configuration.iceServers).toEqual([
      {
        urls: 'stun:custom.example:3478',
      },
    ]);

    signalingInstances[0]?.emitPeerJoined('peer-d');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(MockRTCPeerConnection.instances.length).toBe(1);
    await adapter.disconnect();
  });

  it('routes inbound data-channel envelopes and supports targeted/broadcast sends', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push(['peer-b', 'peer-c']);

    const adapter = createWebRTCTransportAdapter('room-send', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    const onSignal = vi.fn();
    adapter.onMessage(onSignal);

    await adapter.connect();
    await waitFor(() => MockRTCPeerConnection.instances.length === 2);

    const peerConnectionB = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    const peerConnectionC = MockRTCPeerConnection.instances[1] as MockRTCPeerConnection;
    const dataChannelB = peerConnectionB.dataChannels[0] as MockRTCDataChannel;
    const dataChannelC = peerConnectionC.dataChannels[0] as MockRTCDataChannel;

    const inboundSignal = {
      type: 'presence:update',
      roomId: 'room-send',
      fromPeerId: 'peer-b',
      timestamp: 10,
      payload: {
        peer: {
          id: 'peer-b',
          joinedAt: 1,
          lastSeen: 10,
        },
      },
    };

    dataChannelB.receive(
      JSON.stringify({
        source: 'flockjs',
        version: 1,
        signal: inboundSignal,
      }),
    );
    dataChannelB.receive('not-json');

    expect(onSignal).toHaveBeenCalledWith(inboundSignal);

    const targetedSignal = {
      type: 'event',
      roomId: 'room-send',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: 11,
      payload: {
        name: 'targeted',
        payload: true,
      },
    } as const;

    adapter.send(targetedSignal);

    const targetBCount = dataChannelB.sent.length;
    const targetCCount = dataChannelC.sent.length;

    expect(targetBCount).toBeGreaterThan(0);
    expect(targetCCount).toBeLessThan(targetBCount);

    adapter.send({
      type: 'event',
      roomId: 'room-send',
      fromPeerId: 'peer-a',
      timestamp: 12,
      payload: {
        name: 'broadcast',
        payload: true,
      },
    });

    expect(dataChannelB.sent.length).toBeGreaterThan(targetBCount);
    expect(dataChannelC.sent.length).toBeGreaterThan(targetCCount);

    await adapter.disconnect();
  });

  it('processes pending ICE candidates and responds to remote offers', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push([]);

    const adapter = createWebRTCTransportAdapter('room-answer', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    await adapter.connect();

    const signaling = signalingInstances[0] as MockSignalingClient;

    signaling.emitSignal({
      type: 'signal',
      roomId: 'room-answer',
      fromPeerId: 'peer-b',
      toPeerId: 'peer-a',
      candidate: {
        candidate: 'candidate:pending',
      },
    });

    await waitFor(() => MockRTCPeerConnection.instances.length === 1);
    const peerConnection = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    expect(peerConnection.addedCandidates.length).toBe(0);

    signaling.emitSignal({
      type: 'signal',
      roomId: 'room-answer',
      fromPeerId: 'peer-b',
      toPeerId: 'peer-a',
      description: {
        type: 'offer',
        sdp: 'offer-remote',
      },
    });

    await waitFor(
      () =>
        signaling.sentSignals.some(
          (message) => message.toPeerId === 'peer-b' && message.description?.type === 'answer',
        ),
      1_000,
    );

    expect(peerConnection.addedCandidates).toContainEqual({
      candidate: 'candidate:pending',
    });

    await adapter.disconnect();
  });

  it('emits error and leave signals when ICE gathering times out', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    MockRTCPeerConnection.nextIceGatheringState = 'gathering';
    connectPeersQueue.push(['peer-b']);

    const adapter = createWebRTCTransportAdapter('room-timeout', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
      webrtc: {
        iceGatherTimeoutMs: 25,
      },
    });

    const onSignal = vi.fn();
    adapter.onMessage(onSignal);

    await adapter.connect();
    await waitFor(() => onSignal.mock.calls.length >= 2, 1_000);

    expect(signalingInstances[0]?.options.joinTimeoutMs).toBe(25);

    const emittedSignals = onSignal.mock.calls.map((entry) => entry[0]) as Array<
      Record<string, unknown>
    >;
    expect(
      emittedSignals.some(
        (signal) => signal.type === 'transport:error' && typeof signal.payload === 'object',
      ),
    ).toBe(true);
    expect(
      emittedSignals.some((signal) => signal.type === 'leave' && signal.fromPeerId === 'peer-b'),
    ).toBe(true);

    await adapter.disconnect();
  });

  it('emits leave when peer connection state transitions to failed', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push(['peer-b']);

    const adapter = createWebRTCTransportAdapter('room-failed-state', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    const onSignal = vi.fn();
    adapter.onMessage(onSignal);

    await adapter.connect();
    await waitFor(() => MockRTCPeerConnection.instances.length === 1);

    const peerConnection = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    peerConnection.setConnectionState('failed');

    await waitFor(() => onSignal.mock.calls.length > 0);
    expect(onSignal).toHaveBeenCalledWith({
      type: 'leave',
      roomId: 'room-failed-state',
      fromPeerId: 'peer-b',
      timestamp: expect.any(Number),
      payload: {},
    });

    await adapter.disconnect();
  });

  it('emits transport disconnected signal when signaling disconnects', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push([]);

    const adapter = createWebRTCTransportAdapter('room-disconnected', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    const onSignal = vi.fn();
    adapter.onMessage(onSignal);

    await adapter.connect();
    signalingInstances[0]?.emitDisconnected('socket-gone');

    await waitFor(() => onSignal.mock.calls.length > 0);

    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transport:disconnected',
        roomId: 'room-disconnected',
        fromPeerId: 'peer-a',
        payload: {
          reason: 'socket-gone',
        },
      }),
    );

    await adapter.disconnect();
  });

  it('closes resources on disconnect and handles non-initiator peers', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    connectPeersQueue.push(['peer-a']);

    const adapter = createWebRTCTransportAdapter('room-close', 'peer-z', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
    });

    await adapter.connect();
    expect(MockRTCPeerConnection.instances.length).toBe(0);

    signalingInstances[0]?.emitPeerJoined('peer-a');
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(MockRTCPeerConnection.instances.length).toBe(0);

    signalingInstances[0]?.emitPeerJoined('peer-zz');
    await waitFor(() => MockRTCPeerConnection.instances.length === 1);

    const peerConnection = MockRTCPeerConnection.instances[0] as MockRTCPeerConnection;
    const dataChannel = peerConnection.dataChannels[0] as MockRTCDataChannel;

    await adapter.disconnect();
    expect(signalingInstances[0]?.disconnectCalls).toBe(1);
    expect(peerConnection.closeCalls).toBe(1);
    expect(dataChannel.readyState).toBe(DATA_CHANNEL_CLOSED);

    await adapter.disconnect();
    expect(signalingInstances[0]?.disconnectCalls).toBe(1);
  });
});
