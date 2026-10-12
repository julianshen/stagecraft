// Bundle cost of the canvas engine: build each entry as an ES library (react and
// react-dom external — the app already ships them), report minified + gzip size.
//   node spikes/k0/bundle.mjs
import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const PAINTERS = [
  "export { resolvePreset } from '/src/vendor/officeview/drawing/geometry';",
  "export { paintGeometry } from '/src/vendor/officeview/drawing/paint';",
  "export { layoutTextBody } from '/src/vendor/officeview/drawing/text-layout';",
  "export { paintTextBody, createTextBodyMeasurer } from '/src/vendor/officeview/drawing/text-paint';",
].join('\n');

// [label, entry source, packages also kept out of the bundle]
const RUNS = [
  ['konva + react-konva (Stage, Layer, Shape, Transformer)', "export { Stage, Layer, Shape, Transformer, Rect } from 'react-konva';", []],
  ['konva core + react-konva core (Stage, Layer, Shape, Transformer, Rect)', [
    "import 'konva/lib/shapes/Rect'; import 'konva/lib/shapes/Transformer';",
    "export { Stage, Layer, Shape, Transformer, Rect } from 'react-konva/es/ReactKonvaCore';",
  ].join('\n'), []],
  ['officeview painters (geometry, paint, text layout + paint)', PAINTERS, []],
  ['officeview painters without fast-xml-parser', PAINTERS, ['fast-xml-parser']],
];

const kb = (n) => Math.round(n / 102.4) / 10;
for (const [name, code, alsoExternal] of RUNS) {
  const entry = path.resolve('spikes/k0/.bundle-entry.js'); // inside the project, so packages resolve
  fs.writeFileSync(entry, code);
  const out = await build({
    logLevel: 'silent', configFile: false, root: process.cwd(),
    define: { 'process.env.NODE_ENV': '"production"' }, // as the app build does (library mode leaves it alone)
    build: { write: false, minify: 'esbuild', lib: { entry, formats: ['es'], fileName: 'x' }, rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/, ...alsoExternal] } },
  });
  fs.rmSync(entry);
  const js = out[0].output.filter((o) => o.type === 'chunk').map((o) => o.code).join('');
  console.log(`${name}: ${kb(js.length)} kB min, ${kb(gzipSync(js).length)} kB gzip`);
}
