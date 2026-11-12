import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkillCenter } from '../lib/api.js';

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'sc-api-'));
  const agentDir = join(home, 'agent');
  await mkdir(agentDir);
  const alpha = join(agentDir, 'alpha');
  await mkdir(alpha);
  await writeFile(join(alpha, 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nbody');
  const config = {
    libraryRoot: join(home, 'library'),
    archiveRoot: join(home, 'archive'),
    registryFile: join(home, 'registry.json'),
    agents: [{ id: 'dsh', label: 'DSH', dir: agentDir, mode: 'symlink' }],
  };
  const sc = createSkillCenter({ configFile: join(home, 'config.json'), initial: config });
  return { sc, home, config };
}

test('scan reports the fixture skill', async () => {
  const { sc } = await setup();
  const report = await sc.dispatch('POST', '/scan', {});
  assert.equal(report.ok, true);
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].name, 'alpha');
  assert.deepEqual(report.skipped, []);
});

test('collect then state then disable/enable flow', async () => {
  const { sc } = await setup();
  const collected = await sc.dispatch('POST', '/collect', { entries: [{ name: 'alpha', agentId: 'dsh' }] });
  assert.equal(collected.ok, true);
  const state = await sc.dispatch('GET', '/state', null);
  assert.equal(state.registry.skills.length, 1);
  const rec = state.registry.skills[0];
  assert.equal(rec.distributions.dsh.enabled, true); // collected agent auto-enabled
  const after = await sc.dispatch('POST', '/disable', { skillId: rec.id, agentId: 'dsh' });
  assert.equal(after.ok, true);
  const state2 = await sc.dispatch('GET', '/state', null);
  assert.equal(state2.registry.skills[0].distributions.dsh, undefined); // entry removed
  const again = await sc.dispatch('POST', '/enable', { skillId: rec.id, agentId: 'dsh' });
  assert.equal(again.ok, true);
  const state3 = await sc.dispatch('GET', '/state', null);
  assert.equal(state3.registry.skills[0].distributions.dsh.enabled, true);
});

test('re-collect is idempotent at the API level (no duplicate records)', async () => {
  const { sc } = await setup();
  await sc.dispatch('POST', '/collect', { entries: [{ name: 'alpha', agentId: 'dsh' }] });
  const twice = await sc.dispatch('POST', '/collect', { entries: [{ name: 'alpha', agentId: 'dsh' }] });
  assert.equal(twice.ok, true);
  const state = await sc.dispatch('GET', '/state', null);
  assert.equal(state.registry.skills.length, 1);
});

test('unknown route → error payload', async () => {
  const { sc } = await setup();
  const r = await sc.dispatch('GET', '/nope', null);
  assert.equal(r.ok, false);
});
