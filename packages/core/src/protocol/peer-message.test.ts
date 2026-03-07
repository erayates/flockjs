import { describe, expect, it } from 'vitest';

import {
  createProtocolCapabilities,
  LEGACY_PROTOCOL_SESSION,
  negotiatePeerProtocolSession,
  normalizePeerWireMessage,
  parsePeerProtocolCapabilities,
  parsePeerWireEnvelope,
  type PeerWireMessage,
  serializePeerWireEnvelope,
} from './peer-message';

const modernCapabilities = createProtocolCapabilities(['json', 'msgpack'], 'msgpack');
const jsonOnlyCapabilities = createProtocolCapabilities(['json'], 'json');

function createHelloSignal(): PeerWireMessage {
  return {
    type: 'hello',
    roomId: 'room-a',
    fromPeerId: 'peer-a',
    timestamp: 10,
    payload: {
      peer: {
        id: 'peer-a',
        joinedAt: 1,
        lastSeen: 10,
        name: 'Alice',
        role: 'editor',
        profile: {
          team: 'core',
        },
      },
      protocol: modernCapabilities,
    },
  };
}

describe('peer-message', () => {
  it('serializes and parses v2 JSON envelopes', () => {
    const signal = createHelloSignal();
    const encoded = serializePeerWireEnvelope(signal, {
      version: 2,
      codec: 'json',
      legacy: false,
    });

    expect(typeof encoded).toBe('string');
    expect(parsePeerWireEnvelope(encoded)).toEqual(signal);
  });

  it('serializes and parses v2 MessagePack envelopes', () => {
    const signal: PeerWireMessage = {
      type: 'event',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: 11,
      payload: {
        name: 'ping',
        payload: {
          ok: true,
        },
      },
    };

    const encoded = serializePeerWireEnvelope(signal, {
      version: 2,
      codec: 'msgpack',
      legacy: false,
    });

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(parsePeerWireEnvelope(encoded)).toEqual(signal);
  });

  it('parses legacy v1 JSON envelopes into normalized modern messages', () => {
    const parsed = parsePeerWireEnvelope(
      JSON.stringify({
        source: 'flockjs',
        version: 1,
        signal: {
          type: 'event',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          payload: {
            event: {
              name: 'legacy',
              payload: true,
            },
          },
        },
      }),
      {
        now: () => 99,
      },
    );

    expect(parsed).toEqual({
      type: 'event',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: 99,
      payload: {
        name: 'legacy',
        payload: true,
      },
    });
  });

  it('validates and normalizes every supported message type', () => {
    const signals: PeerWireMessage[] = [
      createHelloSignal(),
      {
        type: 'welcome',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        toPeerId: 'peer-a',
        timestamp: 11,
        payload: {
          peer: {
            id: 'peer-b',
            joinedAt: 1,
            lastSeen: 11,
          },
          protocol: modernCapabilities,
        },
      },
      {
        type: 'presence:update',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 12,
        payload: {
          peer: {
            id: 'peer-b',
            joinedAt: 1,
            lastSeen: 12,
          },
        },
      },
      {
        type: 'leave',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 13,
        payload: {},
      },
      {
        type: 'cursor:update',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 14,
        payload: {
          cursor: {
            userId: 'peer-b',
            name: 'Bob',
            color: '#111111',
            x: 1,
            y: 2,
            xAbsolute: 3,
            yAbsolute: 4,
            idle: false,
          },
        },
      },
      {
        type: 'state:update',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 15,
        payload: {
          value: {
            count: 2,
          },
          history: [
            {
              count: 1,
            },
          ],
          vectorClock: {
            'peer-a': 1,
            'peer-b': 2,
          },
          changedBy: 'peer-b',
          timestamp: 15,
          reason: 'patch',
        },
      },
      {
        type: 'awareness:update',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 16,
        payload: {
          awareness: {
            peerId: 'peer-b',
            typing: true,
          },
        },
      },
      {
        type: 'event',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 17,
        payload: {
          name: 'ping',
          payload: {
            ok: true,
          },
          loopback: true,
        },
      },
      {
        type: 'crdt:sync',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        toPeerId: 'peer-a',
        timestamp: 18,
        payload: {
          kind: 'update',
          data: new Uint8Array([1, 2, 3]),
          meta: {
            reason: 'patch',
            changedBy: 'peer-b',
            timestamp: 18,
          },
        },
      },
      {
        type: 'crdt:awareness',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 19,
        payload: {
          data: new Uint8Array([9, 8, 7]),
        },
      },
    ];

    for (const signal of signals) {
      expect(normalizePeerWireMessage(signal)).toEqual(signal);
    }
  });

  it('preserves custom peer presence fields during normalization', () => {
    expect(
      parsePeerWireEnvelope(
        JSON.stringify({
          source: 'flockjs',
          protocolVersion: 2,
          codec: 'json',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          timestamp: 20,
          type: 'presence:update',
          payload: {
            peer: {
              id: 'peer-a',
              joinedAt: 1,
              lastSeen: 20,
              role: 'editor',
              profile: {
                team: 'core',
              },
            },
          },
        }),
      ),
    ).toEqual({
      type: 'presence:update',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      timestamp: 20,
      payload: {
        peer: {
          id: 'peer-a',
          joinedAt: 1,
          lastSeen: 20,
          role: 'editor',
          profile: {
            team: 'core',
          },
        },
      },
    } satisfies PeerWireMessage);
  });

  it('encodes CRDT binary payloads as JSON-safe arrays and parses them back to Uint8Array', () => {
    const signal: PeerWireMessage = {
      type: 'crdt:sync',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      timestamp: 30,
      payload: {
        kind: 'state-vector',
        data: new Uint8Array([1, 2, 3, 4]),
      },
    };

    const legacyEncoded = serializePeerWireEnvelope(signal, LEGACY_PROTOCOL_SESSION);
    const jsonEncoded = serializePeerWireEnvelope(signal, {
      version: 2,
      codec: 'json',
      legacy: false,
    });
    const msgpackEncoded = serializePeerWireEnvelope(signal, {
      version: 2,
      codec: 'msgpack',
      legacy: false,
    });

    expect(typeof legacyEncoded).toBe('string');
    expect(typeof jsonEncoded).toBe('string');
    expect(msgpackEncoded).toBeInstanceOf(Uint8Array);
    expect(JSON.parse(legacyEncoded as string).signal.payload.data).toEqual([1, 2, 3, 4]);
    expect(JSON.parse(jsonEncoded as string).payload.data).toEqual([1, 2, 3, 4]);
    expect(
      parsePeerWireEnvelope(legacyEncoded, {
        now: () => 30,
      }),
    ).toEqual(signal);
    expect(parsePeerWireEnvelope(jsonEncoded)).toEqual(signal);
    expect(parsePeerWireEnvelope(msgpackEncoded)).toEqual(signal);
  });

  it('rejects malformed payloads and unsupported protocol metadata', () => {
    expect(
      parsePeerProtocolCapabilities({
        minVersion: 1,
        maxVersion: 2,
        codecs: ['json'],
        preferredCodec: 'msgpack',
      }),
    ).toBeNull();

    expect(
      parsePeerWireEnvelope(
        JSON.stringify({
          source: 'flockjs',
          protocolVersion: 2,
          codec: 'json',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          timestamp: 1,
          type: 'hello',
          payload: {
            peer: {
              id: 'peer-a',
              joinedAt: 1,
              lastSeen: 1,
            },
          },
        }),
      ),
    ).toBeNull();

    expect(
      parsePeerWireEnvelope(
        JSON.stringify({
          source: 'flockjs',
          protocolVersion: 2,
          codec: 'json',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          timestamp: 1,
          type: 'state:update',
          payload: {
            value: {
              count: 1,
            },
            history: [],
            vectorClock: {
              'peer-a': 'bad',
            },
            changedBy: 'peer-a',
            timestamp: 1,
            reason: 'set',
          },
        }),
      ),
    ).toBeNull();

    expect(
      parsePeerWireEnvelope(
        JSON.stringify({
          source: 'flockjs',
          version: 1,
          signal: {
            type: 'event',
            roomId: 'room-a',
            fromPeerId: 'peer-a',
            payload: {},
          },
        }),
      ),
    ).toBeNull();

    expect(
      parsePeerWireEnvelope(
        JSON.stringify({
          source: 'flockjs',
          protocolVersion: 2,
          codec: 'json',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          timestamp: 1,
          type: 'crdt:sync',
          payload: {
            kind: 'update',
            data: [1, 'bad', 3],
          },
        }),
      ),
    ).toBeNull();
  });

  it('negotiates legacy fallback, msgpack, json fallback, and protocol mismatch', () => {
    expect(
      negotiatePeerProtocolSession(modernCapabilities, undefined, {
        supportsBinary: true,
      }),
    ).toEqual({
      compatible: true,
      session: LEGACY_PROTOCOL_SESSION,
      reason: 'Remote peer did not advertise protocol capabilities; using legacy v1/json.',
    });

    expect(
      negotiatePeerProtocolSession(modernCapabilities, modernCapabilities, {
        supportsBinary: true,
      }),
    ).toEqual({
      compatible: true,
      session: {
        version: 2,
        codec: 'msgpack',
        legacy: false,
      },
      reason: 'Negotiated v2/msgpack.',
    });

    expect(
      negotiatePeerProtocolSession(modernCapabilities, modernCapabilities, {
        supportsBinary: false,
      }),
    ).toEqual({
      compatible: true,
      session: {
        version: 2,
        codec: 'json',
        legacy: false,
      },
      reason: 'Negotiated v2/json fallback.',
    });

    expect(
      negotiatePeerProtocolSession(modernCapabilities, jsonOnlyCapabilities, {
        supportsBinary: true,
      }),
    ).toEqual({
      compatible: true,
      session: {
        version: 2,
        codec: 'json',
        legacy: false,
      },
      reason: 'Negotiated v2/json fallback.',
    });

    expect(
      negotiatePeerProtocolSession(
        createProtocolCapabilities(['json'], 'json'),
        {
          minVersion: 1,
          maxVersion: 1,
          codecs: ['json'],
          preferredCodec: 'json',
        },
        {
          supportsBinary: true,
        },
      ),
    ).toEqual({
      compatible: true,
      session: {
        version: 1,
        codec: 'json',
        legacy: false,
      },
      reason: 'Negotiated v1/json compatibility session.',
    });

    const incompatibleRemote = {
      minVersion: 2,
      maxVersion: 2,
      codecs: ['msgpack'],
      preferredCodec: 'msgpack',
    } as unknown as typeof modernCapabilities;

    expect(
      negotiatePeerProtocolSession(
        {
          minVersion: 1,
          maxVersion: 1,
          codecs: ['json'],
          preferredCodec: 'json',
        },
        incompatibleRemote,
        {
          supportsBinary: true,
        },
      ),
    ).toEqual({
      compatible: false,
      reason: 'No compatible protocol version. local=1-1 remote=2-2.',
    });
  });

  it('normalizes protocol capability defaults and codec deduplication', () => {
    expect(createProtocolCapabilities([], 'msgpack')).toEqual({
      minVersion: 1,
      maxVersion: 2,
      codecs: ['json'],
      preferredCodec: 'json',
    });

    expect(createProtocolCapabilities(['json', 'json', 'msgpack'], 'json')).toEqual({
      minVersion: 1,
      maxVersion: 2,
      codecs: ['json', 'msgpack'],
      preferredCodec: 'json',
    });
  });
});
