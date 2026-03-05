import { describe, expect, it } from 'vitest';

import {
  parseWebSocketRelayClientMessage,
  parseWebSocketRelayServerMessage,
  serializeWebSocketRelayMessage,
} from './websocket.protocol';

describe('websocket.protocol', () => {
  it('serializes websocket relay client messages', () => {
    expect(
      serializeWebSocketRelayMessage({
        type: 'join',
        roomId: 'room-a',
        peerId: 'peer-a',
        token: 'token-1',
      }),
    ).toBe('{"type":"join","roomId":"room-a","peerId":"peer-a","token":"token-1"}');
  });

  it('parses joined, peer lifecycle, transport, and error server messages', () => {
    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'joined',
          roomId: 'room-a',
          peerId: 'peer-a',
          peers: ['peer-a', 'peer-b', 123],
        }),
      ),
    ).toEqual({
      type: 'joined',
      roomId: 'room-a',
      peerId: 'peer-a',
      peers: ['peer-a', 'peer-b'],
    });

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'peer-left',
          roomId: 'room-a',
          peerId: 'peer-b',
        }),
      ),
    ).toEqual({
      type: 'peer-left',
      roomId: 'room-a',
      peerId: 'peer-b',
    });

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'transport',
          signal: {
            type: 'event',
            roomId: 'room-a',
            fromPeerId: 'peer-b',
            toPeerId: 'peer-a',
            payload: {
              ok: true,
            },
          },
        }),
      ),
    ).toEqual({
      type: 'transport',
      signal: {
        type: 'event',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        toPeerId: 'peer-a',
        payload: {
          ok: true,
        },
      },
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
        }),
      ),
    ).toEqual({
      type: 'join',
      roomId: 'room-a',
      peerId: 'peer-a',
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

    expect(
      parseWebSocketRelayClientMessage(
        JSON.stringify({
          type: 'transport',
          signal: {
            type: 'hello',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
          },
        }),
      ),
    ).toEqual({
      type: 'transport',
      signal: {
        type: 'hello',
        roomId: 'room-a',
        fromPeerId: 'peer-a',
      },
    });
  });

  it('rejects invalid websocket relay payloads', () => {
    expect(parseWebSocketRelayServerMessage('not-json')).toBeNull();
    expect(parseWebSocketRelayClientMessage(null)).toBeNull();

    expect(
      parseWebSocketRelayServerMessage(
        JSON.stringify({
          type: 'transport',
          signal: {
            type: 'transport:error',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseWebSocketRelayClientMessage(
        JSON.stringify({
          type: 'transport',
          signal: {
            roomId: 'room-a',
            fromPeerId: 'peer-a',
          },
        }),
      ),
    ).toBeNull();
  });
});
