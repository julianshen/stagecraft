// Vitest browser mode in headless Chromium via Playwright, shared by the
// workspace's `chromium` project and the on-demand spikes (spikes/*/).
// CHROMIUM_PATH points Playwright at a specific Chromium binary — for machines
// whose preinstalled browser isn't the build the lockfile's Playwright expects
// (e.g. CHROMIUM_PATH=/opt/pw-browsers/chromium in Claude Code cloud sessions).
export const chromiumBrowser = ({ deviceScaleFactor = 1 } = {}) => ({
  enabled: true,
  provider: 'playwright',
  name: 'chromium',
  headless: true,
  screenshotFailures: false,
  providerOptions: {
    context: { deviceScaleFactor },
    ...(process.env.CHROMIUM_PATH && { launch: { executablePath: process.env.CHROMIUM_PATH } }),
  },
});
