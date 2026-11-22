import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
