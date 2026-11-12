import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRoot, groupFindings } from '../lib/scan.js';

async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'sc-scan-'));
  return dir;
}

test('finds dir skills and flat md skills, skips non-skills', async () => {
  const root = await makeRoot();
  await mkdir(join(root, 'alpha'));
  await writeFile(join(root, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nbody');
  await writeFile(join(root, 'beta.md'), '---\nname: beta\ndescription: B\n---\nbody');
  await mkdir(join(root, 'no-skill'));
  await writeFile(join(root, 'README.md'), 'no frontmatter');
  const { found } = await scanRoot(root, 'dsh');
  assert.equal(found.length, 2);
  const alpha = found.find((f) => f.name === 'alpha');
  assert.equal(alpha.kind, 'dir');
  assert.equal(alpha.frontmatter.description, 'A');
  assert.equal(found.find((f) => f.name === 'beta').kind, 'flat');
  assert.ok(alpha.hash.startsWith('sha256:'));
});

test('scanRoot on missing root reports skipped root', async () => {
  const missing = join(await makeRoot(), 'gone');
  const { found, skipped } = await scanRoot(missing, 'x');
  assert.deepEqual(found, []);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].name, missing);
  assert.match(skipped[0].reason, /unreadable root/);
});

test('groupFindings flags duplicates and conflicts', () => {
  const findings = [
    { name: 'a', agentId: 'dsh', hash: 'h1' },
    { name: 'a', agentId: 'codex', hash: 'h1' },
    { name: 'b', agentId: 'dsh', hash: 'h2' },
    { name: 'b', agentId: 'codex', hash: 'h3' },
    { name: 'c', agentId: 'dsh', hash: 'h4' },
  ];
  const groups = groupFindings(findings);
  const a = groups.find((g) => g.name === 'a');
  assert.equal(a.kind, 'duplicate');
  assert.equal(a.variants.length, 1);
  const b = groups.find((g) => g.name === 'b');
  assert.equal(b.kind, 'conflict');
  assert.equal(b.variants.length, 2);
  assert.equal(groups.find((g) => g.name === 'c').kind, 'single');
});

test('symlinked flat md is discovered as flat; broken symlink lands in skipped', async () => {
  const root = await makeRoot();
  const target = join(root, 'target-skill.md');
  await writeFile(target, '---\nname: linked\ndescription: L\n---\nbody');
  await symlink(target, join(root, 'gamma.md'));
  await symlink(join(root, 'nowhere.md'), join(root, 'broken.md'));
  const { found, skipped } = await scanRoot(root, 'dsh');
  assert.equal(found.find((f) => f.name === 'linked')?.kind, 'flat');
  assert.ok(skipped.some((s) => s.name === 'broken.md'));
});

test('symlinked dir hashes by target content: same hash as the real dir', async () => {
  const rootA = await makeRoot(); const rootB = await makeRoot();
  const real = join(rootA, 'alpha');
  await mkdir(real);
  await writeFile(join(real, 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nx');
  await symlink(real, join(rootB, 'alpha'));
  const { found: fa } = await scanRoot(rootA, 'dsh');
  const { found: fb } = await scanRoot(rootB, 'codex');
  assert.equal(fa[0].hash, fb[0].hash);
  const groups = groupFindings([...fa, ...fb]);
  assert.equal(groups[0].kind, 'duplicate');
});

test('groupFindings returns groups sorted by name', () => {
  const groups = groupFindings([
    { name: 'c', agentId: 'x', hash: '1' },
    { name: 'a', agentId: 'x', hash: '2' },
    { name: 'b', agentId: 'x', hash: '3' },
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['a', 'b', 'c']);
});
