import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { chromiumBrowser } from '../../vitest.browser.js';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  optimizeDeps: { include: ['konva/lib/Core', 'react-dom', 'react-dom/client', 'react', '@testing-library/react', 'react-konva/lib/ReactKonvaCore', 'konva/lib/shapes/Rect', 'konva/lib/shapes/Ellipse'], entries: ['*.test.{js,jsx}'] },
  test: {
    include: ['*.test.{js,jsx}'],
    browser: chromiumBrowser({ deviceScaleFactor: Number(process.env.KONVA_DPR ?? 1) }),
  },
});
