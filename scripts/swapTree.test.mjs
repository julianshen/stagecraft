import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { swapIn } from './swapTree.mjs';

// A directory tree from { 'a/b.txt': 'x', … }, and back.
const write = (root, files) => {
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), body);
  }
};
const read = (root) => Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => {
    const p = path.relative(root, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/');
    return [p, fs.readFileSync(path.join(root, p), 'utf8')];
  }));

let tmp;
let target;
let staging;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
  target = path.join(tmp, 'vendor');
  staging = path.join(tmp, 'staging');
  write(target, { 'core/a.ts': 'old a', 'drawing/b.ts': 'old b', 'gone/c.ts': 'old c', LICENSE: 'old lic', 'README.md': 'ours', 'x.test.js': 'ours' });
  write(staging, { 'core/a.ts': 'new a', 'drawing/b.ts': 'new b', LICENSE: 'new lic' });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const owned = (e) => e.isDirectory() || e.name === 'LICENSE';

describe('swapIn', () => {
  it('replaces every owned entry with the staged tree, keeping the rest, and runs commit last', () => {
    let seen;
    swapIn(target, staging, owned, () => { seen = read(target); });
    expect(read(target)).toEqual({ 'core/a.ts': 'new a', 'drawing/b.ts': 'new b', LICENSE: 'new lic', 'README.md': 'ours', 'x.test.js': 'ours' });
    expect(seen['core/a.ts']).toBe('new a'); // commit sees the new tree
    expect(fs.readdirSync(target).filter((n) => n.startsWith('.'))).toEqual([]); // no backup left behind
  });

  it('restores the old tree exactly when copying the new one fails midway', () => {
    const before = read(target);
    const failingCopy = (from, to) => {
      fs.mkdirSync(path.join(to, 'core'), { recursive: true });
      fs.writeFileSync(path.join(to, 'core/a.ts'), 'half');
      throw new Error('ENOSPC');
    };
    expect(() => swapIn(target, staging, owned, () => {}, { copy: failingCopy })).toThrow('ENOSPC');
    expect(read(target)).toEqual(before);
    expect(fs.readdirSync(target).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('restores the old tree when moving the old entries aside fails partway', () => {
    const before = read(target);
    let moves = 0;
    const flakyRename = (from, to) => {
      if (from.startsWith(target) && !from.includes('.swap-backup') && ++moves === 2) throw new Error('EBUSY');
      fs.renameSync(from, to);
    };
    expect(() => swapIn(target, staging, owned, () => {}, { rename: flakyRename })).toThrow('EBUSY');
    expect(read(target)).toEqual(before);
    expect(fs.readdirSync(target).filter((n) => n.startsWith('.'))).toEqual([]);
  });

  it('refuses to start over a leftover backup (an interrupted swap), leaving everything untouched', () => {
    write(target, { '.swap-backup/core/a.ts': 'the only old copy' });
    const before = read(target);
    expect(() => swapIn(target, staging, owned, () => {})).toThrow(/\.swap-backup/);
    expect(read(target)).toEqual(before);
  });

  it('restores the old tree when the commit step fails', () => {
    const before = read(target);
    expect(() => swapIn(target, staging, owned, () => { throw new Error('manifest write failed'); })).toThrow('manifest write failed');
    expect(read(target)).toEqual(before);
  });
});
