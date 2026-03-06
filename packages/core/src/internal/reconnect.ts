import type { ReconnectOptions } from '../types';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BACKOFF_MS = 100;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_BACKOFF_MS = 2_000;
const DEFAULT_JITTER_RATIO = 0.2;
const FIRST_RECONNECT_MAX_DELAY_MS = 500;

export interface ResolvedReconnectOptions {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  jitterRatio: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function createAbortError(): Error {
  const error = new Error('Reconnect aborted.');
  error.name = 'AbortError';
  return error;
}

function resolveNonNegativeNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value >= 0 ? value : fallback;
}

function resolvePositiveNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function resolveMultiplier(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value >= 1 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveReconnectOptions(
  reconnect: boolean | ReconnectOptions | undefined,
): ResolvedReconnectOptions | null {
  if (reconnect === undefined || reconnect === false) {
    return null;
  }

  if (reconnect === true) {
    return {
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      backoffMs: DEFAULT_BACKOFF_MS,
      backoffMultiplier: DEFAULT_BACKOFF_MULTIPLIER,
      maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
      jitterRatio: DEFAULT_JITTER_RATIO,
    };
  }

  const maxAttempts = resolveNonNegativeNumber(reconnect.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  if (maxAttempts === 0) {
    return null;
  }

  return {
    maxAttempts,
    backoffMs: resolveNonNegativeNumber(reconnect.backoffMs, DEFAULT_BACKOFF_MS),
    backoffMultiplier: resolveMultiplier(reconnect.backoffMultiplier, DEFAULT_BACKOFF_MULTIPLIER),
    maxBackoffMs: resolvePositiveNumber(reconnect.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS),
    jitterRatio: DEFAULT_JITTER_RATIO,
  };
}

export function computeReconnectDelay(
  attempt: number,
  options: ResolvedReconnectOptions,
  random: () => number,
): number {
  const exponent = Math.max(0, attempt - 1);
  const rawDelay = Math.min(
    options.maxBackoffMs,
    options.backoffMs * options.backoffMultiplier ** exponent,
  );
  const cappedDelay = attempt === 1 ? Math.min(rawDelay, FIRST_RECONNECT_MAX_DELAY_MS) : rawDelay;
  const jitterFactor = 1 - options.jitterRatio + random() * options.jitterRatio * 2;
  const jitteredDelay = cappedDelay * jitterFactor;
  const maxDelay = attempt === 1 ? FIRST_RECONNECT_MAX_DELAY_MS : options.maxBackoffMs;

  return clamp(jitteredDelay, 0, maxDelay);
}

export function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
