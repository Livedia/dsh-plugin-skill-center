import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, lstat, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectOne } from '../lib/collect.js';

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'sc-collect-'));
  const agentDir = join(home, 'agent-skills');
  const library = join(home, 'library');
  await mkdir(agentDir); await mkdir(library);
  return { home, agentDir, library };
}

async function readFileCheck(p) {
  const { access } = await import('node:fs/promises');
  try { await access(p); return true; } catch { return false; }
}

test('collects a dir skill: copies to library, replaces origin with symlink', async () => {
  const { agentDir, library } = await setup();
  const origin = join(agentDir, 'alpha');
  await mkdir(origin);
  await writeFile(join(origin, 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nbody');
  const result = await collectOne(
    { path: origin, name: 'alpha', kind: 'dir', frontmatter: { name: 'alpha', description: 'A' } },
    library, []);
  assert.equal(result.record.id, 'alpha');
  const st = await lstat(origin);
  assert.ok(st.isSymbolicLink());
  assert.equal(await readlink(origin), join(library, 'alpha'));
  assert.equal((await readFileCheck(join(library, 'alpha', 'SKILL.md'))), true);
  assert.equal(result.record.source.type, 'collected');
});

test('collects a flat md skill: wraps into library dir, origin becomes file symlink', async () => {
  const { agentDir, library } = await setup();
  const origin = join(agentDir, 'beta.md');
  await writeFile(origin, '---\nname: beta\ndescription: B\n---\nbody');
  const result = await collectOne(
    { path: origin, name: 'beta', kind: 'flat', frontmatter: { name: 'beta', description: 'B' } },
    library, []);
  assert.equal(result.record.id, 'beta');
  assert.ok((await lstat(origin)).isSymbolicLink());
  assert.equal((await readFileCheck(join(library, 'beta', 'SKILL.md'))), true);
});

test('same-name second collect allocates -2 id and keeps both', async () => {
  const { agentDir, library } = await setup();
  for (const suffix of ['1', '2']) {
    const origin = join(agentDir, `dup-${suffix}`);
    await mkdir(origin);
    await writeFile(join(origin, 'SKILL.md'), `---\nname: dup\ndescription: D${suffix}\n---\nb`);
  }
  const first = await collectOne(
    { path: join(agentDir, 'dup-1'), name: 'dup', kind: 'dir', frontmatter: { name: 'dup' } },
    library, []);
  const second = await collectOne(
    { path: join(agentDir, 'dup-2'), name: 'dup', kind: 'dir', frontmatter: { name: 'dup' } },
    library, [first.record]);
  assert.equal(first.record.id, 'dup');
  assert.equal(second.record.id, 'dup-2');
});

test('rolls back library copy on hash mismatch (injectable hasher)', async () => {
  const { agentDir, library } = await setup();
  const origin = join(agentDir, 'gamma');
  await mkdir(origin);
  await writeFile(join(origin, 'SKILL.md'), '---\nname: gamma\ndescription: G\n---\nbody');
  const brokenHash = async () => 'sha256:not-the-same';
  await assert.rejects(
    collectOne({ path: origin, name: 'gamma', kind: 'dir', frontmatter: { name: 'gamma' } },
      library, [], { hasher: brokenHash }),
    /verify failed/);
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(join(library, 'gamma')));
  assert.ok(!(await lstat(origin)).isSymbolicLink()); // origin untouched
});
