import { defineWorkspace } from 'vitest/config';
import { chromiumBrowser } from './vitest.browser.js';
import base from './vitest.config.js';

// Two test projects (docs/CANVAS-EDITOR.md §8):
//  - unit:     the jsdom suite — logic, React surfaces, scene builders;
//  - chromium: real-canvas tests in headless Chromium (Vitest browser mode):
//              *.paint.test.js painter pixel probes and *.browser.test.jsx Konva
//              stage behaviour — jsdom has no canvas, and Konva recommends a
//              real browser for Stages.
const CHROMIUM_TESTS = ['src/**/*.paint.test.{js,jsx}', 'src/**/*.browser.test.{js,jsx}'];

export default defineWorkspace([
  // `extends` concatenates arrays: this exclude adds to the base one.
  { extends: './vitest.config.js', test: { name: 'unit', exclude: CHROMIUM_TESTS } },
  {
    // Not `extends`: that concatenates arrays, so the base `include` would join
    // this one. Take the base's plugins and setup instead.
    plugins: base.plugins,
    // Let Vite's dependency scan start from the tests themselves, so every
    // package they reach is pre-bundled up front (one found mid-run reloads
    // the page and can re-run or fail tests).
    optimizeDeps: { entries: CHROMIUM_TESTS },
    test: { name: 'chromium', include: CHROMIUM_TESTS, globals: base.test.globals, setupFiles: base.test.setupFiles, browser: chromiumBrowser() },
  },
]);
