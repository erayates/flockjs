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

  return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
