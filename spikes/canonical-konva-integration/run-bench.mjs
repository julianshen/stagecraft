import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(path.join(os.tmpdir(), 'stagecraft-konva-bench-'));

try {
  await build({
    configFile: false,
    logLevel: 'silent',
    root: spikeDir,
    plugins: [react()],
    build: { outDir, emptyOutDir: true, minify: 'oxc' },
  });

  const server = await preview({
    configFile: false,
    root: spikeDir,
    preview: { port: 4199, strictPort: true },
    build: { outDir },
  });

  try {
    const launchOpts = process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {};
    const browser = await chromium.launch(launchOpts);
    try {
      const results = [];
      for (const dpr of [1, 2]) {
        const context = await browser.newContext({
          viewport: { width: 1600, height: 900 },
          deviceScaleFactor: dpr,
        });
        const page = await context.newPage();
        await page.goto(server.resolvedUrls.local[0]);
        await page.waitForFunction(() => typeof window.__runKonvaBench === 'function');
        const res = await page.evaluate(() => window.__runKonvaBench());
        results.push(res);
        await context.close();
      }

      console.log(JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus()[0]?.model,
        cpuCount: os.cpus().length,
        node: process.version,
        results,
      }, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    server.httpServer.close();
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
