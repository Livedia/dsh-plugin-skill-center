import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPath } from '../lib/hashdir.js';

async function makeDir() { return mkdtemp(join(tmpdir(), 'sc-hash-')); }

test('same content different entry order → same hash', async () => {
  const a = await makeDir(); const b = await makeDir();
  for (const dir of [a, b]) {
    await mkdir(join(dir, 'z')); await mkdir(join(dir, 'a'));
    await writeFile(join(dir, 'z', 'f.txt'), 'same');
    await writeFile(join(dir, 'a', 'SKILL.md'), 'same');
  }
  assert.equal(await hashPath(a), await hashPath(b));
});

test('content change → different hash', async () => {
  const a = await makeDir(); const b = await makeDir();
  await writeFile(join(a, 'SKILL.md'), 'v1');
  await writeFile(join(b, 'SKILL.md'), 'v2');
  assert.notEqual(await hashPath(a), await hashPath(b));
});

test('file path and symlink both hashable', async () => {
  const dir = await makeDir();
  await writeFile(join(dir, 'SKILL.md'), 'x');
  const h1 = await hashPath(join(dir, 'SKILL.md'));
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  const link = join(dir, 'link');
  await symlink(join(dir, 'SKILL.md'), link);
  assert.notEqual(await hashPath(link), h1);
});
