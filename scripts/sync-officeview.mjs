#!/usr/bin/env node
// Re-vendor officeview's drawing engine into src/vendor/officeview/.
//
//   npm run sync:officeview                          # re-sync the pinned commit
//   npm run sync:officeview -- --ref main            # move the pin to a new ref
//   npm run sync:officeview -- --from ../officeview  # a local repo's HEAD (or --ref)
//
// The manifest (src/vendor/officeview/officeview.json) names the repo, the pinned
// commit, the entry modules and extra files; the entries' import closure is
// copied unmodified, with the same layout under src/, plus the licence files.
// The wanted ref is always fetched into a temp clone — committed content only,
// and a local repo's own checkout is never touched. Every file is staged
// before the vendored trees are replaced, so a failed sync changes nothing.
// vendor.test.js re-derives the closure to check the copy and its packages.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { importClosure } from './vendorClosure.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'src/vendor/officeview');
const MANIFEST = path.join(VENDOR, 'officeview.json');

const { values: opts } = parseArgs({ options: { ref: { type: 'string' }, from: { type: 'string' } } });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const repo = opts.from ? pathToFileURL(path.resolve(opts.from)).href : manifest.repo;
const ref = opts.ref ?? (opts.from ? 'HEAD' : manifest.commit);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'officeview-'));
try {
  const checkout = path.join(temp, 'repo');
  const staging = path.join(temp, 'staging');
  fs.mkdirSync(checkout);
  git(checkout, 'init', '--quiet');
  git(checkout, 'fetch', '--quiet', '--depth', '1', repo, ref);
  git(checkout, 'checkout', '--quiet', 'FETCH_HEAD');
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
  const copies = [...[...files, ...manifest.extraFiles].map((f) => [path.join(src, f), f]), [path.join(checkout, 'LICENSE'), 'LICENSE']];
  for (const [from, to] of copies) {
    fs.mkdirSync(path.dirname(path.join(staging, to)), { recursive: true });
    fs.copyFileSync(from, path.join(staging, to)); // throws (before any change) on a missing source
  }

  // Swap in: every vendored subtree and the licence go, the staged copy comes in.
  // (Stagecraft's own files here — manifest, README, tests — are top-level files.)
  for (const e of fs.readdirSync(VENDOR, { withFileTypes: true })) {
    if (e.isDirectory() || e.name === 'LICENSE') fs.rmSync(path.join(VENDOR, e.name), { recursive: true, force: true });
  }
  fs.cpSync(staging, VENDOR, { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify({ ...manifest, commit }, null, 2)}\n`);
  console.log(`officeview ${commit.slice(0, 7)}: ${copies.length} files → ${path.relative(ROOT, VENDOR)}; packages: ${packages.join(', ') || 'none'}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
