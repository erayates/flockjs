import { describe, expect, it, vi } from 'vitest';

import {
  computeReconnectDelay,
  delayWithAbort,
  type ResolvedReconnectOptions,
  resolveReconnectOptions,
} from './reconnect';

function getResolvedOptions(): ResolvedReconnectOptions {
  const options = resolveReconnectOptions(true);
  if (!options) {
    throw new Error('Expected reconnect options.');
  }

  return options;
}

describe('reconnect helpers', () => {
  it('resolves reconnect: true to the default options', () => {
    expect(resolveReconnectOptions(true)).toEqual({
      maxAttempts: 5,
      backoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 2_000,
      jitterRatio: 0.2,
    });
  });

  it('sanitizes invalid reconnect option numbers to defaults', () => {
    expect(
      resolveReconnectOptions({
        maxAttempts: Number.NaN,
        backoffMs: -1,
        backoffMultiplier: 0.5,
        maxBackoffMs: 0,
      }),
    ).toEqual({
      maxAttempts: 5,
      backoffMs: 100,
      backoffMultiplier: 2,
      maxBackoffMs: 2_000,
      jitterRatio: 0.2,
    });
  });

  it('disables automatic reconnect when maxAttempts is zero', () => {
    expect(
      resolveReconnectOptions({
        maxAttempts: 0,
      }),
    ).toBeNull();
  });

  it('keeps the first reconnect delay within 500ms', () => {
    const options = getResolvedOptions();

    expect(computeReconnectDelay(1, options, () => 0)).toBeLessThanOrEqual(500);
    expect(computeReconnectDelay(1, options, () => 1)).toBeLessThanOrEqual(500);
  });

  it('grows delays exponentially and caps them at maxBackoffMs', () => {
    const options = getResolvedOptions();

    const attemptOne = computeReconnectDelay(1, options, () => 0.5);
    const attemptTwo = computeReconnectDelay(2, options, () => 0.5);
    const attemptThree = computeReconnectDelay(3, options, () => 0.5);
    const attemptTen = computeReconnectDelay(10, options, () => 0.5);

    expect(attemptTwo).toBeGreaterThan(attemptOne);
    expect(attemptThree).toBeGreaterThan(attemptTwo);
    expect(attemptTen).toBeLessThanOrEqual(options.maxBackoffMs);
  });

  it('keeps jitter within the expected +/-20% window', () => {
    const options = getResolvedOptions();

    expect(computeReconnectDelay(2, options, () => 0)).toBe(160);
    expect(computeReconnectDelay(2, options, () => 0.5)).toBe(200);
    expect(computeReconnectDelay(2, options, () => 1)).toBeCloseTo(240);
  });

  it('cancels delayWithAbort promptly when aborted', async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const delayPromise = delayWithAbort(1_000, controller.signal);
    const rejection = expect(delayPromise).rejects.toMatchObject({
      name: 'AbortError',
    });

    controller.abort();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    await rejection;
    vi.useRealTimers();
  });
});
