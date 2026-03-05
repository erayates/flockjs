import { createFlockError } from '../flock-error';

export type WindowEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export const env = {
  get isBrowser(): boolean {
    return typeof window !== 'undefined';
  },
  get hasBroadcastChannel(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  },
  get hasRTCPeerConnection(): boolean {
    return typeof RTCPeerConnection !== 'undefined';
  },
  get hasWebSocket(): boolean {
    return typeof WebSocket !== 'undefined';
  },
  get hasCryptoRandomUUID(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  },
  get hasCryptoGetRandomValues(): boolean {
    return typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  },
};

export function getWindowEventTarget(): WindowEventTarget | null {
  if (!env.isBrowser) {
    return null;
  }

  if (
    typeof window.addEventListener !== 'function' ||
    typeof window.removeEventListener !== 'function'
  ) {
    return null;
  }

  return window;
}

export function createRuntimePeerId(): string {
  if (env.hasCryptoRandomUUID) {
    return crypto.randomUUID();
  }

  if (!env.hasCryptoGetRandomValues) {
    throw createFlockError(
      'NETWORK_ERROR',
      'Secure random peer ID generation is unavailable in this runtime.',
      false,
      {
        source: 'peer-id',
        kind: 'secure-random-unavailable',
      },
    );
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw createFlockError(
      'NETWORK_ERROR',
      'Secure random peer ID generation produced invalid byte output.',
      false,
      {
        source: 'peer-id',
        kind: 'invalid-random-output',
      },
    );
  }

  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;

  const segments = [
    bytesToHex(bytes, 0, 4),
    bytesToHex(bytes, 4, 6),
    bytesToHex(bytes, 6, 8),
    bytesToHex(bytes, 8, 10),
    bytesToHex(bytes, 10, 16),
  ];

  return segments.join('-');
}

function bytesToHex(bytes: Uint8Array, start: number, end: number): string {
  let hex = '';

  for (const byte of bytes.subarray(start, end)) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return hex;
}
