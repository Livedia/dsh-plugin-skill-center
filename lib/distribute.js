import { cp, lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hashPath } from './hashdir.js';

/** Enable one skill for one agent: symlink (default) or copy mode. */
export async function enableForAgent(record, libraryRoot, agent) {
  const target = join(libraryRoot, record.id);
  const dest = join(agent.dir, record.name);
  try {
    const st = await lstat(dest);
    if (st.isSymbolicLink() && (await readlink(dest)) === target) {
      track(record, agent, { enabled: true, mode: 'symlink' });
      return { mode: 'symlink' };
    }
    throw new Error(`enable failed: ${dest} already exists and is not this skill's link`);
  } catch (error) {
    if (/already exists/.test(String(error.message))) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(agent.dir, { recursive: true });
  if (agent.mode === 'copy') {
    await cp(target, dest, { recursive: true });
    const lastSyncedHash = await hashPath(dest);
    track(record, agent, { enabled: true, mode: 'copy', lastSyncedHash });
    return { mode: 'copy', lastSyncedHash };
  }
  await symlink(target, dest, 'dir');
  track(record, agent, { enabled: true, mode: 'symlink' });
  return { mode: 'symlink' };
}

function track(record, agent, entry) {
  record.distributions ??= {};
  record.distributions[agent.id] = entry;
}

/** Disable one skill for one agent; removes only paths this plugin manages. */
export async function disableForAgent(record, agent) {
  const dest = join(agent.dir, record.name);
  let st;
  try { st = await lstat(dest); } catch { return; } // already absent
  const dist = record.distributions?.[agent.id];
  if (st.isSymbolicLink() && dist?.mode === 'symlink') {
    await rm(dest, { force: true });
    untrack(record, agent);
    return;
  }
  if (st.isDirectory() && dist?.mode === 'copy') {
    await rm(dest, { recursive: true, force: true });
    untrack(record, agent);
    return;
  }
  throw new Error(`disable failed: ${dest} is not managed by skill-center (remove it manually)`);
}

function untrack(record, agent) {
  delete record.distributions?.[agent.id];
}

/** Remove every managed distribution, optionally archive, then remove from the library. */
export async function uninstallSkill(record, libraryRoot, agents, { archiveRoot } = {}) {
  for (const agent of agents) {
    try { await disableForAgent(record, agent); } catch { /* keep going: report per-agent */ }
  }
  const libDir = join(libraryRoot, record.id);
  if (archiveRoot !== undefined) {
    await mkdir(archiveRoot, { recursive: true });
    await rename(libDir, join(archiveRoot, record.id));
  } else {
    await rm(libDir, { recursive: true, force: true });
  }
}
