import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const konvaBudgetBytes = 100 * 1024;
const painterGrowthBudgetBytes = 85 * 1024;

function chunkInventory(chunks) {
  return chunks.map(c => {
    const mods = (c.moduleIds ?? []).map(m => m.replace(/\\/g, '/'));
    const konvaNodeMods = mods.filter(m => /node_modules\/(?:react-konva|konva)\//.test(m));
    const konvaSrcMods = mods.filter(m => /\/packages\/react\/src\/konva\//.test(m));
    return {
      fileName: c.fileName,
      isEntry: Boolean(c.isEntry),
      bytes: Buffer.byteLength(c.code),
      gzipBytes: gzipSync(c.code).length,
      konvaNodeMods: konvaNodeMods.length,
      konvaSrcMods: konvaSrcMods.length,
      konvaNodePaths: konvaNodeMods.map(m => m.match(/node_modules\/(.+)$/)?.[1] ?? m),
    };
  });
}

// 1. Measure standalone KonvaSurfaceShell (externals: react, react-dom, @stagecraft/*)
const konvaShellBuild = await build({
  configFile: false,
  logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false,
    minify: 'oxc',
    lib: {
      entry: path.join(repoRoot, 'packages/react/src/konva/KonvaSurfaceShell.jsx'),
      formats: ['es'],
      fileName: 'konva-surface-shell',
    },
    rolldownOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@stagecraft\/renderer/, /^@stagecraft\/core/],
    },
  },
});
const konvaShellChunks = konvaShellBuild[0].output.filter(c => c.type === 'chunk');
const konvaShellCode = konvaShellChunks.map(c => c.code).join('');
const konvaShellGzip = gzipSync(konvaShellCode).length;
if (konvaShellGzip > konvaBudgetBytes) {
  throw new Error(`Lazy Konva chunk exceeded 100 kB gzip: ${konvaShellGzip}`);
}

// 2. Measure painter main-chunk growth in tests/consumer
const consumerReal = await build({
  configFile: false,
  logLevel: 'silent',
  root: path.join(repoRoot, 'tests/consumer'),
  plugins: [react()],
  build: { write: false },
});
const consumerStub = await build({
  configFile: false,
  logLevel: 'silent',
  root: path.join(repoRoot, 'tests/consumer'),
  plugins: [
    {
      name: 'stub-canonical',
      enforce: 'pre',
      resolveId(id) {
        if (id === '@stagecraft/renderer/canonical') return '\0stub-canonical';
      },
      load(id) {
        if (id === '\0stub-canonical') {
          return 'export const buildCanonicalScene = () => null; export const waitForCanonicalFonts = async () => ({}); export const createCanonicalPaintEnvironment = () => ({}); export const paintCanonicalNode = () => {};';
        }
      },
    },
    react(),
  ],
  build: { write: false },
});
const realChunks = chunkInventory(consumerReal.output.filter(c => c.type === 'chunk'));
const realEntry = realChunks.find(c => c.isEntry);
const stubEntry = consumerStub.output.find(c => c.type === 'chunk' && c.isEntry);
const painterGrowthBytes = realEntry.gzipBytes - gzipSync(stubEntry.code).length;
if (painterGrowthBytes > painterGrowthBudgetBytes) {
  throw new Error(`Painter main-chunk growth exceeded 85 kB gzip: ${painterGrowthBytes}`);
}

// 3. Isolated clone (no parent node_modules) for default-SVG and opt-in @stagecraft/react/konva consumers
const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'stagecraft-k2c-isolated-'));
const cloneDir = path.join(tmpBase, 'repo');
try {
  execFileSync('git', ['clone', '--quiet', '--shared', repoRoot, cloneDir], { stdio: 'inherit' });
  // Ensure uncommitted worktree files are not required; clone uses committed HEAD,
  // or if running pre-commit, npm ci installs from lockfile cleanly without parent node_modules.
  execFileSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 3a. Default-SVG consumer (no Konva anywhere in built graph)
  const defaultAppDir = path.join(cloneDir, 'tests/consumer-default-svg');
  mkdirSync(defaultAppDir, { recursive: true });
  writeFileSync(path.join(defaultAppDir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
  writeFileSync(path.join(defaultAppDir, 'main.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StagecraftEditor, DeckList, NotesPanel } from '@stagecraft/react';
import { EditorProvider } from '@stagecraft/react/editor';
import { CanonicalEditorSurface } from '@stagecraft/react/canonical';
import { SAMPLE_DECK, createDocument, createEditor, documentPlugin, presentationPlugin } from '@stagecraft/core';
import '@stagecraft/react/styles.css';

const editor = createEditor({ document: createDocument(), plugins: [documentPlugin, presentationPlugin] });
createRoot(document.getElementById('root')).render(
  <EditorProvider editor={editor}>
    <DeckList items={[{ id: '1', title: 'Demo' }]} onSelect={() => {}} />
    <CanonicalEditorSurface />
    <StagecraftEditor defaultDeck={SAMPLE_DECK} style={{ height: 720 }} />
  </EditorProvider>
);
`);
  const defaultBuilt = await build({
    configFile: false,
    logLevel: 'silent',
    root: defaultAppDir,
    plugins: [react()],
    build: { write: false },
  });
  const defaultChunks = chunkInventory(defaultBuilt.output.filter(c => c.type === 'chunk'));
  const defaultKonvaLeak = defaultChunks.some(c => c.konvaNodeMods > 0 || c.konvaSrcMods > 0);
  if (defaultKonvaLeak) {
    throw new Error(`Default-SVG consumer graph contained konva modules: ${JSON.stringify(defaultChunks)}`);
  }

  // 3b. Opt-in @stagecraft/react/konva consumer in isolated clone
  const optInAppDir = path.join(cloneDir, 'tests/consumer-optin-konva');
  mkdirSync(optInAppDir, { recursive: true });
  writeFileSync(path.join(optInAppDir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
  writeFileSync(path.join(optInAppDir, 'main.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createDocument, createEditor, documentPlugin, presentationPlugin } from '@stagecraft/core';
import { EditorProvider } from '@stagecraft/react/editor';
import { PresentationEditorProvider } from '@stagecraft/react/presentation';
import { KonvaPresentationCanvas } from '@stagecraft/react/konva';
import '@stagecraft/react/styles.css';

const editor = createEditor({ document: createDocument(), plugins: [documentPlugin, presentationPlugin] });
createRoot(document.getElementById('root')).render(
  <EditorProvider editor={editor}>
    <PresentationEditorProvider>
      <KonvaPresentationCanvas onSurfaceChange={() => {}} />
    </PresentationEditorProvider>
  </EditorProvider>
);
`);
  const optInBuilt = await build({
    configFile: false,
    logLevel: 'silent',
    root: optInAppDir,
    plugins: [react()],
    build: { write: false },
  });
  const optInChunks = chunkInventory(optInBuilt.output.filter(c => c.type === 'chunk'));
  const optInEntry = optInChunks.find(c => c.isEntry);
  const optInLazyKonva = optInChunks.find(c => !c.isEntry && c.konvaNodeMods > 0);
  if (!optInEntry || optInEntry.konvaNodeMods > 0) {
    throw new Error(`Opt-in entry chunk eagerly bundled konva: ${JSON.stringify(optInEntry)}`);
  }
  if (!optInLazyKonva || optInLazyKonva.gzipBytes > konvaBudgetBytes) {
    throw new Error(`Opt-in lazy Konva chunk missing or over budget: ${JSON.stringify(optInLazyKonva)}`);
  }

  console.log(JSON.stringify({
    konvaShellStandalone: { bytes: Buffer.byteLength(konvaShellCode), gzipBytes: konvaShellGzip, budgetBytes: konvaBudgetBytes },
    consumerRealChunks: realChunks,
    painterMainChunkGrowth: {
      withCanonicalGzip: realEntry.gzipBytes,
      withoutCanonicalGzip: gzipSync(stubEntry.code).length,
      growthGzipBytes: painterGrowthBytes,
      budgetBytes: painterGrowthBudgetBytes,
    },
    isolatedDefaultSvgConsumer: { chunks: defaultChunks },
    isolatedOptInKonvaConsumer: { chunks: optInChunks },
  }, null, 2));
} finally {
  rmSync(tmpBase, { recursive: true, force: true });
}
