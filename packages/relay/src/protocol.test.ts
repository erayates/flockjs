import { encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';

import {
  parseRelayClientMessage,
  type RelayTransportMessage,
  serializeRelayServerMessage,
} from './protocol';

const protocol = {
  minVersion: 1 as const,
  maxVersion: 2 as const,
  codecs: ['json', 'msgpack'] as const,
  preferredCodec: 'msgpack' as const,
};

describe('relay protocol', () => {
  it('serializes relay server messages', () => {
    expect(
      serializeRelayServerMessage({
        type: 'joined',
        roomId: 'room-a',
        peerId: 'peer-a',
        peers: [{ peerId: 'peer-b' }],
      }),
    ).toBe('{"type":"joined","roomId":"room-a","peerId":"peer-a","peers":[{"peerId":"peer-b"}]}');
  });

  it('parses join and leave client messages', () => {
    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
          peerId: 'peer-a',
          token: 'token-1',
          protocol,
          maxPeers: 2,
        }),
      ),
    ).toEqual({
      type: 'join',
      roomId: 'room-a',
      peerId: 'peer-a',
      token: 'token-1',
      protocol,
      maxPeers: 2,
    });

    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
          peerId: 'peer-a',
          maxPeers: 0,
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
          message: {
            source: 'flockjs',
            protocolVersion: 2,
            codec: 'json',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
            toPeerId: 'peer-b',
            timestamp: 1,
            type: 'event',
            payload: {
              name: 'ping',
              payload: {
                ok: true,
              },
            },
          },
        }),
      ),
    ).toEqual({
      type: 'transport',
      encoding: 'json',
      signal: {
        type: 'event',
        roomId: 'room-a',
        fromPeerId: 'peer-a',
        toPeerId: 'peer-b',
        timestamp: 1,
        payload: {
          name: 'ping',
          payload: {
            ok: true,
          },
        },
        },
      } satisfies RelayTransportMessage);
  });

  it('parses state and CRDT transport client messages', () => {
    expect(
      parseRelayClientMessage(
        JSON.stringify({
          type: 'transport',
          message: {
            source: 'flockjs',
            protocolVersion: 2,
            codec: 'json',
            roomId: 'room-state',
            fromPeerId: 'peer-a',
            toPeerId: 'peer-b',
            timestamp: 1,
            type: 'state:update',
            payload: {
              value: {
                count: 1,
              },
              history: [],
              vectorClock: {
                'peer-a': 1,
              },
              changedBy: 'peer-a',
              timestamp: 1,
              reason: 'set',
            },
          },
        }),
      ),
    ).toEqual({
      type: 'transport',
      encoding: 'json',
      signal: {
        type: 'state:update',
        roomId: 'room-state',
        fromPeerId: 'peer-a',
        toPeerId: 'peer-b',
        timestamp: 1,
        payload: {
          value: {
            count: 1,
          },
          history: [],
          vectorClock: {
            'peer-a': 1,
          },
          changedBy: 'peer-a',
          timestamp: 1,
          reason: 'set',
        },
      },
    } satisfies RelayTransportMessage);

    expect(
      parseRelayClientMessage(
        new Uint8Array(
          encode({
            type: 'transport',
            message: {
              source: 'flockjs',
              protocolVersion: 2,
              codec: 'msgpack',
              roomId: 'room-crdt',
              fromPeerId: 'peer-a',
              toPeerId: 'peer-b',
              timestamp: 2,
              type: 'crdt:sync',
              payload: {
                kind: 'update',
                data: new Uint8Array([1, 2, 3]),
                meta: {
                  reason: 'set',
                  changedBy: 'peer-a',
                  timestamp: 2,
                },
              },
            },
          }),
        ),
      ),
    ).toEqual({
      type: 'transport',
      encoding: 'msgpack',
      signal: {
        type: 'crdt:sync',
        roomId: 'room-crdt',
        fromPeerId: 'peer-a',
        toPeerId: 'peer-b',
        timestamp: 2,
        payload: {
          kind: 'update',
          data: new Uint8Array([1, 2, 3]),
          meta: {
            reason: 'set',
            changedBy: 'peer-a',
            timestamp: 2,
          },
        },
      },
    } satisfies RelayTransportMessage);
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
      parseRelayClientMessage(
        JSON.stringify({
          type: 'transport',
          message: {
            source: 'flockjs',
            protocolVersion: 2,
            codec: 'json',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
            timestamp: 1,
            type: 'unknown',
            payload: {},
          },
        }),
      ),
    ).toBeNull();
  });
});
