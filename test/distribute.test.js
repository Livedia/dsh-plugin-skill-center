import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enableForAgent, disableForAgent, uninstallSkill } from '../lib/distribute.js';

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'sc-dist-'));
  const library = join(home, 'library'); const agentDir = join(home, 'agent');
  await mkdir(join(library, 'alpha'), { recursive: true }); await mkdir(agentDir);
  await writeFile(join(library, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nx');
  const record = { id: 'alpha', name: 'alpha', distributions: {} };
  return { home, library, agentDir, record };
}

test('enable symlink mode creates symlink; disable removes it', async () => {
  const { library, agentDir, record } = await setup();
  const agent = { id: 'dsh', dir: agentDir, mode: 'symlink' };
  await enableForAgent(record, library, agent);
  const link = join(agentDir, 'alpha');
  assert.ok((await lstat(link)).isSymbolicLink());
  await disableForAgent(record, agent);
  await assert.rejects(lstat(link));
});

test('enable copy mode copies; disable removes dir', async () => {
  const { library, agentDir, record } = await setup();
  const agent = { id: 'codex', dir: agentDir, mode: 'copy' };
  await enableForAgent(record, library, agent);
  const dir = join(agentDir, 'alpha');
  assert.ok((await lstat(dir)).isDirectory());
  await disableForAgent(record, agent);
  await assert.rejects(lstat(dir));
});

test('enable refuses to overwrite an existing unmanaged path', async () => {
  const { library, agentDir, record } = await setup();
  await writeFile(join(agentDir, 'alpha'), 'foreign', 'utf8');
  await assert.rejects(
    enableForAgent(record, library, { id: 'dsh', dir: agentDir, mode: 'symlink' }),
    /already exists/);
});

test('disable refuses unmanaged paths', async () => {
  const { agentDir, record } = await setup();
  await writeFile(join(agentDir, 'alpha'), 'foreign', 'utf8');
  await assert.rejects(
    disableForAgent(record, { id: 'dsh', dir: agentDir, mode: 'symlink' }),
    /not managed/);
});

test('uninstall removes all managed distributions and optionally archives', async () => {
  const { home, library, agentDir, record } = await setup();
  const agent = { id: 'dsh', dir: agentDir, mode: 'symlink' };
  await enableForAgent(record, library, agent);
  await uninstallSkill(record, library, [agent], { archiveRoot: join(home, 'archive') });
  await assert.rejects(lstat(join(agentDir, 'alpha')));
  const { access } = await import('node:fs/promises');
  await access(join(home, 'archive', 'alpha')); // archived copy exists
  await assert.rejects(access(join(library, 'alpha'))); // removed from library
});

test('enable is idempotent when the exact link already exists', async () => {
  const { library, agentDir, record } = await setup();
  const agent = { id: 'dsh', dir: agentDir, mode: 'symlink' };
  await enableForAgent(record, library, agent);
  const result = await enableForAgent(record, library, agent);
  assert.deepEqual(result, { mode: 'symlink' });
  assert.ok((await lstat(join(agentDir, 'alpha'))).isSymbolicLink());
});

test('disable removes a collected origin path recorded in the entry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sc-dist2-'));
  const library = join(home, 'library'); const agentDir = join(home, 'agent');
  await mkdir(join(library, 'alpha'), { recursive: true }); await mkdir(agentDir);
  await writeFile(join(library, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: A\n---\nx');
  const originStem = join(agentDir, 'Alpha-Tools'); // stem ≠ name
  await symlink(join(library, 'alpha'), originStem);
  const record = { id: 'alpha', name: 'alpha', distributions: { dsh: { enabled: true, mode: 'symlink', path: originStem } } };
  await disableForAgent(record, { id: 'dsh', dir: agentDir, mode: 'symlink' });
  await assert.rejects(lstat(originStem));
  assert.equal(record.distributions.dsh, undefined);
});

test('uninstall without archiveRoot deletes the library copy', async () => {
  const { home, library, agentDir, record } = await setup();
  const agent = { id: 'dsh', dir: agentDir, mode: 'symlink' };
  await enableForAgent(record, library, agent);
  await uninstallSkill(record, library, [agent], {});
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(join(library, 'alpha')));
  await assert.rejects(access(join(home, 'archive')));
});
