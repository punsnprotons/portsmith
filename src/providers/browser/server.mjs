import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { safePath } from '../../platform/files.mjs';

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
export async function startApp(root, config) {
  const server = http.createServer(async (req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || config.page;
      const file = await safePath(root, rel);
      if (!(await fs.stat(file)).isFile()) throw new Error('Not a file');
      res.writeHead(200, {
        'content-type': mime[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  if (!config.server)
    return {
      origin,
      close: () =>
        new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        })
    };
  await new Promise((resolve) => server.close(resolve));
  const args = config.server.args.map((arg) => arg.replaceAll('{port}', String(port)));
  const child = spawn(config.server.command, args, {
    cwd: root,
    shell: false,
    env: { PATH: process.env.PATH ?? '', PORT: String(port), HOST: '127.0.0.1', CI: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let error = null,
    output = '',
    exited = false;
  child.on('error', (e) => {
    error = e.message;
  });
  child.on('exit', () => {
    exited = true;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      if (output.length < 8000) output += String(chunk).slice(0, 8000 - output.length);
    });
  const close = async () => {
    child.kill('SIGKILL');
  }; // The outer process runner kills the full process group too.
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (error || exited) throw new Error(`Browser app did not start: ${error ?? output}`);
      try {
        const response = await fetch(`${origin}/${config.page}`, { signal: AbortSignal.timeout(500) });
        await response.body?.cancel();
        if (response.ok) return { origin, close };
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Browser app readiness timed out. ${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}
