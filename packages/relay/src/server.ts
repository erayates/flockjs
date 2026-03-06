import type { IncomingMessage } from 'node:http';

import { type RawData, type WebSocket, WebSocketServer } from 'ws';

import {
  parseRelayClientMessage,
  type RelayClientMessage,
  type RelayPeerJoinedMessage,
  type RelayPeerLeftMessage,
  resolveRelayTransportSession,
  serializeRelayServerMessage,
} from './protocol';

interface RelayPeerContext {
  roomId: string;
  peerId: string;
  protocol?: Extract<RelayClientMessage, { type: 'join' }>['protocol'];
}

export interface RelayServer {
  readonly port: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  getAddress(): string;
}

export interface RelayAuthorizeContext {
  roomId: string;
  peerId: string;
  token?: string;
  request: IncomingMessage;
}

export interface RelayServerOptions {
  port: number;
  host?: string;
  authorize?: (context: RelayAuthorizeContext) => boolean | Promise<boolean>;
}

function normalizeRawData(data: RawData, isBinary: boolean): string | Uint8Array {
  if (typeof data === 'string') {
    return data;
  }

  if (!isBinary) {
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    }

    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8');
    }

    return data.toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }

  return new Uint8Array(data);
}

export class RelayServerImpl implements RelayServer {
  private server: WebSocketServer | null = null;

  private readonly contexts = new WeakMap<WebSocket, RelayPeerContext>();

  private readonly rooms = new Map<string, Map<string, WebSocket>>();

  private currentPort: number;

  private readonly host: string;

  public constructor(private readonly options: RelayServerOptions) {
    this.currentPort = options.port;
    this.host = options.host ?? '127.0.0.1';
  }

  public get port(): number {
    return this.currentPort;
  }

  public getAddress(): string {
    return `ws://${this.host}:${this.currentPort}`;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = new WebSocketServer({
      host: this.host,
      port: this.options.port,
    });

    server.on('connection', (socket, request) => {
      this.handleConnection(socket, request);
    });

    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        server.off('error', onError);
        const address = server.address();
        if (address && typeof address !== 'string') {
          this.currentPort = address.port;
        }
        resolve();
      };

      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };

      server.once('listening', onListening);
      server.once('error', onError);
    });

    this.server = server;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    this.server = null;

    for (const client of server.clients) {
      client.close(1000, 'server-stop');
    }

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    this.rooms.clear();
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    socket.on('message', (rawData, isBinary) => {
      const payload = normalizeRawData(rawData, isBinary);
      const message = parseRelayClientMessage(payload);
      if (!message) {
        this.sendError(socket, 'INVALID_MESSAGE', 'Invalid signaling message.');
        return;
      }

      void this.handleClientMessage(socket, request, message);
    });

    socket.on('close', () => {
      this.removePeerFromRoom(socket);
    });

    socket.on('error', () => {
      this.removePeerFromRoom(socket);
    });
  }

  private async handleClientMessage(
    socket: WebSocket,
    request: IncomingMessage,
    message: RelayClientMessage,
  ): Promise<void> {
    if (message.type === 'join') {
      await this.handleJoinMessage(socket, request, message);
      return;
    }

    const context = this.contexts.get(socket);
    if (!context) {
      this.sendError(socket, 'NOT_JOINED', 'Peer must join a room before signaling.');
      return;
    }

    if (message.type === 'leave') {
      if (message.roomId !== context.roomId) {
        this.sendError(socket, 'ROOM_MISMATCH', 'Leave roomId does not match joined room.');
        return;
      }

      if (message.peerId !== context.peerId) {
        this.sendError(socket, 'PEER_MISMATCH', 'PeerId mismatch for leave request.');
        return;
      }

      this.removePeerFromRoom(socket);
      return;
    }

    if (message.type === 'signal') {
      if (message.roomId !== context.roomId) {
        this.sendError(socket, 'ROOM_MISMATCH', 'Signal roomId does not match joined room.');
        return;
      }

      if (message.fromPeerId !== context.peerId) {
        this.sendError(socket, 'PEER_MISMATCH', 'Signal sender peerId mismatch.');
        return;
      }

      this.forwardSignal(context.roomId, message);
      return;
    }

    if (message.signal.roomId !== context.roomId) {
      this.sendError(socket, 'ROOM_MISMATCH', 'Transport roomId does not match joined room.');
      return;
    }

    if (message.signal.fromPeerId !== context.peerId) {
      this.sendError(socket, 'PEER_MISMATCH', 'Transport sender peerId mismatch.');
      return;
    }

    this.forwardTransport(context.roomId, context.peerId, message);
  }

  private async handleJoinMessage(
    socket: WebSocket,
    request: IncomingMessage,
    message: Extract<RelayClientMessage, { type: 'join' }>,
  ): Promise<void> {
    const existingContext = this.contexts.get(socket);
    if (existingContext) {
      this.sendError(socket, 'ALREADY_JOINED', 'Socket already joined a room.');
      return;
    }

    if (this.options.authorize) {
      const authorizeContext: RelayAuthorizeContext = {
        roomId: message.roomId,
        peerId: message.peerId,
        request,
        ...(message.token !== undefined ? { token: message.token } : {}),
      };

      const allowed = await this.options.authorize(authorizeContext);

      if (!allowed) {
        this.sendError(socket, 'AUTH_FAILED', 'Authorization failed.');
        return;
      }
    }

    const roomPeers = this.rooms.get(message.roomId) ?? new Map<string, WebSocket>();
    if (roomPeers.has(message.peerId)) {
      this.sendError(socket, 'PEER_EXISTS', 'PeerId already exists in this room.');
      return;
    }

    const existingPeers = Array.from(roomPeers.entries()).map(([peerId, peerSocket]) => {
      const peerContext = this.contexts.get(peerSocket);
      return {
        peerId,
        ...(peerContext?.protocol ? { protocol: peerContext.protocol } : {}),
      };
    });
    roomPeers.set(message.peerId, socket);
    this.rooms.set(message.roomId, roomPeers);
    this.contexts.set(socket, {
      roomId: message.roomId,
      peerId: message.peerId,
      ...(message.protocol ? { protocol: message.protocol } : {}),
    });

    socket.send(
      serializeRelayServerMessage({
        type: 'joined',
        roomId: message.roomId,
        peerId: message.peerId,
        peers: existingPeers,
      }),
    );

    this.broadcastToRoom(message.roomId, message.peerId, {
      type: 'peer-joined',
      roomId: message.roomId,
      peerId: message.peerId,
      ...(message.protocol ? { protocol: message.protocol } : {}),
    });
  }

  private forwardSignal(
    roomId: string,
    message: Extract<RelayClientMessage, { type: 'signal' }>,
  ): void {
    const roomPeers = this.rooms.get(roomId);
    if (!roomPeers) {
      return;
    }

    const target = roomPeers.get(message.toPeerId);
    if (!target) {
      return;
    }

    const outboundSignal = {
      type: 'signal',
      roomId,
      fromPeerId: message.fromPeerId,
      toPeerId: message.toPeerId,
    } as const;

    const signalMessage =
      message.description || message.candidate
        ? {
            ...outboundSignal,
            ...(message.description ? { description: message.description } : {}),
            ...(message.candidate ? { candidate: message.candidate } : {}),
          }
        : outboundSignal;

    target.send(serializeRelayServerMessage(signalMessage));
  }

  private forwardTransport(
    roomId: string,
    senderPeerId: string,
    message: Extract<RelayClientMessage, { type: 'transport' }>,
  ): void {
    const roomPeers = this.rooms.get(roomId);
    if (!roomPeers) {
      return;
    }

    if (message.signal.toPeerId) {
      const target = roomPeers.get(message.signal.toPeerId);
      if (!target) {
        return;
      }

      const targetContext = this.contexts.get(target);
      target.send(
        serializeRelayServerMessage(
          {
            type: 'transport',
            signal: message.signal,
            encoding: message.encoding,
          },
          {
            transportSession: resolveRelayTransportSession(targetContext?.protocol),
          },
        ),
      );
      return;
    }

    for (const [peerId, socket] of roomPeers.entries()) {
      if (peerId === senderPeerId) {
        continue;
      }

      const targetContext = this.contexts.get(socket);
      socket.send(
        serializeRelayServerMessage(
          {
            type: 'transport',
            signal: message.signal,
            encoding: message.encoding,
          },
          {
            transportSession: resolveRelayTransportSession(targetContext?.protocol),
          },
        ),
      );
    }
  }

  private removePeerFromRoom(socket: WebSocket): void {
    const context = this.contexts.get(socket);
    if (!context) {
      return;
    }

    this.contexts.delete(socket);

    const roomPeers = this.rooms.get(context.roomId);
    if (!roomPeers) {
      return;
    }

    roomPeers.delete(context.peerId);
    if (roomPeers.size === 0) {
      this.rooms.delete(context.roomId);
    }

    this.broadcastToRoom(context.roomId, context.peerId, {
      type: 'peer-left',
      roomId: context.roomId,
      peerId: context.peerId,
    });
  }

  private broadcastToRoom(
    roomId: string,
    excludePeerId: string,
    message: RelayPeerJoinedMessage | RelayPeerLeftMessage,
  ): void {
    const roomPeers = this.rooms.get(roomId);
    if (!roomPeers) {
      return;
    }

    const payload = serializeRelayServerMessage(message);
    for (const [peerId, socket] of roomPeers.entries()) {
      if (peerId === excludePeerId) {
        continue;
      }

      socket.send(payload);
    }
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    socket.send(
      serializeRelayServerMessage({
        type: 'error',
        code,
        message,
      }),
    );
  }
}

export function createRelayServer(options: RelayServerOptions): RelayServer {
  return new RelayServerImpl(options);
}
