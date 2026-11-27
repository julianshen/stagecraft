import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [manifestArg, fixtureRootArg, outputArg] = process.argv.slice(2);
if (!manifestArg || !fixtureRootArg) {
  console.error('Usage: node scripts/konva-3b-histogram.mjs <k2a-manifest.json> <fixture-root> [output.json]');
  process.exit(2);
}
const manifestPath = path.resolve(manifestArg);
const fixtureRoot = path.resolve(fixtureRootArg);
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (!Array.isArray(manifest.rows) || manifest.rows.length !== 65) throw new Error('Expected the original 65-package K2a manifest.');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ configFile: path.join(root, 'vite.config.js'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(server.resolvedUrls.local[0]);
const modules = {
  source: `/@fs${path.join(root, 'packages/source/src/index.js')}`,
  renderer: `/@fs${path.join(root, 'packages/renderer/src/canonical/index.js')}`,
  rendererScene: `/@fs${path.join(root, 'packages/renderer/src/canonical/scene.js')}`,
  core: `/@fs${path.join(root, 'packages/core/src/lib/nativeAppearance.js')}`,
  jszip: '/node_modules/.vite/deps/jszip.js',
};
const analyze = async (base64, format) => page.evaluate(async ({ base64, format, modules }) => {
  const binary = atob(base64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const [{ openPresentation }, { buildCanonicalScene }, rendererScene, native, zipModule] = await Promise.all([
    import(modules.source), import(modules.renderer), import(modules.rendererScene), import(modules.core), import(modules.jszip),
  ]);
  const source = await openPresentation(bytes, { format });
  try {
    const document = source.document;
    const proofCounts = (slide, context) => {
      const result = {}, { theme, colorMap } = context;
      for (const object of slide.objects ?? []) {
        if (object.source?.format !== 'pptx') continue;
        const type = object.type ?? 'unknown'; result[type] ??= { complete: 0, missing: 0, stale: 0, invalid: 0 };
        const proof = object.extensions?.stagecraftNativeAppearance;
        if (!proof) { result[type].missing++; continue; }
        let expected;
        try { expected = native.nativeObjectAppearanceInput(object, { theme, colorMap, document, slide }); }
        catch { result[type].invalid++; continue; }
        if (proof.input !== expected) { result[type].stale++; continue; }
        try {
          if (native.isNativeObjectAppearanceValid(object, { theme, colorMap, document, slide })) result[type].complete++;
          else result[type].invalid++;
        } catch { result[type].invalid++; }
      }
      return result;
    };
    const proofState = (entity, key, validate) => {
      const present = Boolean(entity?.extensions?.[key]);
      if (!present) return { present, valid: false };
      try { return { present, valid: Boolean(validate()) }; }
      catch { return { present, valid: false }; }
    };
    const slides = document.slides.map(slide => {
      const context = native.nativeAppearanceContext(document, slide);
      const rendererContext = rendererScene.rendererNativeAppearanceContext(document, slide);
      const contextMatches = JSON.stringify(rendererContext) === JSON.stringify(context);
      const scene = buildCanonicalScene(document, slide.id);
      const layout = document.layouts?.find(item => item.id === slide.layoutId);
      const master = document.masters?.find(item => item.id === (slide.masterId ?? layout?.masterId));
      const artworkCount = (layout?.objects?.length ?? 0) + (master?.objects?.length ?? 0);
      return {
        id: slide.id, status: scene.status, ...(scene.reason ? { reason: scene.reason } : {}), diagnostics: scene.diagnostics ?? [],
        nativeContextMatchesSource: contextMatches,
        slideProof: proofState(slide, 'stagecraftSlideAppearance', () => native.isNativeSlideAppearanceValid(slide, document)),
        layoutSummary: proofState(layout, 'stagecraftLayoutSummary', () => native.isNativeLayoutAppearanceValid(layout, document)),
        masterSummary: proofState(master, 'stagecraftLayoutSummary', () => native.isNativeLayoutAppearanceValid(master, document)),
        artworkCount,
        slideBackground: slide.extensions?.stagecraftSlideAppearance?.background ?? null,
        objectProofs: proofCounts(slide, context),
      };
    });
    const sourceEntities = {
      layouts: (document.layouts ?? []).filter(item => item.source?.format === 'pptx').map(item => ({ id: item.id, ...proofState(item, 'stagecraftLayoutSummary', () => native.isNativeLayoutAppearanceValid(item, document)) })),
      masters: (document.masters ?? []).filter(item => item.source?.format === 'pptx').map(item => ({ id: item.id, ...proofState(item, 'stagecraftLayoutSummary', () => native.isNativeLayoutAppearanceValid(item, document)) })),
    };
    const objectTypes = document.slides.flatMap(slide => slide.objects ?? []).reduce((all, object) => { all[object.type] = (all[object.type] ?? 0) + 1; return all; }, {});
    const nativeFields = {};
    if (format === 'pptx') {
      const zip = await zipModule.default.loadAsync(bytes);
      const fields = [['background','p','bg'],['group','p','grpSp'],['solid-fill','a','solidFill'],['gradient-fill','a','gradFill'],['image-fill','a','blipFill'],['outline','a','ln'],['effects','a','effectLst'],['theme-font-reference','a','fontRef'],['text-list-style','a','lstStyle'],['placeholder','p','ph'],['custom-geometry','a','custGeom']];
      for (const name of Object.keys(zip.files).filter(item => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(item))) {
        const xml = new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml');
        for (const [label,prefix,local] of fields) {
          const ns = prefix === 'p' ? 'http://schemas.openxmlformats.org/presentationml/2006/main' : 'http://schemas.openxmlformats.org/drawingml/2006/main';
          const nodes = [...xml.getElementsByTagNameNS(ns, local)];
          const count = ['effects','text-list-style'].includes(label) ? nodes.filter(node => node.children.length || node.attributes.length).length : nodes.length;
          if (count) nativeFields[label] = (nativeFields[label] ?? 0) + count;
        }
      }
    }
    return { slides, objectTypes, nativeFields, sourceEntities };
  } finally { source.dispose(); }
}, { base64, format, modules });
const rows = [];
const verified = new Set();
for (const item of manifest.rows) {
  const file = path.resolve(fixtureRoot, item.file);
  const bytes = await fs.readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== item.sha256) throw new Error(`Fixture hash changed: ${item.file}`);
  verified.add(sha256);
  const format = item.format;
  const result = await analyze(bytes.toString('base64'), format);
  rows.push({ file: item.file, sha256, format, ...result });
}
if (verified.size !== 65) throw new Error(`Expected 65 unique package hashes, got ${verified.size}.`);
const summary = {
  slides: { pptx: { total: 0, ready: 0, refusedByReason: {}, diagnostics: {} }, odp: { total: 0, ready: 0, refusedByReason: {}, diagnostics: {} } },
  readyPptxPackages: new Set(), objectProofs: {}, nativeFieldOccurrences: {}, projectedObjectTypes: {},
  sourceProofs: { pptx: { slides: { total: 0, present: 0, valid: 0 }, layouts: { total: 0, present: 0, valid: 0 }, masters: { total: 0, present: 0, valid: 0 } } },
  nativeContextParity: { totalPptxSlides: 0, mismatches: [] },
};
const entitySeen = { layouts: new Set(), masters: new Set() };
for (const row of rows) {
  for (const [type, count] of Object.entries(row.objectTypes)) summary.projectedObjectTypes[type] = (summary.projectedObjectTypes[type] ?? 0) + count;
  for (const [field, count] of Object.entries(row.nativeFields)) summary.nativeFieldOccurrences[field] = (summary.nativeFieldOccurrences[field] ?? 0) + count;
  if (row.format === 'pptx') {
    const proofSummary = summary.sourceProofs.pptx;
    for (const slide of row.slides) {
      summary.nativeContextParity.totalPptxSlides++;
      if (!slide.nativeContextMatchesSource) summary.nativeContextParity.mismatches.push({ file: row.file, sha256: row.sha256, slideId: slide.id });
      proofSummary.slides.total++;
      if (slide.slideProof.present) proofSummary.slides.present++;
      if (slide.slideProof.valid) proofSummary.slides.valid++;
    }
    for (const kind of ['layouts', 'masters']) for (const entity of row.sourceEntities[kind]) {
      const key = `${row.sha256}:${entity.id}`;
      if (entitySeen[kind].has(key)) continue;
      entitySeen[kind].add(key);
      const item = proofSummary[kind]; item.total++;
      if (entity.present) item.present++;
      if (entity.valid) item.valid++;
    }
  }
  const format = summary.slides[row.format];
  for (const slide of row.slides) {
    format.total++;
    if (slide.status === 'ready') {
      format.ready++;
      if (row.format === 'pptx') summary.readyPptxPackages.add(row.sha256);
    } else format.refusedByReason[slide.reason] = (format.refusedByReason[slide.reason] ?? 0) + 1;
    for (const diagnostic of slide.diagnostics) format.diagnostics[diagnostic.code] = (format.diagnostics[diagnostic.code] ?? 0) + 1;
    for (const [type, counts] of Object.entries(slide.objectProofs)) {
      summary.objectProofs[type] ??= { complete: 0, missing: 0, stale: 0, invalid: 0 };
      for (const key of Object.keys(counts)) summary.objectProofs[type][key] += counts[key];
    }
  }
}
if (summary.nativeContextParity.mismatches.length) throw new Error(`Renderer/source native context mismatch: ${JSON.stringify(summary.nativeContextParity.mismatches.slice(0, 10))}`);
summary.readyPptxPackages = summary.readyPptxPackages.size;
const output = { manifest: path.basename(manifestPath), fixturePackages: rows.length, verifiedUniqueHashes: verified.size, ...summary, rows };
if (outputArg) await fs.writeFile(path.resolve(outputArg), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
await browser.close();
await server.close();
