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
        type: 'awareness:update',
        roomId: 'room-a',
        fromPeerId: 'peer-b',
        timestamp: 15,
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
        timestamp: 16,
        payload: {
          name: 'ping',
          payload: {
            ok: true,
          },
          loopback: true,
        },
      },
    ];

    for (const signal of signals) {
      expect(normalizePeerWireMessage(signal)).toEqual(signal);
    }
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
});
