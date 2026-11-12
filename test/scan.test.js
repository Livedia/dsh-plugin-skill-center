import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
  const found = await scanRoot(root, 'dsh');
  assert.equal(found.length, 2);
  const alpha = found.find((f) => f.name === 'alpha');
  assert.equal(alpha.kind, 'dir');
  assert.equal(alpha.frontmatter.description, 'A');
  assert.equal(found.find((f) => f.name === 'beta').kind, 'flat');
  assert.ok(alpha.hash.startsWith('sha256:'));
});

test('scanRoot on missing root returns empty', async () => {
  assert.deepEqual(await scanRoot(join(await makeRoot(), 'gone'), 'x'), []);
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
