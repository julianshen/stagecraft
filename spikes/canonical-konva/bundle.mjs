import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
const result = await build({ configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
  build: { write: false, minify: 'esbuild', lib: { entry: fileURLToPath(new URL('./CanonicalKonvaStage.jsx', import.meta.url)), formats: ['es'], fileName: 'canonical-konva' },
    rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] } } });
const js = result[0].output.filter(item => item.type === 'chunk').map(item => item.code).join('');
console.log(JSON.stringify({ entry: 'CanonicalKonvaStage.jsx', reactExternal: true, reactDomExternal: true,
  imports: ['react-konva/lib/ReactKonvaCore', 'konva/lib/shapes/Rect', 'konva/lib/shapes/Ellipse'],
  bytes: Buffer.byteLength(js), gzipBytes: gzipSync(js).length, budgetBytes: 100 * 1024 }));
