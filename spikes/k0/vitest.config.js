import { defineConfig } from 'vitest/config';

// The K0 perf spike, run on demand in headless Chromium (never in CI):
//   npx vitest run --config spikes/k0/vitest.config.js
//   K0_DPR=2 npx vitest run --config spikes/k0/vitest.config.js   # retina
export default defineConfig({
  optimizeDeps: { include: ['konva', 'fast-xml-parser'] },
  test: {
    include: ['spikes/k0/*.test.js'],
    browser: {
      enabled: true, provider: 'playwright', name: 'chromium', headless: true, screenshotFailures: false,
      providerOptions: { context: { deviceScaleFactor: Number(process.env.K0_DPR ?? 1) } },
    },
  },
});
