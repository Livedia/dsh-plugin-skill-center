import { createHash } from 'node:crypto';
import { lstat, readlink, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Deterministic sha256 over a file, symlink, or directory tree (sorted walk). */
export async function hashPath(path) {
  const h = createHash('sha256');
  await walk(path, '', h);
  return `sha256:${h.digest('hex')}`;
}

async function walk(abs, rel, h) {
  const info = await lstat(abs);
  if (info.isSymbolicLink()) {
    h.update(`L ${rel} -> ${await readlink(abs)}\n`);
    return;
  }
  if (info.isFile()) {
    h.update(`F ${rel}\n`);
    h.update(await readFile(abs));
    h.update('\n');
    return;
  }
  if (!info.isDirectory()) return;
  h.update(`D ${rel}\n`);
  for (const entry of (await readdir(abs)).sort()) {
    await walk(join(abs, entry), rel === '' ? entry : `${rel}/${entry}`, h);
  }
}
