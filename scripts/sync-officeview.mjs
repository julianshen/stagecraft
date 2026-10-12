#!/usr/bin/env node
// Re-vendor officeview's drawing engine into src/vendor/officeview/.
//
//   npm run sync:officeview                        # re-sync the pinned commit
//   npm run sync:officeview -- --ref main          # move the pin to a new ref
//   npm run sync:officeview -- --from ../officeview  # use a local checkout's HEAD
//
// The manifest (src/vendor/officeview/officeview.json) names the repo, the pinned
// commit, the entry modules and extra files; the entries' import closure is
// copied unmodified, with the same layout under src/, plus the licence files.
// vendor.test.js re-derives the closure to check the copy and its packages.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importClosure } from './vendorClosure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'src/vendor/officeview');
const MANIFEST = path.join(VENDOR, 'officeview.json');

const { values: opts } = parseArgs({ options: { ref: { type: 'string' }, from: { type: 'string' } } });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// A local checkout, or a shallow fetch of just the wanted ref into a temp dir.
const temp = opts.from ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'officeview-'));
const checkout = opts.from ?? temp;
try {
  if (temp) {
    git(temp, 'init', '--quiet');
    git(temp, 'fetch', '--quiet', '--depth', '1', manifest.repo, opts.ref ?? manifest.commit);
    git(temp, 'checkout', '--quiet', 'FETCH_HEAD');
  } else if (opts.ref) {
    git(checkout, 'checkout', '--quiet', opts.ref);
  }
  const commit = git(checkout, 'rev-parse', 'HEAD');

  const src = path.join(checkout, 'src');
  const read = (p) => {
    try {
      return fs.readFileSync(path.join(src, p), 'utf8');
    } catch {
      return null; // missing (or a directory): not this candidate
    }
  };
  const { files, packages } = importClosure(read, manifest.entries);
  const copied = [...files, ...manifest.extraFiles];

  // Replace the vendored trees wholesale, so a module officeview dropped goes too.
  for (const dir of new Set(copied.map((f) => f.split('/')[0]))) fs.rmSync(path.join(VENDOR, dir), { recursive: true, force: true });
  for (const f of copied) {
    fs.mkdirSync(path.dirname(path.join(VENDOR, f)), { recursive: true });
    fs.copyFileSync(path.join(src, f), path.join(VENDOR, f));
  }
  fs.copyFileSync(path.join(checkout, 'LICENSE'), path.join(VENDOR, 'LICENSE'));
  fs.writeFileSync(MANIFEST, `${JSON.stringify({ ...manifest, commit }, null, 2)}\n`);
  console.log(`officeview ${commit.slice(0, 7)}: ${copied.length} files → ${path.relative(ROOT, VENDOR)}; packages: ${packages.join(', ') || 'none'}`);
} finally {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
}
