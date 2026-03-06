import { describe, expect, it } from 'vitest';

import type { RoomTransportSignal } from './transport';
import {
  getBootstrapProtocolSession,
  getTransportProtocolCapabilities,
} from './transport.protocol';
import {
  parseWebSocketRelayClientMessage,
  parseWebSocketRelayServerMessage,
  serializeWebSocketRelayMessage,
} from './websocket.protocol';

describe('websocket.protocol', () => {
  const protocol = getTransportProtocolCapabilities('websocket');

  it('serializes websocket relay client messages', () => {
    expect(
      serializeWebSocketRelayMessage({
        type: 'join',
        roomId: 'room-a',
        peerId: 'peer-a',
        token: 'token-1',
        protocol,
        maxPeers: 4,
      }),
    ).toBe(
      JSON.stringify({
        type: 'join',
        roomId: 'room-a',
        peerId: 'peer-a',
        token: 'token-1',
        protocol,
        maxPeers: 4,
      }),
    );
  });

  it('parses joined, peer lifecycle, transport, and error server messages', () => {
    const welcomeSignal: RoomTransportSignal = {
      type: 'welcome',
      roomId: 'room-a',
      fromPeerId: 'peer-b',
      toPeerId: 'peer-a',
      timestamp: 5,
      payload: {
        peer: {
          id: 'peer-b',
          joinedAt: 1,
          lastSeen: 5,
        },
        protocol,
      },
    };

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'joined',
          roomId: 'room-a',
          peerId: 'peer-a',
          peers: [{ peerId: 'peer-a', protocol }, { peerId: 'peer-b' }],
        }),
      ),
    ).toEqual({
      type: 'joined',
      roomId: 'room-a',
      peerId: 'peer-a',
      peers: [{ peerId: 'peer-a', protocol }, { peerId: 'peer-b' }],
    });

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'peer-joined',
          roomId: 'room-a',
          peerId: 'peer-b',
          protocol,
        }),
      ),
    ).toEqual({
      type: 'peer-joined',
      roomId: 'room-a',
      peerId: 'peer-b',
      protocol,
    });

    expect(
      parseWebSocketRelayServerMessage(
        serializeWebSocketRelayMessage({
          type: 'transport',
          signal: welcomeSignal,
          session: getBootstrapProtocolSession(),
        }),
      ),
    ).toEqual({
      type: 'transport',
      signal: {
        ...welcomeSignal,
        timestamp: expect.any(Number),
      },
      encoding: 'json',
    });

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'AUTH_FAILED',
          message: 'forbidden',
        }),
      ),
    ).toEqual({
      type: 'error',
      code: 'AUTH_FAILED',
      message: 'forbidden',
    });
  });

  it('parses join, leave, and transport client messages', () => {
    expect(
      parseWebSocketRelayClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
          peerId: 'peer-a',
          protocol,
          maxPeers: 3,
        }),
      ),
    ).toEqual({
      type: 'join',
      roomId: 'room-a',
      peerId: 'peer-a',
      protocol,
      maxPeers: 3,
    });

    expect(
      parseWebSocketRelayClientMessage(
        JSON.stringify({
          type: 'leave',
          roomId: 'room-a',
          peerId: 'peer-a',
        }),
      ),
    ).toEqual({
      type: 'leave',
      roomId: 'room-a',
      peerId: 'peer-a',
    });

    const helloSignal: RoomTransportSignal = {
      type: 'hello',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      timestamp: 1,
      payload: {
        peer: {
          id: 'peer-a',
          joinedAt: 1,
          lastSeen: 1,
        },
        protocol,
      },
    };

    expect(
      parseWebSocketRelayClientMessage(
        serializeWebSocketRelayMessage({
          type: 'transport',
          signal: helloSignal,
          session: getBootstrapProtocolSession(),
        }),
      ),
    ).toEqual({
      type: 'transport',
      signal: {
        ...helloSignal,
        timestamp: expect.any(Number),
      },
      encoding: 'json',
    });
  });

  it('rejects invalid websocket relay payloads', () => {
    expect(parseWebSocketRelayServerMessage('not-json')).toBeNull();
    expect(parseWebSocketRelayClientMessage(null)).toBeNull();

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'transport',
          message: {
            source: 'flockjs',
            protocolVersion: 2,
            codec: 'json',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
            timestamp: 1,
            type: 'event',
            payload: {},
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseWebSocketRelayClientMessage(
        JSON.stringify({
          type: 'transport',
          message: {
            source: 'flockjs',
            version: 1,
            signal: {
              roomId: 'room-a',
              fromPeerId: 'peer-a',
            },
          },
        }),
      ),
    ).toBeNull();
  });
});
