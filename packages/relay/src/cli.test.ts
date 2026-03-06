import { describe, expect, it, vi } from 'vitest';

import { resolveRelayCliOptions, runRelayCli } from './cli';
import type { RelayServer } from './server';

interface FakeProcess {
  env: NodeJS.ProcessEnv;
  stdout: {
    write: ReturnType<typeof vi.fn<(chunk: string) => void>>;
  };
  stderr: {
    write: ReturnType<typeof vi.fn<(chunk: string) => void>>;
  };
  exitCode?: number;
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
}

function createFakeProcess(env: NodeJS.ProcessEnv): {
  processLike: FakeProcess;
  signalHandlers: Map<'SIGINT' | 'SIGTERM', () => void>;
} {
  const signalHandlers = new Map<'SIGINT' | 'SIGTERM', () => void>();
  const processLike: FakeProcess = {
    env,
    stdout: {
      write: vi.fn<(chunk: string) => void>(),
    },
    stderr: {
      write: vi.fn<(chunk: string) => void>(),
    },
    on(signal, listener) {
      signalHandlers.set(signal, listener);
    },
  };

  return {
    processLike,
    signalHandlers,
  };
}

describe('relay cli', () => {
  it('returns an error result for invalid ports', () => {
    expect(
      resolveRelayCliOptions({
        PORT: 'invalid',
      }),
    ).toEqual({
      error: 'Invalid PORT value "invalid".',
    });
  });

  it('resolves valid port and host values', () => {
    expect(
      resolveRelayCliOptions({
        PORT: '8788',
        HOST: '0.0.0.0',
      }),
    ).toEqual({
      port: 8788,
      host: '0.0.0.0',
    });

    expect(resolveRelayCliOptions({})).toEqual({
      port: 8787,
    });
  });

  it('writes cli validation failures to stderr and returns a non-zero exit code', async () => {
    const { processLike } = createFakeProcess({
      PORT: 'not-a-number',
    });

    await expect(
      runRelayCli({
        process: processLike,
      }),
    ).resolves.toBe(1);
    expect(processLike.stderr.write).toHaveBeenCalledWith('Invalid PORT value "not-a-number".\n');
  });

  it('starts the relay and stops it on shutdown without calling process.exit', async () => {
    const start = vi.fn(async (): Promise<void> => {
      return undefined;
    });
    const stop = vi.fn(async (): Promise<void> => {
      return undefined;
    });
    const createServer = vi.fn(
      (): RelayServer => ({
        port: 8788,
        start,
        stop,
        getAddress() {
          return 'ws://relay.local:8788';
        },
      }),
    );

    const { processLike, signalHandlers } = createFakeProcess({
      PORT: '8788',
      HOST: '127.0.0.1',
    });

    await expect(
      runRelayCli({
        createServer,
        process: processLike,
      }),
    ).resolves.toBe(0);

    expect(createServer).toHaveBeenCalledWith({
      port: 8788,
      host: '127.0.0.1',
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(processLike.stdout.write).toHaveBeenCalledWith(
      'Relay signaling server listening at ws://relay.local:8788\n',
    );
    expect(signalHandlers.has('SIGINT')).toBe(true);
    expect(signalHandlers.has('SIGTERM')).toBe(true);

    signalHandlers.get('SIGINT')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(processLike.exitCode).toBe(0);
  });
});
