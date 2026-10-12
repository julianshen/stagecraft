// Vitest browser mode in headless Chromium via Playwright, shared by the
// workspace's `chromium` project and the on-demand spikes (spikes/*/).
export const chromiumBrowser = ({ deviceScaleFactor = 1 } = {}) => ({
  enabled: true,
  provider: 'playwright',
  name: 'chromium',
  headless: true,
  screenshotFailures: false,
  providerOptions: { context: { deviceScaleFactor } },
});
