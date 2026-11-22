import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSpecifiers } from './vendorClosure.mjs';

const allowed = { core: [], renderer: ['core'], react: ['core', 'renderer', 'source'], pptx: ['core', 'io'], io: [], source: ['core', 'io'], odp: ['core', 'io'], server: ['core'], playground: ['core', 'react', 'pptx', 'source', 'odp'] };
const errors = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
for (const [name, dependencies] of Object.entries(allowed)) {
  const root = path.resolve(name === 'playground' ? 'apps' : 'packages', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.peerDependencies };
  for (const file of walk(path.join(root, 'src'))) {
    if (!/\.(?:js|jsx|ts)$/.test(file) || /\.test\./.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(file), specifier);
        if (!target.startsWith(root + path.sep)) errors.push(`${file}: relative import escapes package: ${specifier}`);
      } else {
        const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!declared[dependency]) errors.push(`${file}: undeclared dependency ${dependency}`);
        if (dependency.startsWith('@stagecraft/')) {
          try {
            if (!fs.existsSync(fileURLToPath(import.meta.resolve(specifier)))) throw new Error('missing file');
          } catch { errors.push(`${file}: unresolved workspace export ${specifier}`); }
        }
        if (dependency.startsWith('@stagecraft/') && !dependencies.includes(dependency.slice('@stagecraft/'.length))) {
          errors.push(`${file}: forbidden dependency ${dependency}`);
        }
      }
    }
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Package boundaries and runtime dependencies verified.');
