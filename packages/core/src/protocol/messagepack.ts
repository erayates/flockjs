type PrimitiveValue = null | boolean | number | string | Uint8Array;

export type ProtocolSerializableValue =
  | PrimitiveValue
  | ProtocolSerializableValue[]
  | { [key: string]: ProtocolSerializableValue };

interface Success<T> {
  ok: true;
  value: T;
}

interface Failure {
  ok: false;
  error: string;
}

export type ProtocolSerializationResult<T> = Success<T> | Failure;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const MIN_INT8 = -0x80;
const MAX_INT8 = 0x7f;
const MIN_INT16 = -0x8000;
const MAX_INT16 = 0x7fff;
const MIN_INT32 = -0x80000000;
const MAX_INT32 = 0x7fffffff;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createFailure(error: string): Failure {
  return {
    ok: false,
    error,
  };
}

function createSuccess<T>(value: T): Success<T> {
  return {
    ok: true,
    value,
  };
}

function normalizeProtocolValueInternal(
  value: unknown,
  seen: Set<object>,
): ProtocolSerializationResult<ProtocolSerializableValue> {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return createSuccess(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return createFailure('Protocol serialization does not support non-finite numbers.');
    }

    return createSuccess(value);
  }

  if (value instanceof Uint8Array) {
    return createSuccess(value);
  }

  if (value === undefined) {
    return createFailure('Protocol serialization requires object-level handling for undefined.');
  }

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return createFailure(`Protocol serialization does not support ${typeof value} values.`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return createFailure('Protocol serialization does not support circular arrays.');
    }

    seen.add(value);
    const normalized: ProtocolSerializableValue[] = [];

    for (const item of value) {
      if (item === undefined) {
        normalized.push(null);
        continue;
      }

      const result = normalizeProtocolValueInternal(item, seen);
      if (!result.ok) {
        seen.delete(value);
        return result;
      }

      normalized.push(result.value);
    }

    seen.delete(value);
    return createSuccess(normalized);
  }

  if (!isPlainObject(value)) {
    return createFailure('Protocol serialization only supports plain objects.');
  }

  if (seen.has(value)) {
    return createFailure('Protocol serialization does not support circular objects.');
  }

  seen.add(value);
  const normalized: Record<string, ProtocolSerializableValue> = {};

  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }

    const result = normalizeProtocolValueInternal(item, seen);
    if (!result.ok) {
      seen.delete(value);
      return result;
    }

    normalized[key] = result.value;
  }

  seen.delete(value);
  return createSuccess(normalized);
}

export function normalizeProtocolValue(
  value: unknown,
): ProtocolSerializationResult<ProtocolSerializableValue> {
  return normalizeProtocolValueInternal(value, new Set<object>());
}

class ByteWriter {
  private readonly bytes: number[] = [];

  public writeByte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  public writeBytes(values: Uint8Array): void {
    for (const value of values) {
      this.writeByte(value);
    }
  }

  public writeUint16(value: number): void {
    this.writeByte((value >> 8) & 0xff);
    this.writeByte(value & 0xff);
  }

  public writeUint32(value: number): void {
    this.writeByte((value >>> 24) & 0xff);
    this.writeByte((value >>> 16) & 0xff);
    this.writeByte((value >>> 8) & 0xff);
    this.writeByte(value & 0xff);
  }

  public writeInt8(value: number): void {
    this.writeByte(value);
  }

  public writeInt16(value: number): void {
    this.writeUint16(value & 0xffff);
  }

  public writeInt32(value: number): void {
    this.writeUint32(value >>> 0);
  }

  public writeFloat64(value: number): void {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, false);
    this.writeBytes(new Uint8Array(buffer));
  }

  public toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function writeStringHeader(writer: ByteWriter, bytes: Uint8Array): void {
  if (bytes.byteLength <= 31) {
    writer.writeByte(0xa0 | bytes.byteLength);
    return;
  }

  if (bytes.byteLength <= 0xff) {
    writer.writeByte(0xd9);
    writer.writeByte(bytes.byteLength);
    return;
  }

  if (bytes.byteLength <= MAX_UINT16) {
    writer.writeByte(0xda);
    writer.writeUint16(bytes.byteLength);
    return;
  }

  writer.writeByte(0xdb);
  writer.writeUint32(bytes.byteLength);
}

function writeBinaryHeader(writer: ByteWriter, bytes: Uint8Array): void {
  if (bytes.byteLength <= 0xff) {
    writer.writeByte(0xc4);
    writer.writeByte(bytes.byteLength);
    return;
  }

  if (bytes.byteLength <= MAX_UINT16) {
    writer.writeByte(0xc5);
    writer.writeUint16(bytes.byteLength);
    return;
  }

  writer.writeByte(0xc6);
  writer.writeUint32(bytes.byteLength);
}

function writeArrayHeader(writer: ByteWriter, length: number): void {
  if (length <= 15) {
    writer.writeByte(0x90 | length);
    return;
  }

  if (length <= MAX_UINT16) {
    writer.writeByte(0xdc);
    writer.writeUint16(length);
    return;
  }

  writer.writeByte(0xdd);
  writer.writeUint32(length);
}

function writeMapHeader(writer: ByteWriter, length: number): void {
  if (length <= 15) {
    writer.writeByte(0x80 | length);
    return;
  }

  if (length <= MAX_UINT16) {
    writer.writeByte(0xde);
    writer.writeUint16(length);
    return;
  }

  writer.writeByte(0xdf);
  writer.writeUint32(length);
}

function encodeNormalizedValue(value: ProtocolSerializableValue, writer: ByteWriter): void {
  if (value === null) {
    writer.writeByte(0xc0);
    return;
  }

  if (typeof value === 'boolean') {
    writer.writeByte(value ? 0xc3 : 0xc2);
    return;
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value >= 0 && value <= 0x7f) {
        writer.writeByte(value);
        return;
      }

      if (value >= -32 && value < 0) {
        writer.writeByte(value);
        return;
      }

      if (value >= 0 && value <= 0xff) {
        writer.writeByte(0xcc);
        writer.writeByte(value);
        return;
      }

      if (value >= 0 && value <= MAX_UINT16) {
        writer.writeByte(0xcd);
        writer.writeUint16(value);
        return;
      }

      if (value >= 0 && value <= MAX_UINT32) {
        writer.writeByte(0xce);
        writer.writeUint32(value);
        return;
      }

      if (value >= MIN_INT8 && value <= MAX_INT8) {
        writer.writeByte(0xd0);
        writer.writeInt8(value);
        return;
      }

      if (value >= MIN_INT16 && value <= MAX_INT16) {
        writer.writeByte(0xd1);
        writer.writeInt16(value);
        return;
      }

      if (value >= MIN_INT32 && value <= MAX_INT32) {
        writer.writeByte(0xd2);
        writer.writeInt32(value);
        return;
      }
    }

    writer.writeByte(0xcb);
    writer.writeFloat64(value);
    return;
  }

  if (typeof value === 'string') {
    const bytes = textEncoder.encode(value);
    writeStringHeader(writer, bytes);
    writer.writeBytes(bytes);
    return;
  }

  if (value instanceof Uint8Array) {
    writeBinaryHeader(writer, value);
    writer.writeBytes(value);
    return;
  }

  if (Array.isArray(value)) {
    writeArrayHeader(writer, value.length);
    for (const item of value) {
      encodeNormalizedValue(item, writer);
    }
    return;
  }

  const entries = Object.entries(value);
  writeMapHeader(writer, entries.length);
  for (const [key, entryValue] of entries) {
    encodeNormalizedValue(key, writer);
    encodeNormalizedValue(entryValue, writer);
  }
}

export function encodeMessagePack(value: unknown): ProtocolSerializationResult<Uint8Array> {
  const normalized = normalizeProtocolValue(value);
  if (!normalized.ok) {
    return normalized;
  }

  const writer = new ByteWriter();
  encodeNormalizedValue(normalized.value, writer);
  return createSuccess(writer.toUint8Array());
}

class ByteReader {
  private offset = 0;

  public constructor(private readonly bytes: Uint8Array) {}

  public get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  public readByte(): number | null {
    if (this.remaining < 1) {
      return null;
    }

    const value = this.bytes[this.offset];
    if (value === undefined) {
      return null;
    }

    this.offset += 1;
    return value;
  }

  public readUint16(): number | null {
    if (this.remaining < 2) {
      return null;
    }

    const first = this.bytes[this.offset];
    const second = this.bytes[this.offset + 1];
    if (first === undefined || second === undefined) {
      return null;
    }

    const value = (first << 8) | second;
    this.offset += 2;
    return value;
  }

  public readUint32(): number | null {
    if (this.remaining < 4) {
      return null;
    }

    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4);
    const value = view.getUint32(0, false);
    this.offset += 4;
    return value;
  }

  public readInt8(): number | null {
    const value = this.readByte();
    if (value === null) {
      return null;
    }

    return value > 0x7f ? value - 0x100 : value;
  }

  public readInt16(): number | null {
    const value = this.readUint16();
    if (value === null) {
      return null;
    }

    return value > 0x7fff ? value - 0x10000 : value;
  }

  public readInt32(): number | null {
    const value = this.readUint32();
    if (value === null) {
      return null;
    }

    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  public readUint64(): number | null {
    if (this.remaining < 8) {
      return null;
    }

    const high = this.readUint32();
    const low = this.readUint32();
    if (high === null || low === null) {
      return null;
    }

    if (high > 0x1fffff) {
      return null;
    }

    const value = high * 0x100000000 + low;
    return value;
  }

  public readInt64(): number | null {
    if (this.remaining < 8) {
      return null;
    }

    const high = this.readUint32();
    const low = this.readUint32();
    if (high === null || low === null) {
      return null;
    }

    if (high & 0x80000000) {
      const twosComplementHigh = (~high >>> 0) & 0xffffffff;
      const twosComplementLow = (~low >>> 0) & 0xffffffff;
      const incrementedLow = (twosComplementLow + 1) >>> 0;
      const incrementedHigh = (twosComplementHigh + (incrementedLow === 0 ? 1 : 0)) >>> 0;

      if (incrementedHigh > 0x1fffff) {
        return null;
      }

      return -(incrementedHigh * 0x100000000 + incrementedLow);
    }

    if (high > 0x1fffff) {
      return null;
    }

    return high * 0x100000000 + low;
  }

  public readFloat64(): number | null {
    if (this.remaining < 8) {
      return null;
    }

    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8);
    const value = view.getFloat64(0, false);
    this.offset += 8;
    return value;
  }

  public readBytes(length: number): Uint8Array | null {
    if (this.remaining < length) {
      return null;
    }

    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

function decodeUtf8(reader: ByteReader, length: number): string | null {
  const bytes = reader.readBytes(length);
  if (!bytes) {
    return null;
  }

  return textDecoder.decode(bytes);
}

function decodeValue(reader: ByteReader): ProtocolSerializationResult<unknown> {
  const prefix = reader.readByte();
  if (prefix === null) {
    return createFailure('Unexpected end of MessagePack payload.');
  }

  if (prefix <= 0x7f) {
    return createSuccess(prefix);
  }

  if (prefix >= 0xe0) {
    return createSuccess(prefix - 0x100);
  }

  if ((prefix & 0xe0) === 0xa0) {
    const value = decodeUtf8(reader, prefix & 0x1f);
    return value === null
      ? createFailure('Invalid MessagePack string payload.')
      : createSuccess(value);
  }

  if ((prefix & 0xf0) === 0x90) {
    const length = prefix & 0x0f;
    const array: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const item = decodeValue(reader);
      if (!item.ok) {
        return item;
      }

      array.push(item.value);
    }

    return createSuccess(array);
  }

  if ((prefix & 0xf0) === 0x80) {
    const length = prefix & 0x0f;
    const object: Record<string, unknown> = {};
    for (let index = 0; index < length; index += 1) {
      const key = decodeValue(reader);
      if (!key.ok) {
        return key;
      }

      if (typeof key.value !== 'string') {
        return createFailure('MessagePack maps must use string keys.');
      }

      const value = decodeValue(reader);
      if (!value.ok) {
        return value;
      }

      object[key.value] = value.value;
    }

    return createSuccess(object);
  }

  switch (prefix) {
    case 0xc0:
      return createSuccess(null);
    case 0xc2:
      return createSuccess(false);
    case 0xc3:
      return createSuccess(true);
    case 0xc4: {
      const length = reader.readByte();
      if (length === null) {
        return createFailure('Invalid MessagePack bin8 payload.');
      }

      const value = reader.readBytes(length);
      return value ? createSuccess(value) : createFailure('Invalid MessagePack bin8 payload.');
    }
    case 0xc5: {
      const length = reader.readUint16();
      if (length === null) {
        return createFailure('Invalid MessagePack bin16 payload.');
      }

      const value = reader.readBytes(length);
      return value ? createSuccess(value) : createFailure('Invalid MessagePack bin16 payload.');
    }
    case 0xc6: {
      const length = reader.readUint32();
      if (length === null) {
        return createFailure('Invalid MessagePack bin32 payload.');
      }

      const value = reader.readBytes(length);
      return value ? createSuccess(value) : createFailure('Invalid MessagePack bin32 payload.');
    }
    case 0xca:
      return createFailure('MessagePack float32 values are not supported.');
    case 0xcb: {
      const value = reader.readFloat64();
      return value === null
        ? createFailure('Invalid MessagePack float64 payload.')
        : createSuccess(value);
    }
    case 0xcc: {
      const value = reader.readByte();
      return value === null
        ? createFailure('Invalid MessagePack uint8 payload.')
        : createSuccess(value);
    }
    case 0xcd: {
      const value = reader.readUint16();
      return value === null
        ? createFailure('Invalid MessagePack uint16 payload.')
        : createSuccess(value);
    }
    case 0xce: {
      const value = reader.readUint32();
      return value === null
        ? createFailure('Invalid MessagePack uint32 payload.')
        : createSuccess(value);
    }
    case 0xcf: {
      const value = reader.readUint64();
      if (value === null) {
        return createFailure('Invalid MessagePack uint64 payload.');
      }

      return createSuccess(value);
    }
    case 0xd0: {
      const value = reader.readInt8();
      return value === null
        ? createFailure('Invalid MessagePack int8 payload.')
        : createSuccess(value);
    }
    case 0xd1: {
      const value = reader.readInt16();
      return value === null
        ? createFailure('Invalid MessagePack int16 payload.')
        : createSuccess(value);
    }
    case 0xd2: {
      const value = reader.readInt32();
      return value === null
        ? createFailure('Invalid MessagePack int32 payload.')
        : createSuccess(value);
    }
    case 0xd3: {
      const value = reader.readInt64();
      if (value === null) {
        return createFailure('Invalid MessagePack int64 payload.');
      }

      return createSuccess(value);
    }
    case 0xd9: {
      const length = reader.readByte();
      if (length === null) {
        return createFailure('Invalid MessagePack str8 payload.');
      }

      const value = decodeUtf8(reader, length);
      return value === null
        ? createFailure('Invalid MessagePack str8 payload.')
        : createSuccess(value);
    }
    case 0xda: {
      const length = reader.readUint16();
      if (length === null) {
        return createFailure('Invalid MessagePack str16 payload.');
      }

      const value = decodeUtf8(reader, length);
      return value === null
        ? createFailure('Invalid MessagePack str16 payload.')
        : createSuccess(value);
    }
    case 0xdb: {
      const length = reader.readUint32();
      if (length === null) {
        return createFailure('Invalid MessagePack str32 payload.');
      }

      const value = decodeUtf8(reader, length);
      return value === null
        ? createFailure('Invalid MessagePack str32 payload.')
        : createSuccess(value);
    }
    case 0xdc: {
      const length = reader.readUint16();
      if (length === null) {
        return createFailure('Invalid MessagePack array16 payload.');
      }

      const array: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = decodeValue(reader);
        if (!item.ok) {
          return item;
        }

        array.push(item.value);
      }

      return createSuccess(array);
    }
    case 0xdd: {
      const length = reader.readUint32();
      if (length === null) {
        return createFailure('Invalid MessagePack array32 payload.');
      }

      const array: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = decodeValue(reader);
        if (!item.ok) {
          return item;
        }

        array.push(item.value);
      }

      return createSuccess(array);
    }
    case 0xde: {
      const length = reader.readUint16();
      if (length === null) {
        return createFailure('Invalid MessagePack map16 payload.');
      }

      const object: Record<string, unknown> = {};
      for (let index = 0; index < length; index += 1) {
        const key = decodeValue(reader);
        if (!key.ok) {
          return key;
        }

        if (typeof key.value !== 'string') {
          return createFailure('MessagePack maps must use string keys.');
        }

        const value = decodeValue(reader);
        if (!value.ok) {
          return value;
        }

        object[key.value] = value.value;
      }

      return createSuccess(object);
    }
    case 0xdf: {
      const length = reader.readUint32();
      if (length === null) {
        return createFailure('Invalid MessagePack map32 payload.');
      }

      const object: Record<string, unknown> = {};
      for (let index = 0; index < length; index += 1) {
        const key = decodeValue(reader);
        if (!key.ok) {
          return key;
        }

        if (typeof key.value !== 'string') {
          return createFailure('MessagePack maps must use string keys.');
        }

        const value = decodeValue(reader);
        if (!value.ok) {
          return value;
        }

        object[key.value] = value.value;
      }

      return createSuccess(object);
    }
    default:
      return createFailure(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
  }
}

function toUint8Array(payload: Uint8Array | ArrayBuffer): Uint8Array {
  if (payload instanceof Uint8Array) {
    return payload;
  }

  return new Uint8Array(payload);
}

export function decodeMessagePack(
  payload: Uint8Array | ArrayBuffer,
): ProtocolSerializationResult<unknown> {
  const reader = new ByteReader(toUint8Array(payload));
  const decoded = decodeValue(reader);
  if (!decoded.ok) {
    return decoded;
  }

  if (reader.remaining !== 0) {
    return createFailure('Unexpected trailing MessagePack bytes.');
  }

  return decoded;
}
