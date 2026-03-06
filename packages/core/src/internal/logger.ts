import type { TransportKind } from '../transports/transport';
import type { DebugOptions, FlockError } from '../types';

interface ConsoleLike {
  debug(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

function isDebugChannelEnabled(
  debug: boolean | DebugOptions | undefined,
  channel: keyof DebugOptions,
): boolean {
  if (debug === true) {
    return true;
  }

  if (!debug || typeof debug !== 'object') {
    return false;
  }

  return debug[channel] === true;
}

function getConsoleLike(): ConsoleLike | null {
  const consoleLike: ConsoleLike = globalThis.console;
  if (typeof consoleLike.debug !== 'function' || typeof consoleLike.warn !== 'function') {
    return null;
  }

  return consoleLike;
}

export function logTransportSelection(
  debug: boolean | DebugOptions | undefined,
  selection: {
    requestedMode: string;
    selectedTransport: TransportKind;
    reason: string;
  },
): void {
  if (!isDebugChannelEnabled(debug, 'transport')) {
    return;
  }

  const consoleLike = getConsoleLike();
  if (!consoleLike) {
    return;
  }

  consoleLike.debug('[flockjs][transport] selection', selection);
}

export function logProtocolWarning(details: {
  transport: string;
  reason: string;
  payload?: unknown;
}): void {
  const consoleLike = getConsoleLike();
  if (!consoleLike) {
    return;
  }

  consoleLike.warn('[flockjs][protocol] rejected message', details);
}

export function logProtocolNegotiation(
  debug: boolean | DebugOptions | undefined,
  details: {
    transport: TransportKind;
    peerId: string;
    reason: string;
    session?: {
      version: number;
      codec: string;
      legacy: boolean;
    };
  },
): void {
  if (!isDebugChannelEnabled(debug, 'transport')) {
    return;
  }

  const consoleLike = getConsoleLike();
  if (!consoleLike) {
    return;
  }

  consoleLike.debug('[flockjs][transport] protocol', details);
}

export function logRoomError(
  debug: boolean | DebugOptions | undefined,
  error: Pick<FlockError, 'code' | 'message' | 'recoverable' | 'cause'>,
): void {
  if (!isDebugChannelEnabled(debug, 'transport')) {
    return;
  }

  const consoleLike = getConsoleLike();
  if (!consoleLike) {
    return;
  }

  consoleLike.debug('[flockjs][room] error', {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    cause: error.cause,
  });
}
