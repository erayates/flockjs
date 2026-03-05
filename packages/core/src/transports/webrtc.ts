import { createFlockError } from '../flock-error';
import { env } from '../internal/env';
import type { FlockError, PresenceData, RoomOptions } from '../types';
import type { TransportAdapter, TransportSignal } from './transport';
import { type SignalingServerMessage, type SignalingSignalMessage } from './webrtc.protocol';
import { WebRTCSignalingClient, type WebRTCSignalingClientOptions } from './webrtc.signaling';

const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302';
const DEFAULT_ICE_GATHER_TIMEOUT_MS = 5_000;
const DEFAULT_DATA_CHANNEL_PROTOCOL = 'flockjs-v1';
const DATA_CHANNEL_SOURCE = 'flockjs';
const DATA_CHANNEL_VERSION = 1;
const DATA_CHANNEL_OPEN = 'open';
const DATA_CHANNEL_CLOSED = 'closed';
const PEER_CONNECTION_CLOSED = 'closed';
const PEER_FAILURE_STATES = new Set<RTCPeerConnectionState>(['failed', 'disconnected', 'closed']);
const SIGNAL_TYPES = new Set<string>([
  'hello',
  'welcome',
  'presence:update',
  'leave',
  'cursor:update',
  'awareness:update',
  'event',
]);

interface DataChannelEnvelope {
  source: typeof DATA_CHANNEL_SOURCE;
  version: typeof DATA_CHANNEL_VERSION;
  signal: TransportSignal;
}

interface PeerConnectionContext {
  peerId: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  pendingCandidates: RTCIceCandidateInit[];
  closed: boolean;
  leaveEmitted: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTransportSignalType(value: unknown): value is TransportSignal['type'] {
  return typeof value === 'string' && SIGNAL_TYPES.has(value);
}

function isTransportSignal(value: unknown): value is TransportSignal {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isTransportSignalType(value.type) &&
    typeof value.roomId === 'string' &&
    typeof value.fromPeerId === 'string' &&
    (value.toPeerId === undefined || typeof value.toPeerId === 'string')
  );
}

function serializeDataChannelSignal(signal: TransportSignal): string {
  const envelope: DataChannelEnvelope = {
    source: DATA_CHANNEL_SOURCE,
    version: DATA_CHANNEL_VERSION,
    signal,
  };

  return JSON.stringify(envelope);
}

function deserializeDataChannelSignal(payload: unknown): TransportSignal | null {
  if (typeof payload !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (parsed.source !== DATA_CHANNEL_SOURCE || parsed.version !== DATA_CHANNEL_VERSION) {
    return null;
  }

  if (!isTransportSignal(parsed.signal)) {
    return null;
  }

  return parsed.signal;
}

function toPlainCandidate(candidate: RTCIceCandidate): RTCIceCandidateInit {
  if (typeof candidate.toJSON === 'function') {
    return candidate.toJSON();
  }

  const plainCandidate: RTCIceCandidateInit = {
    candidate: candidate.candidate,
  };

  if (candidate.sdpMid !== null) {
    plainCandidate.sdpMid = candidate.sdpMid;
  } else {
    plainCandidate.sdpMid = null;
  }

  if (candidate.sdpMLineIndex !== null) {
    plainCandidate.sdpMLineIndex = candidate.sdpMLineIndex;
  }

  if (candidate.usernameFragment !== null) {
    plainCandidate.usernameFragment = candidate.usernameFragment;
  }

  return plainCandidate;
}

function toPlainDescription(
  description: RTCSessionDescription | RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  if ('toJSON' in description && typeof description.toJSON === 'function') {
    return description.toJSON();
  }

  return {
    type: description.type,
    sdp: description.sdp ?? '',
  };
}

function toFlockError(message: string, cause?: unknown): FlockError {
  return createFlockError('NETWORK_ERROR', message, false, cause);
}

function resolveRelayUrl<TPresence extends PresenceData>(options: RoomOptions<TPresence>): string {
  const relayUrl = options.relayUrl;
  if (!relayUrl || relayUrl.trim().length === 0) {
    throw toFlockError('WebRTC transport requires `relayUrl` for signaling.');
  }

  return relayUrl;
}

function getRTCPeerConnectionConstructor(): typeof RTCPeerConnection {
  if (!env.hasRTCPeerConnection) {
    throw toFlockError('RTCPeerConnection is not available in this runtime.');
  }

  return RTCPeerConnection;
}

export class WebRTCTransportAdapter<
  TPresence extends PresenceData = PresenceData,
> implements TransportAdapter {
  public readonly kind = 'webrtc' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private readonly relayUrl: string;

  private readonly peerConnections = new Map<string, PeerConnectionContext>();

  private readonly localJoinedAt = Date.now();

  private signalingClient: WebRTCSignalingClient | null = null;

  private connected = false;

  private readonly maxRemotePeers: number;

  private readonly iceGatherTimeoutMs: number;

  private readonly dataChannelOptions: RTCDataChannelInit;

  private readonly dataChannelProtocol: string;

  private readonly peerPresencePayload: Record<string, unknown>;

  private readonly PeerConnectionCtor: typeof RTCPeerConnection;

  public constructor(
    private readonly roomId: string,
    private readonly peerId: string,
    private readonly options: RoomOptions<TPresence>,
  ) {
    this.relayUrl = resolveRelayUrl(options);
    this.PeerConnectionCtor = getRTCPeerConnectionConstructor();
    this.maxRemotePeers =
      options.maxPeers === undefined ? Number.POSITIVE_INFINITY : Math.max(options.maxPeers - 1, 0);
    this.iceGatherTimeoutMs = options.webrtc?.iceGatherTimeoutMs ?? DEFAULT_ICE_GATHER_TIMEOUT_MS;
    this.dataChannelOptions = this.resolveDataChannelOptions();
    this.dataChannelProtocol =
      options.webrtc?.dataChannel?.protocol ?? DEFAULT_DATA_CHANNEL_PROTOCOL;
    this.peerPresencePayload = isRecord(options.presence) ? options.presence : {};
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const signalingOptions: WebRTCSignalingClientOptions = {
      roomId: this.roomId,
      peerId: this.peerId,
      relayUrl: this.relayUrl,
      joinTimeoutMs: this.iceGatherTimeoutMs,
      onPeerJoined: (peerId: string) => {
        void this.handlePeerJoined(peerId);
      },
      onPeerLeft: (peerId: string) => {
        this.closePeerConnection(peerId, {
          emitLeave: true,
        });
      },
      onSignal: (message: SignalingSignalMessage) => {
        void this.handleSignalingMessage(message);
      },
      onDisconnected: (reason?: string) => {
        this.connected = false;
        this.emitErrorSignal(toFlockError(reason ?? 'Signaling channel disconnected.'));
      },
      ...(this.options.relayAuth !== undefined ? { relayAuth: this.options.relayAuth } : {}),
    };
    const signalingClient = new WebRTCSignalingClient(signalingOptions);

    this.signalingClient = signalingClient;

    try {
      const peers = await signalingClient.connect();
      this.connected = true;

      for (const remotePeerId of peers) {
        await this.handlePeerJoined(remotePeerId);
      }
    } catch (error) {
      this.signalingClient = null;
      this.connected = false;
      throw toFlockError('Failed to initialize WebRTC signaling.', error);
    }
  }

  public async disconnect(): Promise<void> {
    this.connected = false;

    const signalingClient = this.signalingClient;
    this.signalingClient = null;

    if (signalingClient) {
      await signalingClient.disconnect();
    }

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.closePeerConnection(peerId, {
        emitLeave: false,
      });
    }

    this.peerConnections.clear();
    this.listeners.clear();
  }

  public send(signal: TransportSignal): void {
    if (!this.connected) {
      return;
    }

    if (signal.toPeerId) {
      this.sendToPeer(signal.toPeerId, signal);
      return;
    }

    for (const peerId of this.peerConnections.keys()) {
      this.sendToPeer(peerId, signal);
    }
  }

  public subscribe(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private createPeerConnection(remotePeerId: string): PeerConnectionContext {
    const existing = this.peerConnections.get(remotePeerId);
    if (existing) {
      return existing;
    }

    const peerConnection = new this.PeerConnectionCtor({
      iceServers:
        this.options.stunUrls && this.options.stunUrls.length > 0
          ? this.options.stunUrls.map((url) => ({ urls: url }))
          : [{ urls: DEFAULT_STUN_URL }],
    });

    const context: PeerConnectionContext = {
      peerId: remotePeerId,
      peerConnection,
      dataChannel: null,
      pendingCandidates: [],
      closed: false,
      leaveEmitted: false,
    };

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !this.signalingClient) {
        return;
      }

      this.signalingClient.sendSignal({
        toPeerId: remotePeerId,
        candidate: toPlainCandidate(event.candidate),
      });
    };

    peerConnection.ondatachannel = (event) => {
      this.attachDataChannel(context, event.channel);
    };

    peerConnection.onconnectionstatechange = () => {
      if (PEER_FAILURE_STATES.has(peerConnection.connectionState)) {
        this.closePeerConnection(remotePeerId, {
          emitLeave: true,
        });
      }
    };

    this.peerConnections.set(remotePeerId, context);
    return context;
  }

  private createInitiatorDataChannel(context: PeerConnectionContext): RTCDataChannel {
    const channel = context.peerConnection.createDataChannel(
      this.dataChannelProtocol,
      this.dataChannelOptions,
    );

    this.attachDataChannel(context, channel);
    return channel;
  }

  private attachDataChannel(context: PeerConnectionContext, channel: RTCDataChannel): void {
    context.dataChannel = channel;

    channel.onopen = () => {
      this.sendBootstrapHello(context.peerId);
    };

    channel.onmessage = (event) => {
      const signal = deserializeDataChannelSignal(event.data);
      if (!signal) {
        return;
      }

      this.emitTransportSignal(signal);
    };

    channel.onclose = () => {
      this.closePeerConnection(context.peerId, {
        emitLeave: true,
      });
    };

    channel.onerror = () => {
      return undefined;
    };
  }

  private async handlePeerJoined(remotePeerId: string): Promise<void> {
    if (remotePeerId === this.peerId) {
      return;
    }

    if (!this.shouldInitiate(remotePeerId) || !this.canCreatePeerContext(remotePeerId)) {
      return;
    }

    await this.createAndSendOffer(remotePeerId);
  }

  private async handleSignalingMessage(message: SignalingServerMessage): Promise<void> {
    if (message.type !== 'signal' || message.toPeerId !== this.peerId) {
      return;
    }

    if (!this.canCreatePeerContext(message.fromPeerId)) {
      return;
    }

    const context = this.createPeerConnection(message.fromPeerId);

    try {
      if (message.description) {
        await this.handleRemoteDescription(context, message);
      }

      if (message.candidate) {
        await this.handleRemoteCandidate(context, message.candidate);
      }
    } catch (error) {
      this.emitErrorSignal(
        toFlockError(`Failed to process signaling message from ${message.fromPeerId}.`, error),
      );
      this.closePeerConnection(message.fromPeerId, {
        emitLeave: true,
      });
    }
  }

  private async handleRemoteDescription(
    context: PeerConnectionContext,
    message: SignalingSignalMessage,
  ): Promise<void> {
    const description = message.description;
    if (!description) {
      return;
    }

    await context.peerConnection.setRemoteDescription(description);

    if (description.type === 'offer') {
      const answer = await context.peerConnection.createAnswer();
      await context.peerConnection.setLocalDescription(answer);
      await this.waitForIceGatheringComplete(context.peerConnection, context.peerId);

      const localDescription = context.peerConnection.localDescription;
      if (!localDescription) {
        throw toFlockError('Missing local description while responding to WebRTC offer.');
      }

      this.signalingClient?.sendSignal({
        toPeerId: context.peerId,
        description: toPlainDescription(localDescription),
      });
    }

    await this.flushPendingCandidates(context);
  }

  private async handleRemoteCandidate(
    context: PeerConnectionContext,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    if (!context.peerConnection.remoteDescription) {
      context.pendingCandidates.push(candidate);
      return;
    }

    await context.peerConnection.addIceCandidate(candidate);
  }

  private async flushPendingCandidates(context: PeerConnectionContext): Promise<void> {
    if (context.pendingCandidates.length === 0) {
      return;
    }

    for (const candidate of context.pendingCandidates) {
      await context.peerConnection.addIceCandidate(candidate);
    }

    context.pendingCandidates.length = 0;
  }

  private async createAndSendOffer(remotePeerId: string): Promise<void> {
    const context = this.createPeerConnection(remotePeerId);

    try {
      if (!context.dataChannel) {
        this.createInitiatorDataChannel(context);
      }

      const offer = await context.peerConnection.createOffer();
      await context.peerConnection.setLocalDescription(offer);
      await this.waitForIceGatheringComplete(context.peerConnection, remotePeerId);

      const localDescription = context.peerConnection.localDescription;
      if (!localDescription) {
        throw toFlockError('Missing local description while creating WebRTC offer.');
      }

      this.signalingClient?.sendSignal({
        toPeerId: remotePeerId,
        description: toPlainDescription(localDescription),
      });
    } catch (error) {
      this.emitErrorSignal(
        toFlockError(`Failed to establish WebRTC connection to ${remotePeerId}.`, error),
      );
      this.closePeerConnection(remotePeerId, {
        emitLeave: true,
      });
    }
  }

  private async waitForIceGatheringComplete(
    peerConnection: RTCPeerConnection,
    remotePeerId: string,
  ): Promise<void> {
    if (peerConnection.iceGatheringState === 'complete') {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        if (peerConnection.iceGatheringState === 'complete') {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 25);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        reject(
          toFlockError(
            `ICE candidate gathering timed out after ${this.iceGatherTimeoutMs}ms for peer ${remotePeerId}.`,
            {
              elapsedMs: Date.now() - startedAt,
            },
          ),
        );
      }, this.iceGatherTimeoutMs);
    });
  }

  private sendToPeer(remotePeerId: string, signal: TransportSignal): void {
    const context = this.peerConnections.get(remotePeerId);
    if (!context || context.closed || !context.dataChannel) {
      return;
    }

    if (context.dataChannel.readyState !== DATA_CHANNEL_OPEN) {
      return;
    }

    const serialized = serializeDataChannelSignal(signal);
    context.dataChannel.send(serialized);
  }

  private sendBootstrapHello(remotePeerId: string): void {
    const peerPayload = {
      id: this.peerId,
      joinedAt: this.localJoinedAt,
      lastSeen: Date.now(),
      ...this.peerPresencePayload,
    };

    const helloSignal: TransportSignal = {
      type: 'hello',
      roomId: this.roomId,
      fromPeerId: this.peerId,
      payload: {
        peer: peerPayload,
      },
    };

    this.sendToPeer(remotePeerId, helloSignal);
  }

  private closePeerConnection(
    remotePeerId: string,
    options: {
      emitLeave: boolean;
    },
  ): void {
    const context = this.peerConnections.get(remotePeerId);
    if (!context) {
      return;
    }

    if (context.closed) {
      return;
    }

    context.closed = true;
    this.peerConnections.delete(remotePeerId);

    const dataChannel = context.dataChannel;
    if (dataChannel && dataChannel.readyState !== DATA_CHANNEL_CLOSED) {
      dataChannel.onopen = null;
      dataChannel.onmessage = null;
      dataChannel.onclose = null;
      dataChannel.onerror = null;
      dataChannel.close();
    }

    if (context.peerConnection.connectionState !== PEER_CONNECTION_CLOSED) {
      context.peerConnection.onicecandidate = null;
      context.peerConnection.ondatachannel = null;
      context.peerConnection.onconnectionstatechange = null;
      context.peerConnection.close();
    }

    if (options.emitLeave && !context.leaveEmitted) {
      context.leaveEmitted = true;
      this.emitTransportSignal({
        type: 'leave',
        roomId: this.roomId,
        fromPeerId: remotePeerId,
      });
    }
  }

  private emitTransportSignal(signal: TransportSignal): void {
    for (const listener of this.listeners) {
      listener(signal);
    }
  }

  private emitErrorSignal(error: FlockError): void {
    this.emitTransportSignal({
      type: 'event',
      roomId: this.roomId,
      fromPeerId: this.peerId,
      payload: {
        event: {
          name: '__transport:error__',
          payload: {
            code: error.code,
            message: error.message,
          },
        },
      },
    });
  }

  private shouldInitiate(remotePeerId: string): boolean {
    return this.peerId < remotePeerId;
  }

  private canCreatePeerContext(remotePeerId: string): boolean {
    if (this.peerConnections.has(remotePeerId)) {
      return true;
    }

    return this.peerConnections.size < this.maxRemotePeers;
  }

  private resolveDataChannelOptions(): RTCDataChannelInit {
    const options: RTCDataChannelInit = {
      ordered: this.options.webrtc?.dataChannel?.ordered ?? true,
    };

    const maxRetransmits = this.options.webrtc?.dataChannel?.maxRetransmits;
    if (maxRetransmits !== undefined) {
      options.maxRetransmits = maxRetransmits;
    }

    return options;
  }
}

export function createWebRTCTransportAdapter<TPresence extends PresenceData = PresenceData>(
  roomId: string,
  peerId: string,
  options: RoomOptions<TPresence>,
): TransportAdapter {
  return new WebRTCTransportAdapter(roomId, peerId, options);
}
