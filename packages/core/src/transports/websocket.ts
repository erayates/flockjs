import { createFlockError } from '../flock-error';
import { env } from '../internal/env';
import type { FlockError, PresenceData, RelayAuthToken, RoomOptions } from '../types';
import { toBroadcastSignal, type TransportAdapter, type TransportSignal } from './transport';
import { isRoomTransportSignal } from './transport.protocol';
import {
  parseWebSocketRelayServerMessage,
  serializeWebSocketRelayMessage,
  type WebSocketRelayServerMessage,
} from './websocket.protocol';

const DEFAULT_JOIN_TIMEOUT_MS = 5_000;
const WEBSOCKET_OPEN = 1;

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

function resolveRelayUrl<TPresence extends PresenceData>(options: RoomOptions<TPresence>): string {
  const relayUrl = options.relayUrl;
  if (!relayUrl || relayUrl.trim().length === 0) {
    throw createWebSocketTransportError('WebSocket transport requires `relayUrl`.');
  }

  return relayUrl;
}

function resolveWebSocketFactory(factory?: WebSocketFactory): WebSocketFactory {
  if (factory) {
    return factory;
  }

  if (!env.hasWebSocket) {
    throw createWebSocketTransportError('WebSocket transport is not available in this runtime.');
  }

  return (url: string) => {
    return new WebSocket(url);
  };
}

function createWebSocketTransportError(message: string, cause?: unknown): FlockError {
  return createFlockError('NETWORK_ERROR', message, false, cause);
}

function createRelayMessageError(message: string, serverCode: string): FlockError {
  return createFlockError(
    serverCode === 'AUTH_FAILED' ? 'AUTH_FAILED' : 'NETWORK_ERROR',
    message,
    false,
    {
      source: 'websocket-relay',
      serverCode,
    },
  );
}

function isOpen(socket: WebSocketLike): boolean {
  return socket.readyState === WEBSOCKET_OPEN;
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

  return relayAuth();
}

export class WebSocketTransportAdapter<
  TPresence extends PresenceData = PresenceData,
> implements TransportAdapter {
  public readonly kind = 'websocket' as const;

  private readonly listeners = new Set<(signal: TransportSignal) => void>();

  private readonly relayUrl: string;

  private readonly createWebSocket: WebSocketFactory;

  private socket: WebSocketLike | null = null;

  private connected = false;

  private joinPromise: Promise<void> | null = null;

  private readonly handleSocketMessage = (event: MessageEventLike): void => {
    const message = parseWebSocketRelayServerMessage(event.data);
    if (!message) {
      return;
    }

    this.handleServerMessage(message);
  };

  private readonly handleSocketError = (): void => {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.emitDisconnectedSignal('Relay socket error.');
  };

  private readonly handleSocketClose = (event: CloseEventLike): void => {
    if (!this.connected) {
      return;
    }

    this.connected = false;
    this.emitDisconnectedSignal(
      typeof event.reason === 'string' && event.reason.length > 0
        ? event.reason
        : 'Relay socket closed.',
    );
  };

  public constructor(
    private readonly roomId: string,
    private readonly peerId: string,
    private readonly options: RoomOptions<TPresence>,
    createWebSocket?: WebSocketFactory,
  ) {
    this.relayUrl = resolveRelayUrl(options);
    this.createWebSocket = resolveWebSocketFactory(createWebSocket);
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.joinPromise) {
      return this.joinPromise;
    }

    this.joinPromise = this.connectInternal();

    try {
      await this.joinPromise;
    } finally {
      this.joinPromise = null;
    }
  }

  public async disconnect(): Promise<void> {
    const socket = this.socket;
    this.connected = false;
    this.socket = null;

    if (!socket) {
      this.listeners.clear();
      return;
    }

    socket.removeEventListener('message', this.handleSocketMessage);
    socket.removeEventListener('error', this.handleSocketError);
    socket.removeEventListener('close', this.handleSocketClose);

    if (isOpen(socket)) {
      socket.send(
        serializeWebSocketRelayMessage({
          type: 'leave',
          roomId: this.roomId,
          peerId: this.peerId,
        }),
      );
    }

    socket.close(1000, 'disconnect');
    this.listeners.clear();
  }

  public send(signal: TransportSignal): void {
    if (!signal.toPeerId) {
      this.broadcast(signal);
      return;
    }

    this.sendSignal(signal);
  }

  public broadcast(signal: TransportSignal): void {
    this.sendSignal(toBroadcastSignal(signal));
  }

  public onMessage(handler: (signal: TransportSignal) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private async connectInternal(): Promise<void> {
    const relayAuthToken = await resolveRelayAuthToken(this.options.relayAuth);
    const socket = this.createWebSocket(this.relayUrl);
    this.socket = socket;

    const timeoutMs = DEFAULT_JOIN_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onClose);
      };

      const fail = (error: FlockError): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        cleanup();
        this.socket = null;
        socket.close(1000, 'connect-failed');
        reject(error);
      };

      const succeed = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        cleanup();
        this.connected = true;
        socket.addEventListener('message', this.handleSocketMessage);
        socket.addEventListener('error', this.handleSocketError);
        socket.addEventListener('close', this.handleSocketClose);
        resolve();
      };

      const timeout = setTimeout(() => {
        fail(
          createWebSocketTransportError(
            `Timed out waiting for relay join acknowledgement (${timeoutMs}ms).`,
          ),
        );
      }, timeoutMs);

      const onOpen = (): void => {
        const joinMessage = {
          type: 'join',
          roomId: this.roomId,
          peerId: this.peerId,
        } as const;

        socket.send(
          serializeWebSocketRelayMessage(
            relayAuthToken === undefined
              ? joinMessage
              : {
                  ...joinMessage,
                  token: relayAuthToken,
                },
          ),
        );
      };

      const onMessage = (event: MessageEventLike): void => {
        const message = parseWebSocketRelayServerMessage(event.data);
        if (!message) {
          return;
        }

        if (message.type === 'joined') {
          succeed();
          return;
        }

        if (message.type === 'error') {
          fail(createRelayMessageError(message.message, message.code));
        }
      };

      const onError = (): void => {
        fail(createWebSocketTransportError('Failed to establish relay socket.'));
      };

      const onClose = (event: CloseEventLike): void => {
        fail(
          createWebSocketTransportError(
            typeof event.reason === 'string' && event.reason.length > 0
              ? event.reason
              : 'Relay socket closed.',
          ),
        );
      };

      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
    });
  }

  private handleServerMessage(message: WebSocketRelayServerMessage): void {
    if (message.type === 'transport') {
      this.emitTransportSignal(message.signal);
      return;
    }

    if (message.type === 'peer-left') {
      this.emitTransportSignal({
        type: 'leave',
        roomId: message.roomId,
        fromPeerId: message.peerId,
      });
      return;
    }

    if (message.type === 'error') {
      this.emitErrorSignal(createRelayMessageError(message.message, message.code));
    }
  }

  private sendSignal(signal: TransportSignal): void {
    const socket = this.socket;
    if (!socket || !this.connected || !isOpen(socket)) {
      return;
    }

    if (!isRoomTransportSignal(signal)) {
      return;
    }

    socket.send(
      serializeWebSocketRelayMessage({
        type: 'transport',
        signal,
      }),
    );
  }

  private emitTransportSignal(signal: TransportSignal): void {
    for (const listener of this.listeners) {
      listener(signal);
    }
  }

  private emitErrorSignal(error: FlockError): void {
    this.emitTransportSignal({
      type: 'transport:error',
      roomId: this.roomId,
      fromPeerId: this.peerId,
      payload: {
        error,
      },
    });
  }

  private emitDisconnectedSignal(reason: string): void {
    this.emitTransportSignal({
      type: 'transport:disconnected',
      roomId: this.roomId,
      fromPeerId: this.peerId,
      payload: {
        reason,
      },
    });
  }
}

export function createWebSocketTransportAdapter<TPresence extends PresenceData = PresenceData>(
  roomId: string,
  peerId: string,
  options: RoomOptions<TPresence>,
  createWebSocket?: WebSocketFactory,
): TransportAdapter {
  return new WebSocketTransportAdapter(roomId, peerId, options, createWebSocket);
}
