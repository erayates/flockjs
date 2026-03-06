import { describe, expect, it } from 'vitest';

import { decodeMessagePack, encodeMessagePack, normalizeProtocolValue } from './messagepack';

describe('messagepack', () => {
  it('roundtrips supported scalar, object, array, and binary values', () => {
    const fixture = {
      ok: true,
      count: 42,
      ratio: 1.5,
      label: 'hello',
      data: new Uint8Array([1, 2, 3]),
      nested: {
        list: [null, false, 'x'],
      },
    };

    const encoded = encodeMessagePack(fixture);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) {
      throw new Error(encoded.error);
    }

    const decoded = decodeMessagePack(encoded.value);
    expect(decoded).toEqual({
      ok: true,
      value: {
        ok: true,
        count: 42,
        ratio: 1.5,
        label: 'hello',
        data: new Uint8Array([1, 2, 3]),
        nested: {
          list: [null, false, 'x'],
        },
      },
    });
  });

  it('normalizes undefined object keys and array items consistently', () => {
    const normalized = normalizeProtocolValue({
      a: 1,
      b: undefined,
      list: [1, undefined, 3],
    });

    expect(normalized).toEqual({
      ok: true,
      value: {
        a: 1,
        list: [1, null, 3],
      },
    });
  });

  it('produces smaller payloads than JSON for representative fixtures', () => {
    const helloFixture = {
      source: 'flockjs',
      protocolVersion: 2,
      codec: 'msgpack',
      roomId: 'room-size',
      fromPeerId: 'peer-a',
      timestamp: 1,
      type: 'hello',
      payload: {
        peer: {
          id: 'peer-a',
          joinedAt: 1,
          lastSeen: 1,
          name: 'Alice',
          color: '#111111',
        },
        protocol: {
          minVersion: 1,
          maxVersion: 2,
          codecs: ['json', 'msgpack'],
          preferredCodec: 'msgpack',
        },
      },
    };

    const encoded = encodeMessagePack(helloFixture);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) {
      throw new Error(encoded.error);
    }

    const jsonBytes = new TextEncoder().encode(JSON.stringify(helloFixture)).byteLength;
    expect(encoded.value.byteLength).toBeLessThan(jsonBytes);
  });

  it('fails cleanly for unsupported values', () => {
    expect(encodeMessagePack({ value: new Map() }).ok).toBe(false);
    expect(encodeMessagePack({ value: 1n }).ok).toBe(false);
    expect(encodeMessagePack({ value: class Example {} }).ok).toBe(false);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(encodeMessagePack(circular).ok).toBe(false);
  });

  it('rejects malformed binary input without throwing', () => {
    expect(decodeMessagePack(new Uint8Array([0xc1]))).toEqual({
      ok: false,
      error: 'Unsupported MessagePack prefix 0xc1.',
    });

    expect(decodeMessagePack(new Uint8Array([0xd9]))).toEqual({
      ok: false,
      error: 'Invalid MessagePack str8 payload.',
    });
  });
});
