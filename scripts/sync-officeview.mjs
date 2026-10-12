#!/usr/bin/env node
// Re-vendor officeview's drawing engine into src/vendor/officeview/.
//
//   node scripts/sync-officeview.mjs              # re-sync the pinned commit
//   node scripts/sync-officeview.mjs --ref main   # move the pin to a new ref
//   node scripts/sync-officeview.mjs --from ../officeview   # use a local checkout
//
// The manifest (src/vendor/officeview/officeview.json) names the repo, the pinned
// commit and the entry modules; everything they import is copied, unmodified,
// with the same layout under src/, plus the licence and notice files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importClosure } from './vendorClosure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'src/vendor/officeview');
const MANIFEST = path.join(VENDOR, 'officeview.json');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let checkout = arg('--from');
if (!checkout) {
  checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'officeview-'));
  git(checkout, 'clone', '--quiet', manifest.repo, '.');
}
const ref = arg('--ref') ?? (arg('--from') ? 'HEAD' : manifest.commit);
git(checkout, 'checkout', '--quiet', ref);
const commit = git(checkout, 'rev-parse', 'HEAD');

const src = path.join(checkout, 'src');
const read = (p) => {
  const f = path.join(src, p);
  return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null;
};
const files = [...importClosure(read, manifest.entries), ...manifest.extraFiles];

// Replace the vendored tree wholesale, so a module officeview dropped goes too.
for (const dir of new Set(files.map((f) => f.split('/')[0]))) fs.rmSync(path.join(VENDOR, dir), { recursive: true, force: true });
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(VENDOR, f)), { recursive: true });
  fs.copyFileSync(path.join(src, f), path.join(VENDOR, f));
}
fs.copyFileSync(path.join(checkout, 'LICENSE'), path.join(VENDOR, 'LICENSE'));
fs.writeFileSync(MANIFEST, `${JSON.stringify({ ...manifest, commit, files }, null, 2)}\n`);
console.log(`officeview ${commit.slice(0, 7)}: ${files.length} files → ${path.relative(ROOT, VENDOR)}`);
