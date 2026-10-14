import { spawn } from 'node:child_process';

export async function runProcess(command, args, { cwd, timeoutMs = 10000, protocol = false, maxOutputBytes = 128000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Timeout must be 1–120000 ms.');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 32_000_000) throw new Error('Invalid output limit.');
  return new Promise(resolve => {
    const started = Date.now();
    const chunks = { stdout: '', stderr: '', protocol: '' };
    let reason = null, size = 0;
    const child = spawn(command, args, {
      cwd, shell: false, detached: process.platform !== 'win32',
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', NODE_ENV: 'test', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe', ...(protocol ? ['pipe'] : [])]
    });
    const stop = why => {
      reason ??= why;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    for (const [stream, label] of [[child.stdout, 'stdout'], [child.stderr, 'stderr'], [child.stdio[3], 'protocol']]) {
      if (!stream) continue;
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > maxOutputBytes) { stop('output-limit'); return; }
        chunks[label] += chunk;
      });
    }
    child.on('error', error => { reason = error.message; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      // Clean up descendants even when the direct child completed normally.
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      resolve({ command, args, exitCode, signal, reason, durationMs: Date.now() - started, ...chunks });
    });
  });
}
