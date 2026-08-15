/**
 * The production entry point.
 *
 * In development Vite mounts `handleUarp` on its own dev server. Deployed,
 * there is no Vite: this serves the built page and mounts the same handlers,
 * which is the whole claim the example makes — that the proxy is a plain Node
 * thing you can put anywhere.
 *
 *   node server/serve.ts        # PORT, default 3001
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleUarp } from './handlers.ts';

const root = resolve(fileURLToPath(import.meta.url), '../../dist');
const port = Number(process.env.PORT ?? 3001);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a URL path to a file inside `dist`, or nothing.
 *
 * `normalize` after stripping the leading slash is what stops `../` from
 * walking out of the directory; the check afterwards is the belt to that
 * brace, because a path traversal here would serve the whole filesystem.
 */
function fileFor(pathname: string): string | undefined {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const candidate = join(root, relative);
  if (!candidate.startsWith(root)) return undefined;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

const server = createServer(async (req, res) => {
  if (await handleUarp(req, res)) return;

  const url = new URL(req.url ?? '/', 'http://localhost');
  //  A single-page app: anything that is not a file is the index, so a deep
  //  link to a section still loads.
  const file = fileFor(url.pathname) ?? join(root, 'index.html');

  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not built. Run `npm run build` first.\n');
    return;
  }

  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  //  Hashed assets are immutable; the entry document must never be cached, or
  //  a deploy leaves people on the old bundle.
  const cache = file.includes('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`dev portal on :${port}, serving ${root}`);
});
