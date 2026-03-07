import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const integrationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(integrationDir, '../../..');
const fixtureDir = path.join(integrationDir, 'fixture');
const coreDistDir = path.join(repoRoot, 'packages/core/dist');
const host = '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
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

  const requestedPath = resolveFixturePath(pathname) ?? resolveDistPath(pathname);
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
