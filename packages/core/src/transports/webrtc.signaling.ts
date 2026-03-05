import { createFlockError } from '../flock-error';
import { env } from '../internal/env';
import type { FlockError, RelayAuthToken } from '../types';
import {
  parseSignalingServerMessage,
  serializeSignalingMessage,
  type SignalingSignalMessage,
} from './webrtc.protocol';

const DEFAULT_JOIN_TIMEOUT_MS = 5_000;
const WEBSOCKET_OPEN = 1;
const SIGNALING_FAILURE_KINDS = new Set<string>([
  'socket-unavailable',
  'socket-error',
  'socket-closed-during-join',
  'join-timeout',
  'server-rejected',
]);
const FALLBACK_ELIGIBLE_FAILURE_KINDS = new Set<string>([
  'socket-unavailable',
  'socket-error',
  'socket-closed-during-join',
  'join-timeout',
]);

interface MessageEventLike {
  data: unknown;
}

interface CloseEventLike {
  reason?: string;
}

interface EventTargetLike {
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: (event: CloseEventLike) => void): void;
  removeEventListener(type: 'open', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'error', listener: () => void): void;
  removeEventListener(type: 'close', listener: (event: CloseEventLike) => void): void;
}

export interface WebSocketLike extends EventTargetLike {
  readonly readyState: number;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type WebRTCSignalingFailureKind =
  | 'socket-unavailable'
  | 'socket-error'
  | 'socket-closed-during-join'
  | 'join-timeout'
  | 'server-rejected';

export interface WebRTCSignalingFailure {
  source: 'webrtc-signaling';
  kind: WebRTCSignalingFailureKind;
  serverCode?: string;
}

export interface WebRTCSignalingClientOptions {
  roomId: string;
  peerId: string;
  relayUrl: string;
  relayAuth?: RelayAuthToken;
  joinTimeoutMs?: number;
  createWebSocket?: WebSocketFactory;
  onPeerJoined(peerId: string): void;
  onPeerLeft(peerId: string): void;
  onSignal(message: SignalingSignalMessage): void;
  onDisconnected(reason?: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createWebRTCSignalingFailure(
  kind: WebRTCSignalingFailureKind,
  serverCode?: string,
): WebRTCSignalingFailure {
  return serverCode === undefined
    ? {
        source: 'webrtc-signaling',
        kind,
      }
    : {
        source: 'webrtc-signaling',
        kind,
        serverCode,
      };
}

function isWebRTCSignalingFailure(value: unknown): value is WebRTCSignalingFailure {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.source === 'webrtc-signaling' &&
    typeof value.kind === 'string' &&
    SIGNALING_FAILURE_KINDS.has(value.kind) &&
    (value.serverCode === undefined || typeof value.serverCode === 'string')
  );
}

export function readWebRTCSignalingFailure(error: unknown): WebRTCSignalingFailure | null {
  if (isWebRTCSignalingFailure(error)) {
    return error;
  }

  if (error instanceof Error && 'cause' in error) {
    return readWebRTCSignalingFailure(error.cause);
  }

  return null;
}

export function isWebRTCSignalingFallbackEligibleError(error: unknown): boolean {
  const failure = readWebRTCSignalingFailure(error);
  return failure !== null && FALLBACK_ELIGIBLE_FAILURE_KINDS.has(failure.kind);
}

function resolveWebSocketFactory(factory?: WebSocketFactory): WebSocketFactory {
  if (factory) {
    return factory;
  }

  if (!env.hasWebSocket) {
    throw createFlockError(
      'NETWORK_ERROR',
      'WebSocket is required for WebRTC signaling but is not available in this runtime.',
      false,
      createWebRTCSignalingFailure('socket-unavailable'),
    );
  }

  return (url: string) => {
    return new WebSocket(url);
  };
}

async function resolveRelayAuthToken(
  relayAuth: RelayAuthToken | undefined,
): Promise<string | undefined> {
  if (relayAuth === undefined) {
    return undefined;
  }

  if (typeof relayAuth === 'string') {
    return relayAuth;
  }

  const token = await relayAuth();
  return token;
}

function toSignalingError(message: string, cause?: unknown): FlockError {
  return createFlockError('NETWORK_ERROR', message, false, cause);
}

function isOpen(socket: WebSocketLike): boolean {
  return socket.readyState === WEBSOCKET_OPEN;
}

export class WebRTCSignalingClient {
  private readonly createWebSocket: WebSocketFactory;

  private socket: WebSocketLike | null = null;

  private connected = false;

  private joinPromise: Promise<string[]> | null = null;

  private readonly onOpen = (): void => {
    return undefined;
  };

  private readonly onMessage = (event: MessageEventLike): void => {
    const message = parseSignalingServerMessage(event.data);
    if (!message) {
      return;
    }

    if (message.type === 'peer-joined') {
      this.options.onPeerJoined(message.peerId);
      return;
    }

    if (message.type === 'peer-left') {
      this.options.onPeerLeft(message.peerId);
      return;
    }

    if (message.type === 'signal') {
      this.options.onSignal(message);
      return;
    }

    if (message.type === 'error') {
      this.options.onDisconnected(message.message);
    }
  };

  private readonly onError = (): void => {
    if (!this.connected) {
      return;
    }

    this.options.onDisconnected('Signaling socket error.');
  };

  private readonly onClose = (event: CloseEventLike): void => {
    const reason = typeof event.reason === 'string' ? event.reason : 'Signaling socket closed.';
    if (this.connected) {
      this.connected = false;
      this.options.onDisconnected(reason);
    }
  };

  public constructor(private readonly options: WebRTCSignalingClientOptions) {
    this.createWebSocket = resolveWebSocketFactory(options.createWebSocket);
  }

  public async connect(): Promise<string[]> {
    if (this.connected && this.socket) {
      return [];
    }

    if (this.joinPromise) {
      return this.joinPromise;
    }

    this.joinPromise = this.connectInternal();

    try {
      const peers = await this.joinPromise;
      return peers;
    } finally {
      this.joinPromise = null;
    }
  }

  public async disconnect(): Promise<void> {
    const socket = this.socket;
    this.connected = false;
    this.socket = null;

    if (!socket) {
      return;
    }

    socket.removeEventListener('open', this.onOpen);
    socket.removeEventListener('message', this.onMessage);
    socket.removeEventListener('error', this.onError);
    socket.removeEventListener('close', this.onClose);

    if (isOpen(socket)) {
      socket.send(
        serializeSignalingMessage({
          type: 'leave',
          roomId: this.options.roomId,
          peerId: this.options.peerId,
        }),
      );
    }

    socket.close(1000, 'disconnect');
  }

  public sendSignal(message: Omit<SignalingSignalMessage, 'type' | 'roomId' | 'fromPeerId'>): void {
    const socket = this.socket;
    if (!socket || !this.connected || !isOpen(socket)) {
      return;
    }

    const signalMessage: SignalingSignalMessage = {
      type: 'signal',
      roomId: this.options.roomId,
      fromPeerId: this.options.peerId,
      toPeerId: message.toPeerId,
    };

    if (message.description) {
      signalMessage.description = message.description;
    }

    if (message.candidate) {
      signalMessage.candidate = message.candidate;
    }

    socket.send(serializeSignalingMessage(signalMessage));
  }

  private async connectInternal(): Promise<string[]> {
    const relayAuthToken = await resolveRelayAuthToken(this.options.relayAuth);
    const socket = this.createWebSocket(this.options.relayUrl);
    this.socket = socket;

    socket.addEventListener('open', this.onOpen);
    socket.addEventListener('message', this.onMessage);
    socket.addEventListener('error', this.onError);
    socket.addEventListener('close', this.onClose);

    const timeoutMs = this.options.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;

    return new Promise<string[]>((resolve, reject) => {
      let settled = false;
      let cleanup = (): void => {
        return undefined;
      };

      const finish = (result: string[] | FlockError): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        cleanup();

        if (Array.isArray(result)) {
          resolve(result);
        } else {
          reject(result);
        }
      };

      const timeout = setTimeout(() => {
        finish(
          toSignalingError(
            `Timed out waiting for signaling join acknowledgement (${timeoutMs}ms).`,
            createWebRTCSignalingFailure('join-timeout'),
          ),
        );
      }, timeoutMs);

      const onOpen = (): void => {
        const joinMessage = {
          type: 'join',
          roomId: this.options.roomId,
          peerId: this.options.peerId,
        } as const;

        const payload = serializeSignalingMessage(
          relayAuthToken === undefined
            ? joinMessage
            : {
                ...joinMessage,
                token: relayAuthToken,
              },
        );

        socket.send(payload);
      };

      const onMessage = (event: MessageEventLike): void => {
        const message = parseSignalingServerMessage(event.data);
        if (!message) {
          return;
        }

        if (message.type === 'joined') {
          this.connected = true;
          finish(message.peers.filter((peerId) => peerId !== this.options.peerId));
          return;
        }

        if (message.type === 'error') {
          finish(
            toSignalingError(
              message.message,
              createWebRTCSignalingFailure('server-rejected', message.code),
            ),
          );
        }
      };

      const onError = (): void => {
        finish(
          toSignalingError(
            'Failed to establish signaling socket.',
            createWebRTCSignalingFailure('socket-error'),
          ),
        );
      };

      const onClose = (event: CloseEventLike): void => {
        const reason = typeof event.reason === 'string' ? event.reason : 'Signaling socket closed.';
        finish(toSignalingError(reason, createWebRTCSignalingFailure('socket-closed-during-join')));
      };

      cleanup = (): void => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }
}
