import type { TransportKind } from '../transports/transport';
import type { DebugOptions } from '../types';

interface ConsoleLike {
  debug(message?: unknown, ...optionalParams: unknown[]): void;
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
  if (typeof consoleLike.debug !== 'function') {
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
