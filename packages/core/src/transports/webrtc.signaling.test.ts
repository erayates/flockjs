import { describe, expect, it, vi } from 'vitest';

import {
  WebRTCSignalingClient,
  type WebSocketFactory,
  type WebSocketLike,
} from './webrtc.signaling';

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
  public readonly sentPayloads: string[] = [];

  public readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

  public readyState = READY_STATE_CONNECTING;

  private readonly listeners = new Map<string, Set<Listener>>();

  public constructor(public readonly url: string) {}

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

  public send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  public close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = READY_STATE_CLOSED;
    this.emit('close', {
      reason,
    });
  }

  public emitOpen(): void {
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

  public emitClose(reason?: string): void {
    this.readyState = READY_STATE_CLOSED;
    this.emit('close', {
      reason,
    });
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

function parseLastPayload(socket: MockWebSocket): Record<string, unknown> {
  const payload = socket.sentPayloads.at(-1);
  if (!payload) {
    throw new Error('No payload was sent.');
  }

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

describe('WebRTCSignalingClient', () => {
  it('connects with relay auth token and de-duplicates concurrent connect', async () => {
    const onPeerJoined = vi.fn();
    const onPeerLeft = vi.fn();
    const onSignal = vi.fn();
    const onDisconnected = vi.fn();

    const sockets: MockWebSocket[] = [];
    const createWebSocket: WebSocketFactory = (url) => {
      const socket = new MockWebSocket(url);
      sockets.push(socket);
      return socket;
    };

    const client = new WebRTCSignalingClient({
      roomId: 'room-signaling',
      peerId: 'peer-a',
      relayUrl: 'ws://relay.local',
      relayAuth: async () => 'token-123',
      createWebSocket,
      onPeerJoined,
      onPeerLeft,
      onSignal,
      onDisconnected,
    });

    const connectPromiseA = client.connect();
    const connectPromiseB = client.connect();

    await waitFor(() => sockets.length === 1);
    const socket = sockets[0] as MockWebSocket;

    socket.emitOpen();
    expect(parseLastPayload(socket)).toMatchObject({
      type: 'join',
      roomId: 'room-signaling',
      peerId: 'peer-a',
      token: 'token-123',
    });

    socket.emitMessage(
      JSON.stringify({
        type: 'joined',
        roomId: 'room-signaling',
        peerId: 'peer-a',
        peers: ['peer-a', 'peer-b'],
      }),
    );

    await expect(connectPromiseA).resolves.toEqual(['peer-b']);
    await expect(connectPromiseB).resolves.toEqual(['peer-b']);

    await expect(client.connect()).resolves.toEqual([]);
    expect(onPeerJoined).not.toHaveBeenCalled();
    expect(onPeerLeft).not.toHaveBeenCalled();
    expect(onSignal).not.toHaveBeenCalled();
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('routes signaling events and websocket disconnect reasons', async () => {
    const onPeerJoined = vi.fn();
    const onPeerLeft = vi.fn();
    const onSignal = vi.fn();
    const onDisconnected = vi.fn();

    const sockets: MockWebSocket[] = [];
    const client = new WebRTCSignalingClient({
      roomId: 'room-events',
      peerId: 'peer-a',
      relayUrl: 'ws://relay.local',
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      onPeerJoined,
      onPeerLeft,
      onSignal,
      onDisconnected,
    });

    const connectPromise = client.connect();
    await waitFor(() => sockets.length === 1);

    const socket = sockets[0] as MockWebSocket;
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        type: 'joined',
        roomId: 'room-events',
        peerId: 'peer-a',
        peers: [],
      }),
    );

    await connectPromise;

    socket.emitMessage(
      JSON.stringify({
        type: 'peer-joined',
        roomId: 'room-events',
        peerId: 'peer-b',
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        type: 'peer-left',
        roomId: 'room-events',
        peerId: 'peer-b',
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        type: 'signal',
        roomId: 'room-events',
        fromPeerId: 'peer-b',
        toPeerId: 'peer-a',
        description: {
          type: 'offer',
          sdp: 'v=0',
        },
      }),
    );
    socket.emitMessage(
      JSON.stringify({
        type: 'error',
        code: 'FORBIDDEN',
        message: 'server-error',
      }),
    );
    socket.emitError();
    socket.emitClose('socket-closed');

    expect(onPeerJoined).toHaveBeenCalledWith('peer-b');
    expect(onPeerLeft).toHaveBeenCalledWith('peer-b');
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onDisconnected).toHaveBeenCalledWith('server-error');
    expect(onDisconnected).toHaveBeenCalledWith('Signaling socket error.');
    expect(onDisconnected).toHaveBeenCalledWith('socket-closed');
  });

  it('sends signal and leave payloads only when socket is connected/open', async () => {
    const sockets: MockWebSocket[] = [];
    const client = new WebRTCSignalingClient({
      roomId: 'room-send',
      peerId: 'peer-a',
      relayUrl: 'ws://relay.local',
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      onPeerJoined: vi.fn(),
      onPeerLeft: vi.fn(),
      onSignal: vi.fn(),
      onDisconnected: vi.fn(),
    });

    client.sendSignal({
      toPeerId: 'peer-b',
      description: {
        type: 'offer',
        sdp: 'before-connect',
      },
    });

    const connectPromise = client.connect();
    await waitFor(() => sockets.length === 1);

    const socket = sockets[0] as MockWebSocket;
    socket.emitOpen();
    socket.emitMessage(
      JSON.stringify({
        type: 'joined',
        roomId: 'room-send',
        peerId: 'peer-a',
        peers: [],
      }),
    );

    await connectPromise;

    client.sendSignal({
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:1',
      },
    });

    expect(parseLastPayload(socket)).toMatchObject({
      type: 'signal',
      roomId: 'room-send',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:1',
      },
    });

    socket.readyState = READY_STATE_CONNECTING;
    const sendCountBefore = socket.sentPayloads.length;
    client.sendSignal({
      toPeerId: 'peer-b',
      description: {
        type: 'offer',
        sdp: 'ignored-when-not-open',
      },
    });
    expect(socket.sentPayloads.length).toBe(sendCountBefore);

    socket.readyState = READY_STATE_OPEN;
    await client.disconnect();

    expect(parseLastPayload(socket)).toMatchObject({
      type: 'leave',
      roomId: 'room-send',
      peerId: 'peer-a',
    });
    expect(socket.closeCalls.at(-1)).toMatchObject({
      code: 1000,
      reason: 'disconnect',
    });

    await client.disconnect();
    expect(socket.closeCalls.length).toBe(1);
  });

  it('fails connection on timeout, socket error, or socket close during join', async () => {
    const createClient = (): {
      client: WebRTCSignalingClient;
      sockets: MockWebSocket[];
    } => {
      const sockets: MockWebSocket[] = [];
      const client = new WebRTCSignalingClient({
        roomId: 'room-failure',
        peerId: 'peer-a',
        relayUrl: 'ws://relay.local',
        joinTimeoutMs: 20,
        createWebSocket: (url) => {
          const socket = new MockWebSocket(url);
          sockets.push(socket);
          return socket;
        },
        onPeerJoined: vi.fn(),
        onPeerLeft: vi.fn(),
        onSignal: vi.fn(),
        onDisconnected: vi.fn(),
      });

      return {
        client,
        sockets,
      };
    };

    {
      const { client, sockets } = createClient();
      const promise = client.connect();
      await waitFor(() => sockets.length === 1);
      sockets[0]?.emitOpen();
      await expect(promise).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        recoverable: false,
        cause: {
          source: 'webrtc-signaling',
          kind: 'join-timeout',
        },
      });
    }

    {
      const { client, sockets } = createClient();
      const promise = client.connect();
      await waitFor(() => sockets.length === 1);
      sockets[0]?.emitError();
      await expect(promise).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
        cause: {
          source: 'webrtc-signaling',
          kind: 'socket-error',
        },
      });
    }

    {
      const { client, sockets } = createClient();
      const promise = client.connect();
      await waitFor(() => sockets.length === 1);
      sockets[0]?.emitClose('join-close');
      await expect(promise).rejects.toMatchObject({
        message: 'join-close',
        cause: {
          source: 'webrtc-signaling',
          kind: 'socket-closed-during-join',
        },
      });
    }
  });

  it('ignores malformed join-phase messages and rejects when server sends an error', async () => {
    const sockets: MockWebSocket[] = [];
    const client = new WebRTCSignalingClient({
      roomId: 'room-join-error',
      peerId: 'peer-a',
      relayUrl: 'ws://relay.local',
      createWebSocket: (url) => {
        const socket = new MockWebSocket(url);
        sockets.push(socket);
        return socket;
      },
      onPeerJoined: vi.fn(),
      onPeerLeft: vi.fn(),
      onSignal: vi.fn(),
      onDisconnected: vi.fn(),
    });

    const connectPromise = client.connect();
    await waitFor(() => sockets.length === 1);

    const socket = sockets[0] as MockWebSocket;
    socket.emitOpen();
    socket.emitMessage('not-json');
    socket.emitMessage(
      JSON.stringify({
        type: 'error',
        code: 'FORBIDDEN',
        message: 'join-denied',
      }),
    );

    await expect(connectPromise).rejects.toMatchObject({
      message: 'join-denied',
      code: 'NETWORK_ERROR',
      cause: {
        source: 'webrtc-signaling',
        kind: 'server-rejected',
        serverCode: 'FORBIDDEN',
      },
    });
  });

  it('classifies missing runtime WebSocket as signaling unavailable', () => {
    const originalWebSocket = globalThis.WebSocket;

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    try {
      try {
        return new WebRTCSignalingClient({
          roomId: 'room-no-websocket',
          peerId: 'peer-a',
          relayUrl: 'ws://relay.local',
          onPeerJoined: vi.fn(),
          onPeerLeft: vi.fn(),
          onSignal: vi.fn(),
          onDisconnected: vi.fn(),
        });
      } catch (error) {
        expect(error).toMatchObject({
          cause: {
            source: 'webrtc-signaling',
            kind: 'socket-unavailable',
          },
        });
        return;
      }

      throw new Error('Expected constructor to throw when WebSocket is unavailable.');
    } finally {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        writable: true,
        value: originalWebSocket,
      });
    }
  });
});
