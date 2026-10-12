import { defineConfig } from 'vitest/config';
import { chromiumBrowser } from '../../vitest.browser.js';

// The K0 perf spike, run on demand in headless Chromium (never in CI):
//   npx vitest run --config spikes/k0/vitest.config.js
//   K0_DPR=2 npx vitest run --config spikes/k0/vitest.config.js   # retina
export default defineConfig({
  optimizeDeps: { entries: ['spikes/k0/*.test.js'] },
  test: {
    include: ['spikes/k0/*.test.js'],
    browser: chromiumBrowser({ deviceScaleFactor: Number(process.env.K0_DPR ?? 1) }),
  },
});
