import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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

test('GET /skill/<id> returns record and files; unknown id errors', async () => {
  const { sc } = await setup();
  await sc.dispatch('POST', '/collect', { entries: [{ name: 'alpha', agentId: 'dsh' }] });
  const state = await sc.dispatch('GET', '/state', null);
  const id = state.registry.skills[0].id;
  const r = await sc.dispatch('GET', `/skill/${id}`, null);
  assert.equal(r.ok, true);
  assert.equal(r.record.id, id);
  assert.ok(r.files.includes('SKILL.md'));
  const bad = await sc.dispatch('GET', '/skill/nope', null);
  assert.equal(bad.ok, false);
});

test('uninstall defaults to archive; archive:false deletes outright', async () => {
  const { access } = await import('node:fs/promises');
  {
    const { sc, home } = await setup();
    await sc.dispatch('POST', '/collect', { entries: [{ name: 'alpha', agentId: 'dsh' }] });
    const state = await sc.dispatch('GET', '/state', null);
    const id = state.registry.skills[0].id;
    assert.equal((await sc.dispatch('POST', '/uninstall', { skillId: id })).ok, true);
    await access(join(home, 'archive', id));
    const s2 = await sc.dispatch('GET', '/state', null);
    assert.equal(s2.registry.skills.length, 0);
  }
  {
    const { sc, home } = await setup();
    await sc.dispatch('POST', '/collect', { entries: [{ name: 'alpha', agentId: 'dsh' }] });
    const state = await sc.dispatch('GET', '/state', null);
    const id = state.registry.skills[0].id;
    assert.equal((await sc.dispatch('POST', '/uninstall', { skillId: id, archive: false })).ok, true);
    await assert.rejects(access(join(home, 'archive', id)));
  }
});

test('POST /config persists and a fresh instance loads it', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sc-cfg-'));
  const configFile = join(home, 'config.json');
  const agentDir = join(home, 'agent');
  await mkdir(agentDir);
  const sc = createSkillCenter({ configFile, initial: {
    libraryRoot: join(home, 'library'), archiveRoot: join(home, 'archive'),
    registryFile: join(home, 'registry.json'),
    agents: [{ id: 'dsh', label: 'DSH', dir: agentDir, mode: 'symlink' }] } });
  const r = await sc.dispatch('POST', '/config', { archiveRoot: join(home, 'archive2') });
  assert.equal(r.ok, true);
  const sc2 = createSkillCenter({ configFile });
  const state = await sc2.dispatch('GET', '/state', null);
  assert.equal(state.config.archiveRoot, join(home, 'archive2'));
  assert.equal(state.config.agents[0].id, 'dsh'); // agents preserved through persistence
});

test('http handler enforces content-type and body size; GET works', async () => {
  const { makeHttpHandler } = await import('../lib/api.js');
  const { sc } = await setup();
  const server = createServer(makeHttpHandler(sc));
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  try {
    const noType = await fetch(`http://127.0.0.1:${port}/skill-center-api/scan`, { method: 'POST' });
    assert.equal(noType.status, 415);
    const big = await fetch(`http://127.0.0.1:${port}/skill-center-api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(2 * 1024 * 1024),
    });
    assert.equal(big.status, 413);
    const ok = await fetch(`http://127.0.0.1:${port}/skill-center-api/state`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
  } finally {
    server.close();
    server.closeAllConnections(); // undici keep-alive sockets otherwise hold 'close' up forever
    await new Promise((resolve) => server.once('close', resolve));
  }
});
