import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const outDir = await mkdtemp(path.join(os.tmpdir(), 'stagecraft-consumer-'));
try {
  await build({
    configFile: false,
    root: path.resolve('tests/consumer'),
    plugins: [react()],
    build: { outDir, emptyOutDir: true },
  });
  console.log('Standalone React consumer built successfully.');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

// Plain Node consumer check: @stagecraft/server must resolve through its workspace
// exports outside any bundler and expose its public surface at runtime.
const serverProbe = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const server = await import('@stagecraft/server');
  for (const name of ['createProtectedSession', 'createSessionRequestHandler', 'createRemoteSession']) {
    if (typeof server[name] !== 'function') throw new Error('missing export: ' + name);
  }
  if (typeof server.SessionError !== 'function') throw new Error('missing export: SessionError');
  const error = new server.SessionError('OPERATION_FAILED', 1, true, 'committed');
  if (error.code !== 'OPERATION_FAILED' || error.committed !== true || error.outcome !== 'committed') {
    throw new Error('unexpected SessionError shape');
  }
`], { stdio: 'inherit' });
if (serverProbe.status !== 0) {
  console.error('Plain Node import of @stagecraft/server failed.');
  process.exitCode = 1;
} else {
  console.log('Plain Node import of @stagecraft/server verified.');
}
