// Replace part of a directory with a staged tree so that a failure at any
// point leaves the old contents in place.
import fs from 'node:fs';
import path from 'node:path';

const BACKUP = '.swap-backup';

/**
 * Swap `staging`'s contents into `target`: every entry of `target` that
 * `owned(dirent)` claims is replaced; the rest stay. `commit()` runs after the
 * new tree is in (e.g. writing a manifest). The old entries are first moved
 * aside (renames within `target`, so instant); if copying or `commit` throws,
 * the new entries are removed and the old ones moved back before rethrowing.
 * `copy` is injectable for tests.
 */
export function swapIn(target, staging, owned, commit, copy = (from, to) => fs.cpSync(from, to, { recursive: true })) {
  const backup = path.join(target, BACKUP);
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(backup);
  const old = fs.readdirSync(target, { withFileTypes: true }).filter((e) => e.name !== BACKUP && owned(e)).map((e) => e.name);
  const incoming = fs.readdirSync(staging);
  for (const n of old) fs.renameSync(path.join(target, n), path.join(backup, n));
  try {
    copy(staging, target);
    commit();
  } catch (err) {
    for (const n of incoming) fs.rmSync(path.join(target, n), { recursive: true, force: true });
    for (const n of old) fs.renameSync(path.join(backup, n), path.join(target, n));
    fs.rmSync(backup, { recursive: true, force: true });
    throw err;
  }
  fs.rmSync(backup, { recursive: true, force: true });
}
