import { fileURLToPath } from 'node:url';

import { createRelayServer } from './server';

export { createRelayServer };
export type { RelayAuthorizeContext, RelayServer, RelayServerOptions } from './server';

function isExecutedDirectly(): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }

  return fileURLToPath(import.meta.url) === scriptPath;
}

async function runRelayCli(): Promise<void> {
  const portValue = process.env.PORT ?? '8787';
  const port = Number.parseInt(portValue, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT value "${portValue}".`);
  }

  const host = process.env.HOST;
  const server = createRelayServer(
    host === undefined
      ? {
          port,
        }
      : {
          port,
          host,
        },
  );

  await server.start();
  process.stdout.write(`Relay signaling server listening at ${server.getAddress()}\n`);

  const shutdown = (): void => {
    void server.stop().finally(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isExecutedDirectly()) {
  void runRelayCli();
}
