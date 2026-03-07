import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const integrationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(integrationDir, '../../..');
const fixtureDir = path.join(integrationDir, 'fixture');
const coreDistDir = path.join(repoRoot, 'packages/core/dist');
const coreNodeModulesDir = path.join(repoRoot, 'packages/core/node_modules');
const pnpmStoreDir = path.join(repoRoot, 'node_modules/.pnpm');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

function resolveFixturePath(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return path.join(fixtureDir, 'index.html');
  }

  if (pathname === '/app.js') {
    return path.join(fixtureDir, 'app.js');
  }

  return null;
}

function resolveDistPath(pathname) {
  if (!pathname.startsWith('/packages/core/dist/')) {
    return null;
  }

  const relativePath = pathname.slice('/packages/core/dist/'.length);
  const resolvedPath = path.resolve(coreDistDir, relativePath);
  if (!resolvedPath.startsWith(coreDistDir)) {
    return null;
  }

  return resolvedPath;
}

function parsePackageSpecifier(pathname) {
  if (!pathname.startsWith('/@pkg/')) {
    return null;
  }

  const specifier = pathname.slice('/@pkg/'.length);
  if (!specifier) {
    return null;
  }

  return specifier;
}

async function locatePackageRoot(packageName) {
  const directPackageRoot = path.join(coreNodeModulesDir, packageName);
  try {
    await fs.access(directPackageRoot);
    return directPackageRoot;
  } catch {}

  try {
    const pnpmEntries = await fs.readdir(pnpmStoreDir);
    for (const entry of pnpmEntries) {
      const candidate = path.join(pnpmStoreDir, entry, 'node_modules', packageName);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
    }
  } catch {}

  return null;
}

function parsePackageNameAndSubpath(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name, ...rest] = specifier.split('/');
    if (!scope || !name) {
      return null;
    }

    return {
      packageName: `${scope}/${name}`,
      subpath: rest.join('/'),
    };
  }

  const [packageName, ...rest] = specifier.split('/');
  if (!packageName) {
    return null;
  }

  return {
    packageName,
    subpath: rest.join('/'),
  };
}

function selectExportTarget(exportEntry) {
  if (typeof exportEntry === 'string') {
    return exportEntry;
  }

  if (Array.isArray(exportEntry)) {
    for (const candidate of exportEntry) {
      const selectedTarget = selectExportTarget(candidate);
      if (selectedTarget) {
        return selectedTarget;
      }
    }

    return null;
  }

  if (!exportEntry || typeof exportEntry !== 'object') {
    return null;
  }

  for (const candidate of [
    exportEntry.import,
    exportEntry.module,
    exportEntry.browser,
    exportEntry.default,
    exportEntry.require,
  ]) {
    const selectedTarget = selectExportTarget(candidate);
    if (selectedTarget) {
      return selectedTarget;
    }
  }

  return null;
}

async function resolvePackagePathname(pathname) {
  const specifier = parsePackageSpecifier(pathname);
  if (!specifier) {
    return null;
  }

  const parsedSpecifier = parsePackageNameAndSubpath(specifier);
  if (!parsedSpecifier) {
    return null;
  }

  const { packageName, subpath } = parsedSpecifier;
  const packageRoot = await locatePackageRoot(packageName);
  if (!packageRoot) {
    return null;
  }

  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const exportsField = packageJson.exports ?? {};

  const candidateExportKeys = subpath
    ? [`./${subpath}`, `./${subpath}.js`, `./${subpath}.mjs`, `./${subpath}.cjs`]
    : ['.'];

  for (const exportKey of candidateExportKeys) {
    const exportTarget = selectExportTarget(exportsField[exportKey]);
    if (!exportTarget) {
      continue;
    }

    const resolvedPath = path.resolve(packageRoot, exportTarget);
    if (resolvedPath.startsWith(packageRoot)) {
      return resolvedPath;
    }
  }

  const fallbackRelativePath = subpath || packageJson.module || packageJson.main;
  if (typeof fallbackRelativePath !== 'string') {
    return null;
  }

  const fallbackPath = path.resolve(packageRoot, fallbackRelativePath);
  if (!fallbackPath.startsWith(packageRoot)) {
    return null;
  }

  return fallbackPath;
}

async function readFileResponse(filePath) {
  const body = await fs.readFile(filePath);
  const contentType =
    MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';

  return {
    body,
    contentType,
  };
}

async function resolveExistingFilePath(filePath) {
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    const jsFilePath = `${filePath}.js`;
    try {
      await fs.access(jsFilePath);
      return jsFilePath;
    } catch {
      return null;
    }
  }
}

async function ensureCoreBuildExists() {
  const entryPath = path.join(coreDistDir, 'index.js');
  await fs.access(entryPath);
}

try {
  await ensureCoreBuildExists();
} catch {
  process.stderr.write(
    'Missing packages/core/dist/index.js. Run `pnpm --filter @flockjs/core build` before `pnpm test:integration`.\n',
  );
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = request.url ?? '/';
  const pathname = new URL(requestUrl, `http://${host}:${port}`).pathname;

  const requestedPath =
    resolveFixturePath(pathname) ??
    resolveDistPath(pathname) ??
    (await resolvePackagePathname(pathname));
  if (!requestedPath) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const filePath = await resolveExistingFilePath(requestedPath);
    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const { body, contentType } = await readFileResponse(filePath);
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Integration fixture server listening on http://${host}:${port}\n`);
});
