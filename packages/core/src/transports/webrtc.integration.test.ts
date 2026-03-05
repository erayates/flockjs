import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TransportSignal } from './transport';
import type { SignalingSignalMessage } from './webrtc.protocol';
import type { WebRTCSignalingClientOptions } from './webrtc.signaling';

const relayRooms = new Map<string, Map<string, RelayMockSignalingClient>>();

class RelayMockSignalingClient {
  public constructor(public readonly options: WebRTCSignalingClientOptions) {}

  public async connect(): Promise<string[]> {
    const room = relayRooms.get(this.options.roomId) ?? new Map<string, RelayMockSignalingClient>();
    const existingPeerIds = Array.from(room.keys());

    room.set(this.options.peerId, this);
    relayRooms.set(this.options.roomId, room);

    for (const [peerId, client] of room) {
      if (peerId === this.options.peerId) {
        continue;
      }

      client.options.onPeerJoined(this.options.peerId);
    }

    return existingPeerIds;
  }

  public async disconnect(): Promise<void> {
    const room = relayRooms.get(this.options.roomId);
    if (!room) {
      return;
    }

    const deleted = room.delete(this.options.peerId);
    if (!deleted) {
      return;
    }

    for (const client of room.values()) {
      client.options.onPeerLeft(this.options.peerId);
    }

    if (room.size === 0) {
      relayRooms.delete(this.options.roomId);
    }
  }

  public sendSignal(message: Omit<SignalingSignalMessage, 'type' | 'roomId' | 'fromPeerId'>): void {
    if (!message.toPeerId) {
      return;
    }

    const room = relayRooms.get(this.options.roomId);
    if (!room) {
      return;
    }

    const receiver = room.get(message.toPeerId);
    if (!receiver) {
      return;
    }

    const forwarded: SignalingSignalMessage = {
      type: 'signal',
      roomId: this.options.roomId,
      fromPeerId: this.options.peerId,
      toPeerId: message.toPeerId,
      ...(message.description ? { description: message.description } : {}),
      ...(message.candidate ? { candidate: message.candidate } : {}),
    };

    receiver.options.onSignal(forwarded);
  }
}

vi.mock('./webrtc.signaling', () => ({
  WebRTCSignalingClient: RelayMockSignalingClient,
}));

class MockRTCDataChannel {
  public readyState: RTCDataChannelState = 'connecting';

  public onopen: (() => void) | null = null;

  public onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

  public onclose: (() => void) | null = null;

  public onerror: (() => void) | null = null;

  private counterpart: MockRTCDataChannel | null = null;

  public constructor(
    public readonly label: string,
    public readonly options: RTCDataChannelInit,
  ) {}

  public link(counterpart: MockRTCDataChannel): void {
    this.counterpart = counterpart;
  }

  public send(payload: string): void {
    if (this.readyState !== 'open') {
      return;
    }

    this.counterpart?.onmessage?.({ data: payload } as MessageEvent<unknown>);
  }

  public close(): void {
    if (this.readyState === 'closed') {
      return;
    }

    const counterpart = this.counterpart;
    this.counterpart = null;
    this.readyState = 'closed';
    this.onclose?.();

    if (counterpart && counterpart.readyState !== 'closed') {
      counterpart.counterpart = null;
      counterpart.readyState = 'closed';
      counterpart.onclose?.();
    }
  }

  public open(): void {
    if (this.readyState === 'open') {
      return;
    }

    this.readyState = 'open';
    this.onopen?.();
  }
}

class MockRTCPeerConnection {
  public static instances: MockRTCPeerConnection[] = [];

  private static nextId = 1;

  public static reset(): void {
    this.instances = [];
    this.nextId = 1;
  }

  public readonly id = MockRTCPeerConnection.nextId++;

  public readonly addedCandidates: RTCIceCandidateInit[] = [];

  public onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;

  public ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;

  public onconnectionstatechange: (() => void) | null = null;

  public iceGatheringState: RTCIceGatheringState = 'complete';

  public connectionState: RTCPeerConnectionState = 'new';

  public localDescription: RTCSessionDescriptionInit | null = null;

  public remoteDescription: RTCSessionDescriptionInit | null = null;

  private partner: MockRTCPeerConnection | null = null;

  private initiatorDataChannel: MockRTCDataChannel | null = null;

  private remoteDataChannelEmitted = false;

  public constructor(public readonly configuration: RTCConfiguration) {
    const pendingPartner = MockRTCPeerConnection.instances.find((instance) => instance.partner === null);
    if (pendingPartner) {
      this.partner = pendingPartner;
      pendingPartner.partner = this;
    }

    MockRTCPeerConnection.instances.push(this);
  }

  public createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel {
    const channel = new MockRTCDataChannel(label, options ?? {});
    this.initiatorDataChannel = channel;
    return channel as unknown as RTCDataChannel;
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'offer',
      sdp: `offer-${this.id}`,
    };
  }

  public async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'answer',
      sdp: `answer-${this.id}`,
    };
  }

  public async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    const candidateId = this.id;

    const candidate = {
      candidate: `candidate:${candidateId}`,
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: null,
      toJSON() {
        return {
          candidate: `candidate:${candidateId}`,
          sdpMid: '0',
          sdpMLineIndex: 0,
        };
      },
    } as RTCIceCandidate;

    this.onicecandidate?.({ candidate } as RTCPeerConnectionIceEvent);
  }

  public async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;

    if (description.type !== 'offer') {
      return;
    }

    this.emitRemoteDataChannel();
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate);
  }

  public close(): void {
    this.connectionState = 'closed';
  }

  private emitRemoteDataChannel(): void {
    if (this.remoteDataChannelEmitted || !this.partner || !this.partner.initiatorDataChannel) {
      return;
    }

    this.remoteDataChannelEmitted = true;

    const initiatorChannel = this.partner.initiatorDataChannel;
    const remoteChannel = new MockRTCDataChannel(initiatorChannel.label, initiatorChannel.options);

    initiatorChannel.link(remoteChannel);
    remoteChannel.link(initiatorChannel);

    queueMicrotask(() => {
      this.ondatachannel?.({ channel: remoteChannel as unknown as RTCDataChannel } as RTCDataChannelEvent);
      initiatorChannel.open();
      remoteChannel.open();
    });
  }
}

const originalRTCPeerConnection = globalThis.RTCPeerConnection;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for condition after ${timeoutMs}ms.`);
    }

    await wait(10);
  }
}

beforeEach(() => {
  vi.resetModules();
  relayRooms.clear();
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

describe('WebRTC transport integration (mock relay semantics)', () => {
  it('establishes two-peer datachannel flow and lifecycle signaling', async () => {
    const { createWebRTCTransportAdapter } = await import('./webrtc');

    const adapterA = createWebRTCTransportAdapter('room-integration', 'peer-a', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
      maxPeers: 4,
    });
    const adapterB = createWebRTCTransportAdapter('room-integration', 'peer-b', {
      transport: 'webrtc',
      relayUrl: 'ws://relay.local',
      maxPeers: 4,
    });

    const receivedByA: TransportSignal[] = [];
    const receivedByB: TransportSignal[] = [];
    adapterA.subscribe((signal) => {
      receivedByA.push(signal);
    });
    adapterB.subscribe((signal) => {
      receivedByB.push(signal);
    });

    await Promise.all([adapterA.connect(), adapterB.connect()]);

    await waitFor(() => {
      const helloFromB = receivedByA.some((signal) => signal.type === 'hello' && signal.fromPeerId === 'peer-b');
      const helloFromA = receivedByB.some((signal) => signal.type === 'hello' && signal.fromPeerId === 'peer-a');
      return helloFromA && helloFromB;
    });

    adapterA.send({
      type: 'event',
      roomId: 'room-integration',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      payload: {
        event: {
          name: 'ping',
          payload: true,
        },
      },
    });

    await waitFor(() => {
      return receivedByB.some((signal) => {
        return (
          signal.type === 'event' &&
          signal.fromPeerId === 'peer-a' &&
          signal.toPeerId === 'peer-b'
        );
      });
    });

    expect(MockRTCPeerConnection.instances).toHaveLength(2);
    expect(
      MockRTCPeerConnection.instances.every((instance) => {
        return instance.configuration.iceServers?.[0]?.urls === 'stun:stun.l.google.com:19302';
      }),
    ).toBe(true);

    await adapterB.disconnect();
    await waitFor(() => {
      return receivedByA.some((signal) => signal.type === 'leave' && signal.fromPeerId === 'peer-b');
    });

    await adapterA.disconnect();
  });
});
