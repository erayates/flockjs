import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getBootstrapProtocolSession,
  getTransportProtocolCapabilities,
} from './transport.protocol';
import { createWebSocketTransportAdapter, type WebSocketLike } from './websocket';
import {
  parseWebSocketRelayClientMessage,
  serializeWebSocketRelayMessage,
  type WebSocketRelayClientMessage,
} from './websocket.protocol';

interface MessageEventLike {
  data: unknown;
}

interface CloseEventLike {
  reason?: string;
}

type OpenListener = () => void;
type MessageListener = (event: MessageEventLike) => void;
type ErrorListener = () => void;
type CloseListener = (event: CloseEventLike) => void;
type Listener = OpenListener | MessageListener | ErrorListener | CloseListener;

const READY_STATE_CONNECTING = 0;
const READY_STATE_OPEN = 1;
const READY_STATE_CLOSED = 3;

class MockWebSocket implements WebSocketLike {
  public readonly sentPayloads: Array<string | Uint8Array> = [];

  public readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  public readyState = READY_STATE_CONNECTING;

  private readonly listeners = new Map<string, Set<Listener>>();

  public constructor(
    public readonly url: string,
    private readonly relay: MockRelay,
  ) {}

  public addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: Listener): void {
    const listenersForType = this.listeners.get(type) ?? new Set<Listener>();
    listenersForType.add(listener);
    this.listeners.set(type, listenersForType);
  }

  public removeEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: Listener,
  ): void {
    const listenersForType = this.listeners.get(type);
    if (!listenersForType) {
      return;
    }

    listenersForType.delete(listener);
    if (listenersForType.size === 0) {
      this.listeners.delete(type);
    }
  }

  public send(payload: string | Uint8Array): void {
    this.sentPayloads.push(payload);
    this.relay.handleClientPayload(this, payload);
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === READY_STATE_CLOSED) {
      return;
    }

    this.closeCalls.push({ code, reason });
    this.readyState = READY_STATE_CLOSED;
    this.emit('close', {
      reason,
    });
    this.relay.handleSocketClosed(this);
  }

  public open(): void {
    this.readyState = READY_STATE_OPEN;
    this.emit('open');
  }

  public emitMessage(payload: unknown): void {
    this.emit('message', {
      data: payload,
    });
  }

  public emitError(): void {
    this.emit('error');
  }

  private emit(type: 'open'): void;
  private emit(type: 'message', event: MessageEventLike): void;
  private emit(type: 'error'): void;
  private emit(type: 'close', event: CloseEventLike): void;
  private emit(
    type: 'open' | 'message' | 'error' | 'close',
    event?: MessageEventLike | CloseEventLike,
  ): void {
    const listenersForType = this.listeners.get(type);
    if (!listenersForType) {
      return;
    }

    for (const listener of listenersForType) {
      if (type === 'open' || type === 'error') {
        (listener as OpenListener | ErrorListener)();
      } else {
        (listener as MessageListener | CloseListener)(
          (event ?? ({} as MessageEventLike | CloseEventLike)) as MessageEventLike & CloseEventLike,
        );
      }
    }
  }
}

class MockRelay {
  private readonly sockets = new Set<MockWebSocket>();

  private readonly contexts = new Map<
    MockWebSocket,
    {
      roomId: string;
      peerId: string;
      protocol?: ReturnType<typeof getTransportProtocolCapabilities>;
    }
  >();

  private readonly rooms = new Map<string, Map<string, MockWebSocket>>();

  public constructor(
    private readonly options: {
      rejectJoinCode?: string;
      rejectJoinMessage?: string;
      suppressJoinAck?: boolean;
    } = {},
  ) {}

  public connect = (url: string): WebSocketLike => {
    const socket = new MockWebSocket(url, this);
    this.sockets.add(socket);
    queueMicrotask(() => {
      socket.open();
    });
    return socket;
  };

  public getSocket(peerId: string): MockWebSocket | null {
    for (const [socket, context] of this.contexts.entries()) {
      if (context.peerId === peerId) {
        return socket;
      }
    }

    return null;
  }

  public handleClientPayload(socket: MockWebSocket, payload: string | Uint8Array): void {
    const message = parseWebSocketRelayClientMessage(payload);
    if (!message) {
      socket.emitMessage(
        JSON.stringify({
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'Invalid relay message.',
        }),
      );
      return;
    }

    if (message.type === 'join') {
      this.handleJoin(socket, message);
      return;
    }

    if (message.type === 'leave') {
      this.removeSocket(socket);
      return;
    }

    this.handleTransport(socket, message);
  }

  public handleSocketClosed(socket: MockWebSocket): void {
    this.removeSocket(socket);
    this.sockets.delete(socket);
  }

  private handleJoin(
    socket: MockWebSocket,
    message: Extract<WebSocketRelayClientMessage, { type: 'join' }>,
  ): void {
    if (this.options.rejectJoinCode) {
      socket.emitMessage(
        JSON.stringify({
          type: 'error',
          code: this.options.rejectJoinCode,
          message: this.options.rejectJoinMessage ?? 'Rejected.',
        }),
      );
      return;
    }

    const roomPeers = this.rooms.get(message.roomId) ?? new Map<string, MockWebSocket>();
    const peers = Array.from(roomPeers.entries()).map(([peerId, peerSocket]) => {
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

    if (!this.options.suppressJoinAck) {
      socket.emitMessage(
        JSON.stringify({
          type: 'joined',
          roomId: message.roomId,
          peerId: message.peerId,
          peers,
        }),
      );
    }

    const peerJoinedPayload = JSON.stringify({
      type: 'peer-joined',
      roomId: message.roomId,
      peerId: message.peerId,
      ...(message.protocol ? { protocol: message.protocol } : {}),
    });
    for (const [peerId, peerSocket] of roomPeers.entries()) {
      if (peerId === message.peerId) {
        continue;
      }

      peerSocket.emitMessage(peerJoinedPayload);
    }
  }

  private handleTransport(
    socket: MockWebSocket,
    message: Extract<WebSocketRelayClientMessage, { type: 'transport' }>,
  ): void {
    const context = this.contexts.get(socket);
    if (!context) {
      return;
    }

    const roomPeers = this.rooms.get(context.roomId);
    if (!roomPeers) {
      return;
    }

    if (message.signal.toPeerId) {
      const target = roomPeers.get(message.signal.toPeerId);
      if (!target) {
        return;
      }

      const targetContext = this.contexts.get(target);
      target.emitMessage(
        serializeWebSocketRelayMessage({
          type: 'transport',
          signal: message.signal,
          session: targetContext?.protocol?.codecs.includes('msgpack')
            ? {
                version: 2,
                codec: 'msgpack',
                legacy: false,
              }
            : getBootstrapProtocolSession(),
        }),
      );
      return;
    }

    for (const [peerId, peerSocket] of roomPeers.entries()) {
      if (peerId === context.peerId) {
        continue;
      }

      const peerContext = this.contexts.get(peerSocket);
      peerSocket.emitMessage(
        serializeWebSocketRelayMessage({
          type: 'transport',
          signal: message.signal,
          session: peerContext?.protocol?.codecs.includes('msgpack')
            ? {
                version: 2,
                codec: 'msgpack',
                legacy: false,
              }
            : getBootstrapProtocolSession(),
        }),
      );
    }
  }

  private removeSocket(socket: MockWebSocket): void {
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
      return;
    }

    const payload = JSON.stringify({
      type: 'peer-left',
      roomId: context.roomId,
      peerId: context.peerId,
    });
    for (const peerSocket of roomPeers.values()) {
      peerSocket.emitMessage(payload);
    }
  }
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

describe('WebSocketTransportAdapter', () => {
  const protocol = getTransportProtocolCapabilities('websocket');

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects successfully and handles rooms with existing peers', async () => {
    const relay = new MockRelay();
    const adapterA = createWebSocketTransportAdapter(
      'room-websocket',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );
    const adapterB = createWebSocketTransportAdapter(
      'room-websocket',
      'peer-b',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );

    const receivedByA: string[] = [];
    adapterA.onMessage((signal) => {
      receivedByA.push(`${signal.type}:${signal.fromPeerId}`);
    });

    await adapterA.connect();
    await adapterB.connect();

    adapterB.broadcast({
      type: 'hello',
      roomId: 'room-websocket',
      fromPeerId: 'peer-b',
      timestamp: 1,
      payload: {
        peer: {
          id: 'peer-b',
          joinedAt: 1,
          lastSeen: 1,
        },
        protocol,
      },
    });

    await waitFor(() => receivedByA.includes('hello:peer-b'));

    await adapterA.disconnect();
    await adapterB.disconnect();
  });

  it('delivers broadcast messages to room peers', async () => {
    const relay = new MockRelay();
    const adapterA = createWebSocketTransportAdapter(
      'room-broadcast',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );
    const adapterB = createWebSocketTransportAdapter(
      'room-broadcast',
      'peer-b',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );

    const onMessage = vi.fn();
    adapterB.onMessage(onMessage);

    await adapterA.connect();
    await adapterB.connect();

    adapterA.broadcast({
      type: 'event',
      roomId: 'room-broadcast',
      fromPeerId: 'peer-a',
      timestamp: 1,
      payload: {
        name: 'broadcast',
        payload: {
          scope: 'all',
        },
      },
    });

    await waitFor(() => onMessage.mock.calls.length === 1);
    expect(onMessage).toHaveBeenCalledWith({
      type: 'event',
      roomId: 'room-broadcast',
      fromPeerId: 'peer-a',
      timestamp: expect.any(Number),
      payload: {
        name: 'broadcast',
        payload: {
          scope: 'all',
        },
      },
    });

    await adapterA.disconnect();
    await adapterB.disconnect();
  });

  it('delivers targeted send messages to the intended peer only', async () => {
    const relay = new MockRelay();
    const adapterA = createWebSocketTransportAdapter(
      'room-targeted',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );
    const adapterB = createWebSocketTransportAdapter(
      'room-targeted',
      'peer-b',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );
    const adapterC = createWebSocketTransportAdapter(
      'room-targeted',
      'peer-c',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );

    const onMessageB = vi.fn();
    const onMessageC = vi.fn();
    adapterB.onMessage(onMessageB);
    adapterC.onMessage(onMessageC);

    await Promise.all([adapterA.connect(), adapterB.connect(), adapterC.connect()]);

    adapterA.send({
      type: 'event',
      roomId: 'room-targeted',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: 1,
      payload: {
        name: 'targeted',
        payload: {
          scope: 'one',
        },
      },
    });

    await waitFor(() => onMessageB.mock.calls.length === 1);
    expect(onMessageB).toHaveBeenCalledWith({
      type: 'event',
      roomId: 'room-targeted',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: expect.any(Number),
      payload: {
        name: 'targeted',
        payload: {
          scope: 'one',
        },
      },
    });
    expect(onMessageC).not.toHaveBeenCalled();

    await adapterA.disconnect();
    await adapterB.disconnect();
    await adapterC.disconnect();
  });

  it('translates relay peer-left notifications into internal leave signals', async () => {
    const relay = new MockRelay();
    const adapterA = createWebSocketTransportAdapter(
      'room-leave',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );
    const adapterB = createWebSocketTransportAdapter(
      'room-leave',
      'peer-b',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );

    const onMessage = vi.fn();
    adapterA.onMessage(onMessage);

    await adapterA.connect();
    await adapterB.connect();
    await adapterB.disconnect();

    await waitFor(() => onMessage.mock.calls.some(([signal]) => signal.type === 'leave'));
    expect(onMessage).toHaveBeenCalledWith({
      type: 'leave',
      roomId: 'room-leave',
      fromPeerId: 'peer-b',
      timestamp: expect.any(Number),
      payload: {},
    });

    await adapterA.disconnect();
  });

  it('rejects auth failures and surfaces relay error frames after connect', async () => {
    const rejectingRelay = new MockRelay({
      rejectJoinCode: 'AUTH_FAILED',
      rejectJoinMessage: 'Authorization failed.',
    });
    const failingAdapter = createWebSocketTransportAdapter(
      'room-auth',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      rejectingRelay.connect,
    );

    await expect(failingAdapter.connect()).rejects.toMatchObject({
      code: 'AUTH_FAILED',
      message: 'Authorization failed.',
    });

    const relay = new MockRelay();
    const adapter = createWebSocketTransportAdapter(
      'room-error',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );
    const onMessage = vi.fn();
    adapter.onMessage(onMessage);

    await adapter.connect();
    relay.getSocket('peer-a')?.emitMessage(
      JSON.stringify({
        type: 'error',
        code: 'ROOM_MISMATCH',
        message: 'Mismatch.',
      }),
    );

    await waitFor(() => onMessage.mock.calls.some(([signal]) => signal.type === 'transport:error'));
    expect(onMessage).toHaveBeenCalledWith({
      type: 'transport:error',
      roomId: 'room-error',
      fromPeerId: 'peer-a',
      payload: {
        error: expect.objectContaining({
          code: 'NETWORK_ERROR',
          message: 'Mismatch.',
        }),
      },
    });

    await adapter.disconnect();
  });

  it('times out when the relay never acknowledges the join', async () => {
    vi.useFakeTimers();

    const relay = new MockRelay({
      suppressJoinAck: true,
    });
    const adapter = createWebSocketTransportAdapter(
      'room-timeout',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );

    const connectPromise = adapter.connect();
    const expectedRejection = expect(connectPromise).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Timed out waiting for relay join acknowledgement (5000ms).',
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);

    await expectedRejection;
  });

  it('sends leave and closes the socket during disconnect cleanup', async () => {
    const relay = new MockRelay();
    const adapter = createWebSocketTransportAdapter(
      'room-disconnect',
      'peer-a',
      {
        transport: 'websocket',
        relayUrl: 'ws://relay.local',
      },
      relay.connect,
    );

    await adapter.connect();
    const socket = relay.getSocket('peer-a');
    if (!socket) {
      throw new Error('Expected connected socket.');
    }

    await adapter.disconnect();

    expect(socket.sentPayloads.some((payload) => JSON.parse(payload).type === 'leave')).toBe(true);
    expect(socket.closeCalls).toEqual([
      {
        code: 1000,
        reason: 'disconnect',
      },
    ]);
  });
});
