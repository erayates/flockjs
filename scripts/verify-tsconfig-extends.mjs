import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages', 'apps'];
const expected = '../../tsconfig.base.json';
const failures = [];

for (const root of roots) {
  const rootStat = (() => {
    try {
      return statSync(root);
    } catch {
      return null;
    }
  })();

  if (!rootStat || !rootStat.isDirectory()) {
    continue;
  }

  for (const entry of readdirSync(root)) {
    const workspacePath = join(root, entry);
    const tsconfigPath = join(workspacePath, 'tsconfig.json');

    try {
      const stat = statSync(workspacePath);
      if (!stat.isDirectory()) continue;

      const json = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
      if (json.extends !== expected) {
        failures.push(
          `${tsconfigPath}: expected extends to be "${expected}", received "${json.extends}"`,
        );
      }
    } catch (error) {
      failures.push(
        `${tsconfigPath}: missing or unreadable (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('tsconfig inheritance validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('All workspace tsconfig files extend ../../tsconfig.base.json');
