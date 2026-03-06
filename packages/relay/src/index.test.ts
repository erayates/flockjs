import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createRelayServer, type RelayServer } from './index';

interface JsonMessage {
  type: string;
  [key: string]: unknown;
}

const SOCKET_CLOSE_TIMEOUT_MS = 1_000;

function toUtf8(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }

  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = (): void => {
      socket.off('error', onError);
      resolve();
    };

    const onError = (error: Error): void => {
      socket.off('open', onOpen);
      reject(error);
    };

    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: JsonMessage) => boolean,
  timeoutMs = 2_000,
): Promise<JsonMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for message after ${timeoutMs}ms.`));
    }, timeoutMs);

    const onMessage = (data: unknown): void => {
      const parsed = JSON.parse(toUtf8(data)) as JsonMessage;
      if (!predicate(parsed)) {
        return;
      }

      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(parsed);
    };

    socket.on('message', onMessage);
  });
}

function send(socket: WebSocket, payload: JsonMessage): void {
  socket.send(JSON.stringify(payload));
}

function createTransportFrame(message: {
  type: string;
  roomId: string;
  fromPeerId: string;
  toPeerId?: string;
  timestamp?: number;
  payload: Record<string, unknown>;
}): JsonMessage {
  return {
    type: 'transport',
    message: {
      source: 'flockjs',
      protocolVersion: 2,
      codec: 'json',
      roomId: message.roomId,
      fromPeerId: message.fromPeerId,
      ...(message.toPeerId ? { toPeerId: message.toPeerId } : {}),
      timestamp: message.timestamp ?? 1,
      type: message.type,
      payload: message.payload,
    },
  };
}

function sendAndWaitForMessage(
  socket: WebSocket,
  payload: JsonMessage,
  predicate: (message: JsonMessage) => boolean,
  timeoutMs?: number,
): Promise<JsonMessage> {
  const pendingMessage = waitForMessage(socket, predicate, timeoutMs);
  send(socket, payload);
  return pendingMessage;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      socket.off('close', onClose);
      socket.terminate();
      resolve();
    }, SOCKET_CLOSE_TIMEOUT_MS);

    const onClose = (): void => {
      clearTimeout(timer);
      resolve();
    };

    socket.once('close', onClose);
    socket.close();
  });
}

describe(
  'relay signaling server',
  {
    timeout: 30_000,
  },
  () => {
    let relayServer: RelayServer | null = null;
    const sockets: WebSocket[] = [];

    afterEach(async () => {
      await Promise.all(
        sockets.map((socket) => {
          return closeSocket(socket);
        }),
      );

      sockets.length = 0;

      await relayServer?.stop();
      relayServer = null;
    });

    it('joins peers into rooms and emits peer-joined', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const clientA = new WebSocket(relayServer.getAddress());
      const clientB = new WebSocket(relayServer.getAddress());
      sockets.push(clientA, clientB);

      await waitForOpen(clientA);
      await waitForOpen(clientB);

      const joinedA = await sendAndWaitForMessage(
        clientA,
        {
          type: 'join',
          roomId: 'room-join',
          peerId: 'a',
        },
        (message) => message.type === 'joined',
      );
      expect(joinedA).toMatchObject({
        type: 'joined',
        roomId: 'room-join',
        peerId: 'a',
        peers: [],
      });

      const peerJoinedPromise = waitForMessage(
        clientA,
        (message) => message.type === 'peer-joined' && message.peerId === 'b',
      );
      const joinedB = await sendAndWaitForMessage(
        clientB,
        {
          type: 'join',
          roomId: 'room-join',
          peerId: 'b',
        },
        (message) => message.type === 'joined',
      );
      expect(joinedB).toMatchObject({
        type: 'joined',
        roomId: 'room-join',
        peerId: 'b',
        peers: [{ peerId: 'a' }],
      });

      const peerJoinedA = await peerJoinedPromise;
      expect(peerJoinedA).toMatchObject({
        type: 'peer-joined',
        roomId: 'room-join',
        peerId: 'b',
      });
    });

    it('routes signal messages to target peer only', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const clientA = new WebSocket(relayServer.getAddress());
      const clientB = new WebSocket(relayServer.getAddress());
      const clientC = new WebSocket(relayServer.getAddress());
      sockets.push(clientA, clientB, clientC);

      await Promise.all([waitForOpen(clientA), waitForOpen(clientB), waitForOpen(clientC)]);

      for (const peerId of ['a', 'b', 'c']) {
        const client = peerId === 'a' ? clientA : peerId === 'b' ? clientB : clientC;
        send(client, {
          type: 'join',
          roomId: 'room-signal',
          peerId,
        });
        await waitForMessage(client, (message) => message.type === 'joined');
      }

      send(clientA, {
        type: 'signal',
        roomId: 'room-signal',
        fromPeerId: 'a',
        toPeerId: 'b',
        description: {
          type: 'offer',
          sdp: 'fake-sdp',
        },
      });

      const signalB = await waitForMessage(
        clientB,
        (message) => message.type === 'signal' && message.fromPeerId === 'a',
      );
      expect(signalB).toMatchObject({
        type: 'signal',
        roomId: 'room-signal',
        fromPeerId: 'a',
        toPeerId: 'b',
      });

      const noSignalForC = await waitForMessage(
        clientC,
        (message) => message.type === 'signal',
        150,
      )
        .then(() => true)
        .catch(() => false);
      expect(noSignalForC).toBe(false);
    });

    it('routes websocket transport messages for both targeted and broadcast delivery', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const clientA = new WebSocket(relayServer.getAddress());
      const clientB = new WebSocket(relayServer.getAddress());
      const clientC = new WebSocket(relayServer.getAddress());
      sockets.push(clientA, clientB, clientC);

      await Promise.all([waitForOpen(clientA), waitForOpen(clientB), waitForOpen(clientC)]);

      for (const peerId of ['a', 'b', 'c']) {
        const client = peerId === 'a' ? clientA : peerId === 'b' ? clientB : clientC;
        send(client, {
          type: 'join',
          roomId: 'room-transport',
          peerId,
        });
        await waitForMessage(client, (message) => message.type === 'joined');
      }

      send(
        clientA,
        createTransportFrame({
          type: 'event',
          roomId: 'room-transport',
          fromPeerId: 'a',
          toPeerId: 'b',
          payload: {
            name: 'targeted',
            payload: {
              scope: 'one',
            },
          },
        }),
      );

      const targetedAtB = await waitForMessage(
        clientB,
        (message) =>
          message.type === 'transport' &&
          (message.message as { signal?: { fromPeerId?: string } } | undefined)?.signal
            ?.fromPeerId === 'a',
      );
      expect(targetedAtB).toMatchObject({
        type: 'transport',
        message: {
          source: 'flockjs',
          version: 1,
          signal: {
            type: 'event',
            roomId: 'room-transport',
            fromPeerId: 'a',
            toPeerId: 'b',
            payload: {
              event: {
                name: 'targeted',
                payload: {
                  scope: 'one',
                },
              },
            },
          },
        },
      });

      const noTargetedAtC = await waitForMessage(
        clientC,
        (message) => message.type === 'transport',
        150,
      )
        .then(() => true)
        .catch(() => false);
      expect(noTargetedAtC).toBe(false);

      send(
        clientA,
        createTransportFrame({
          type: 'hello',
          roomId: 'room-transport',
          fromPeerId: 'a',
          payload: {
            peer: {
              id: 'a',
              joinedAt: 1,
              lastSeen: 1,
            },
          },
        }),
      );

      const broadcastAtB = await waitForMessage(
        clientB,
        (message) =>
          message.type === 'transport' &&
          (message.message as { signal?: { type?: string } } | undefined)?.signal?.type === 'hello',
      );
      const broadcastAtC = await waitForMessage(
        clientC,
        (message) =>
          message.type === 'transport' &&
          (message.message as { signal?: { type?: string } } | undefined)?.signal?.type === 'hello',
      );

      expect(broadcastAtB).toMatchObject({
        type: 'transport',
        message: {
          source: 'flockjs',
          version: 1,
          signal: {
            type: 'hello',
            roomId: 'room-transport',
            fromPeerId: 'a',
          },
        },
      });
      expect(broadcastAtC).toMatchObject({
        type: 'transport',
        message: {
          source: 'flockjs',
          version: 1,
          signal: {
            type: 'hello',
            roomId: 'room-transport',
            fromPeerId: 'a',
          },
        },
      });
    });

    it('routes offer, answer, and candidate payloads for WebRTC signaling', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const clientA = new WebSocket(relayServer.getAddress());
      const clientB = new WebSocket(relayServer.getAddress());
      const clientC = new WebSocket(relayServer.getAddress());
      sockets.push(clientA, clientB, clientC);

      await Promise.all([waitForOpen(clientA), waitForOpen(clientB), waitForOpen(clientC)]);

      for (const peerId of ['a', 'b', 'c']) {
        const client = peerId === 'a' ? clientA : peerId === 'b' ? clientB : clientC;
        send(client, {
          type: 'join',
          roomId: 'room-webrtc-signal',
          peerId,
        });
        await waitForMessage(client, (message) => message.type === 'joined');
      }

      send(clientA, {
        type: 'signal',
        roomId: 'room-webrtc-signal',
        fromPeerId: 'a',
        toPeerId: 'b',
        description: {
          type: 'offer',
          sdp: 'offer-sdp',
        },
      });

      const offerAtB = await waitForMessage(
        clientB,
        (message) =>
          message.type === 'signal' &&
          message.fromPeerId === 'a' &&
          (message.description as { type?: string } | undefined)?.type === 'offer',
      );
      expect(offerAtB).toMatchObject({
        type: 'signal',
        roomId: 'room-webrtc-signal',
        fromPeerId: 'a',
        toPeerId: 'b',
        description: {
          type: 'offer',
          sdp: 'offer-sdp',
        },
      });

      send(clientB, {
        type: 'signal',
        roomId: 'room-webrtc-signal',
        fromPeerId: 'b',
        toPeerId: 'a',
        description: {
          type: 'answer',
          sdp: 'answer-sdp',
        },
      });

      const answerAtA = await waitForMessage(
        clientA,
        (message) =>
          message.type === 'signal' &&
          message.fromPeerId === 'b' &&
          (message.description as { type?: string } | undefined)?.type === 'answer',
      );
      expect(answerAtA).toMatchObject({
        type: 'signal',
        roomId: 'room-webrtc-signal',
        fromPeerId: 'b',
        toPeerId: 'a',
        description: {
          type: 'answer',
          sdp: 'answer-sdp',
        },
      });

      send(clientA, {
        type: 'signal',
        roomId: 'room-webrtc-signal',
        fromPeerId: 'a',
        toPeerId: 'b',
        candidate: {
          candidate: 'candidate:1',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      });

      const candidateAtB = await waitForMessage(
        clientB,
        (message) => message.type === 'signal' && message.fromPeerId === 'a' && !!message.candidate,
      );
      expect(candidateAtB).toMatchObject({
        type: 'signal',
        roomId: 'room-webrtc-signal',
        fromPeerId: 'a',
        toPeerId: 'b',
        candidate: {
          candidate: 'candidate:1',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      });

      const noSignalForC = await waitForMessage(
        clientC,
        (message) => message.type === 'signal',
        150,
      )
        .then(() => true)
        .catch(() => false);
      expect(noSignalForC).toBe(false);
    });

    it('emits peer-left when a peer leaves', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const clientA = new WebSocket(relayServer.getAddress());
      const clientB = new WebSocket(relayServer.getAddress());
      sockets.push(clientA, clientB);

      await waitForOpen(clientA);
      await waitForOpen(clientB);

      send(clientA, {
        type: 'join',
        roomId: 'room-leave',
        peerId: 'a',
      });
      await waitForMessage(clientA, (message) => message.type === 'joined');

      send(clientB, {
        type: 'join',
        roomId: 'room-leave',
        peerId: 'b',
      });
      await waitForMessage(clientB, (message) => message.type === 'joined');

      const peerLeftPromise = waitForMessage(
        clientA,
        (message) => message.type === 'peer-left' && message.peerId === 'b',
      );
      send(clientB, {
        type: 'leave',
        roomId: 'room-leave',
        peerId: 'b',
      });
      const peerLeft = await peerLeftPromise;
      expect(peerLeft).toMatchObject({
        type: 'peer-left',
        roomId: 'room-leave',
        peerId: 'b',
      });
    });

    it('returns protocol error on invalid messages', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const client = new WebSocket(relayServer.getAddress());
      sockets.push(client);
      await waitForOpen(client);

      client.send('{"invalid":true}');
      const error = await waitForMessage(client, (message) => message.type === 'error');
      expect(error).toMatchObject({
        type: 'error',
        code: 'INVALID_MESSAGE',
      });
    });

    it('rejects unauthorized joins', async () => {
      relayServer = createRelayServer({
        port: 0,
        authorize: async ({ token }) => token === 'allow',
      });
      await relayServer.start();

      const client = new WebSocket(relayServer.getAddress());
      sockets.push(client);
      await waitForOpen(client);

      send(client, {
        type: 'join',
        roomId: 'room-auth',
        peerId: 'peer-a',
        token: 'deny',
      });

      const error = await waitForMessage(client, (message) => message.type === 'error');
      expect(error).toMatchObject({
        type: 'error',
        code: 'AUTH_FAILED',
      });
    });

    it('validates join and signal invariants', async () => {
      relayServer = createRelayServer({
        port: 0,
      });
      await relayServer.start();

      const clientA = new WebSocket(relayServer.getAddress());
      const clientB = new WebSocket(relayServer.getAddress());
      sockets.push(clientA, clientB);

      await waitForOpen(clientA);
      await waitForOpen(clientB);

      const notJoinedError = await sendAndWaitForMessage(
        clientA,
        {
          type: 'signal',
          roomId: 'room-checks',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          description: {
            type: 'offer',
            sdp: 'v=0',
          },
        },
        (message) => message.type === 'error',
      );
      expect(notJoinedError).toMatchObject({
        code: 'NOT_JOINED',
      });

      const transportNotJoinedError = await sendAndWaitForMessage(
        clientA,
        createTransportFrame({
          type: 'event',
          roomId: 'room-checks',
          fromPeerId: 'peer-a',
          payload: {
            name: 'ping',
            payload: true,
          },
        }),
        (message) => message.type === 'error',
      );
      expect(transportNotJoinedError).toMatchObject({
        code: 'NOT_JOINED',
      });

      await sendAndWaitForMessage(
        clientA,
        {
          type: 'join',
          roomId: 'room-checks',
          peerId: 'peer-a',
        },
        (message) => message.type === 'joined',
      );

      const alreadyJoinedError = await sendAndWaitForMessage(
        clientA,
        {
          type: 'join',
          roomId: 'room-checks',
          peerId: 'peer-z',
        },
        (message) => message.type === 'error',
      );
      expect(alreadyJoinedError).toMatchObject({
        code: 'ALREADY_JOINED',
      });

      const peerExistsError = await sendAndWaitForMessage(
        clientB,
        {
          type: 'join',
          roomId: 'room-checks',
          peerId: 'peer-a',
        },
        (message) => message.type === 'error',
      );
      expect(peerExistsError).toMatchObject({
        code: 'PEER_EXISTS',
      });

      await sendAndWaitForMessage(
        clientB,
        {
          type: 'join',
          roomId: 'room-checks',
          peerId: 'peer-b',
        },
        (message) => message.type === 'joined',
      );

      const roomMismatchError = await sendAndWaitForMessage(
        clientA,
        {
          type: 'signal',
          roomId: 'room-other',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          description: {
            type: 'offer',
            sdp: 'v=0',
          },
        },
        (message) => message.type === 'error',
      );
      expect(roomMismatchError).toMatchObject({
        code: 'ROOM_MISMATCH',
      });

      const senderMismatchError = await sendAndWaitForMessage(
        clientA,
        {
          type: 'signal',
          roomId: 'room-checks',
          fromPeerId: 'peer-not-a',
          toPeerId: 'peer-b',
          description: {
            type: 'offer',
            sdp: 'v=0',
          },
        },
        (message) => message.type === 'error',
      );
      expect(senderMismatchError).toMatchObject({
        code: 'PEER_MISMATCH',
      });

      const transportRoomMismatchError = await sendAndWaitForMessage(
        clientA,
        createTransportFrame({
          type: 'event',
          roomId: 'room-other',
          fromPeerId: 'peer-a',
          payload: {
            name: 'ping',
            payload: true,
          },
        }),
        (message) => message.type === 'error',
      );
      expect(transportRoomMismatchError).toMatchObject({
        code: 'ROOM_MISMATCH',
      });

      const transportSenderMismatchError = await sendAndWaitForMessage(
        clientA,
        createTransportFrame({
          type: 'event',
          roomId: 'room-checks',
          fromPeerId: 'peer-not-a',
          payload: {
            name: 'ping',
            payload: true,
          },
        }),
        (message) => message.type === 'error',
      );
      expect(transportSenderMismatchError).toMatchObject({
        code: 'PEER_MISMATCH',
      });

      const leaveMismatchError = await sendAndWaitForMessage(
        clientA,
        {
          type: 'leave',
          roomId: 'room-checks',
          peerId: 'peer-not-a',
        },
        (message) => message.type === 'error',
      );
      expect(leaveMismatchError).toMatchObject({
        code: 'PEER_MISMATCH',
      });
    });
  },
);
