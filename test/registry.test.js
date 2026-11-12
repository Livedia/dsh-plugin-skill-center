import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry, slugify, allocateId } from '../lib/registry.js';

test('loadRegistry missing file → empty registry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sc-reg-'));
  const reg = await loadRegistry(join(dir, 'registry.json'));
  assert.equal(reg.version, 1);
  assert.deepEqual(reg.skills, []);
});

test('saveRegistry writes atomically and reloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sc-reg-'));
  const file = join(dir, 'registry.json');
  await saveRegistry(file, { version: 1, skills: [{ id: 'x' }] });
  assert.equal((await loadRegistry(file)).skills[0].id, 'x');
  await writeFile(file, '{ broken', 'utf8'); // corrupt → empty on load
  assert.deepEqual((await loadRegistry(file)).skills, []);
});

test('slugify and allocateId', () => {
  assert.equal(slugify('My Skill: v2!'), 'my-skill-v2');
  assert.equal(allocateId([], 'a'), 'a');
  assert.equal(allocateId([{ id: 'a' }, { id: 'a-2' }], 'a'), 'a-3');
});
