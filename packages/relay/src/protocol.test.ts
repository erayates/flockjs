import { describe, expect, it } from 'vitest';

import { parseRelayClientMessage, serializeRelayServerMessage } from './protocol';

describe('relay protocol', () => {
  it('serializes relay server messages', () => {
    expect(
      serializeRelayServerMessage({
        type: 'joined',
        roomId: 'room-a',
        peerId: 'peer-a',
        peers: ['peer-b'],
      }),
    ).toBe('{"type":"joined","roomId":"room-a","peerId":"peer-a","peers":["peer-b"]}');
  });

  it('parses join and leave client messages', () => {
    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
          peerId: 'peer-a',
          token: 'token-1',
        }),
      ),
    ).toEqual({
      type: 'join',
      roomId: 'room-a',
      peerId: 'peer-a',
      token: 'token-1',
    });

    expect(
      parseRelayClientMessage(
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
      parseRelayClientMessage(
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
  });

  it('parses signal client messages with description or candidate', () => {
    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          description: {
            type: 'offer',
            sdp: 'v=0',
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      description: {
        type: 'offer',
        sdp: 'v=0',
      },
    });

    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          candidate: {
            candidate: 'candidate:1',
            sdpMid: null,
            usernameFragment: null,
            sdpMLineIndex: 0,
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:1',
        sdpMid: null,
        usernameFragment: null,
        sdpMLineIndex: 0,
      },
    });
  });

  it('parses transport client messages', () => {
    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'transport',
          signal: {
            type: 'event',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
            toPeerId: 'peer-b',
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
        fromPeerId: 'peer-a',
        toPeerId: 'peer-b',
        payload: {
          ok: true,
        },
      },
    });
  });

  it('rejects invalid relay client payloads', () => {
    expect(parseRelayClientMessage('not-json')).toBeNull();
    expect(parseRelayClientMessage(null)).toBeNull();
    expect(parseRelayClientMessage(JSON.stringify({ type: 'unknown' }))).toBeNull();

    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
        }),
      ),
    ).toBeNull();

    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
        }),
      ),
    ).toBeNull();

    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'leave',
          peerId: 'peer-a',
        }),
      ),
    ).toBeNull();

    expect(
      parseRelayClientMessage(
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
  });
});
