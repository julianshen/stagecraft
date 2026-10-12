import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Three test projects (docs/CANVAS-EDITOR.md §8):
//  - unit:    the existing jsdom suite — logic, React surfaces, scene builders;
//  - paint:   canvas painter probes (*.paint.test.js) — real Canvas2D pixels;
//  - browser: Konva stage behaviour (*.browser.test.jsx) — hit testing, drag,
//             Transformer, pointer events.
// paint and browser run in headless Chromium through Playwright (Vitest browser
// mode): jsdom has no canvas, and Konva recommends a real browser for Stages.
// spikes/ holds on-demand benchmarks with their own config (spikes/k0/vitest.config.js).
const BROWSER_ONLY = ['**/*.paint.test.*', '**/*.browser.test.*', 'spikes/**'];

const chromium = (name, include) => ({
  plugins: [react()],
  // Pre-bundled up front: a dependency discovered mid-run reloads the page and
  // can re-run or fail tests.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', '@testing-library/react', '@testing-library/jest-dom/vitest', 'konva', 'react-konva', 'fast-xml-parser'] },
  test: {
    name,
    include,
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    browser: { enabled: true, provider: 'playwright', name: 'chromium', headless: true, screenshotFailures: false },
  },
});

export default defineWorkspace([
  { extends: './vitest.config.js', test: { name: 'unit', exclude: ['**/node_modules/**', '**/dist/**', ...BROWSER_ONLY] } },
  chromium('paint', ['src/**/*.paint.test.{js,jsx}']),
  chromium('browser', ['src/**/*.browser.test.{js,jsx}']),
]);
