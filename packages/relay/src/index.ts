import { fileURLToPath } from 'node:url';

import { runRelayCli } from './cli';
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

async function runRelayCliEntrypoint(): Promise<void> {
  process.exitCode = await runRelayCli();
}

if (isExecutedDirectly()) {
  void runRelayCliEntrypoint();
}
