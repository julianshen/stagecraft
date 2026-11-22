import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const result = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
  build: { write: false, minify: 'esbuild', lib: { entry: fileURLToPath(new URL('./CanonicalKonvaStage.jsx', import.meta.url)), formats: ['es'], fileName: 'canonical-konva' },
    rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] } } });
const chunks = result[0].output.filter(item => item.type === 'chunk');
const js = chunks.map(item => item.code).join('');
const externals = [...new Set(chunks.flatMap(c => c.imports ?? []))];
const moduleIds = chunks.flatMap(c => c.moduleIds ?? []);
const konvaImports = [...new Set(moduleIds.map(id => id.replace(/\\/g, '/').match(/node_modules\/((?:react-konva|konva)\/[^?]+)/)?.[1]?.replace(/\.js$/, '')).filter(Boolean))];
console.log(JSON.stringify({ entry: 'CanonicalKonvaStage.jsx', externals, konvaImports,
  bytes: Buffer.byteLength(js), gzipBytes: gzipSync(js).length, budgetBytes: 100 * 1024 }));
