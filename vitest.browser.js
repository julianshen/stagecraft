import { playwright } from '@vitest/browser-playwright';

// Vitest browser mode in headless Chromium via Playwright, shared by the
// workspace's `chromium` project and the on-demand spikes (spikes/*/).
// CHROMIUM_PATH points Playwright at a specific Chromium binary — for machines
// whose preinstalled browser isn't the build the lockfile's Playwright expects
// (e.g. CHROMIUM_PATH=/opt/pw-browsers/chromium in Claude Code cloud sessions).
export const chromiumBrowser = ({ deviceScaleFactor = 1 } = {}) => ({
  enabled: true,
  instances: [{ browser: 'chromium' }],
  headless: true,
  screenshotFailures: false,
  provider: playwright({
    contextOptions: { deviceScaleFactor },
    ...(process.env.CHROMIUM_PATH && { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }),
  }),
});
