import { createRelayServer, type RelayServer } from './server';

interface RelayCliStdStream {
  write(chunk: string): void;
}

interface RelayCliProcessLike {
  env: NodeJS.ProcessEnv;
  stdout: RelayCliStdStream;
  stderr: RelayCliStdStream;
  exitCode?: number;
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
}

interface RelayCliRuntime {
  createServer?: (options: { port: number; host?: string }) => RelayServer;
  process?: RelayCliProcessLike;
}

export function resolveRelayCliOptions(
  env: NodeJS.ProcessEnv,
): { port: number; host?: string } | { error: string } {
  const portValue = env.PORT ?? '8787';
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return {
      error: `Invalid PORT value "${portValue}".`,
    };
  }

  const host = env.HOST;
  return host === undefined
    ? {
        port,
      }
    : {
        port,
        host,
      };
}

export async function runRelayCli(runtime: RelayCliRuntime = {}): Promise<number> {
  const processLike = runtime.process ?? process;
  const resolved = resolveRelayCliOptions(processLike.env);
  if ('error' in resolved) {
    processLike.stderr.write(`${resolved.error}\n`);
    return 1;
  }

  const createServer = runtime.createServer ?? createRelayServer;

  try {
    const server = createServer(resolved);
    await server.start();
    processLike.stdout.write(`Relay signaling server listening at ${server.getAddress()}\n`);

    const shutdown = (): void => {
      void server.stop().then(
        () => {
          processLike.exitCode = 0;
        },
        () => {
          processLike.exitCode = 1;
        },
      );
    };

    processLike.on('SIGINT', shutdown);
    processLike.on('SIGTERM', shutdown);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown relay CLI failure.';
    processLike.stderr.write(`${message}\n`);
    return 1;
  }
}
