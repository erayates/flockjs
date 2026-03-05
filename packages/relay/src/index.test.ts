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

async function terminateSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      socket.off('close', onClose);
      resolve();
    }, SOCKET_CLOSE_TIMEOUT_MS);

    const onClose = (): void => {
      clearTimeout(timer);
      resolve();
    };

    socket.once('close', onClose);
    socket.terminate();
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
        peers: ['a'],
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

      const noSignalForC = await Promise.race([
        waitForMessage(clientC, (message) => message.type === 'signal').then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 150)),
      ]);
      expect(noSignalForC).toBe(false);
    });

    it('emits peer-left when a peer disconnects', async () => {
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
      await terminateSocket(clientB);
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
