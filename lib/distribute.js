import { cp, lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hashPath } from './hashdir.js';

/** Enable one skill for one agent: symlink (default) or copy mode. Records the managed path. */
export async function enableForAgent(record, libraryRoot, agent) {
  const target = join(libraryRoot, record.id);
  const dest = join(agent.dir, record.name);
  let st;
  try {
    st = await lstat(dest);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    st = undefined;
  }
  record.distributions ??= {};
  if (st !== undefined) {
    let sameLink = false;
    if (st.isSymbolicLink()) {
      try { sameLink = (await readlink(dest)) === target; } catch { sameLink = false; }
    }
    if (!sameLink) throw new Error(`enable failed: ${dest} already exists and is not this skill's link`);
    record.distributions[agent.id] = { enabled: true, mode: 'symlink', path: dest };
    return { mode: 'symlink' };
  }
  await mkdir(agent.dir, { recursive: true });
  if (agent.mode === 'copy') {
    await cp(target, dest, { recursive: true });
    const lastSyncedHash = await hashPath(dest);
    record.distributions[agent.id] = { enabled: true, mode: 'copy', lastSyncedHash, path: dest };
    return { mode: 'copy', lastSyncedHash };
  }
  await symlink(target, dest, 'dir');
  record.distributions[agent.id] = { enabled: true, mode: 'symlink', path: dest };
  return { mode: 'symlink' };
}

/** Disable one skill for one agent; removes only paths this plugin manages. */
export async function disableForAgent(record, agent) {
  const dist = record.distributions?.[agent.id];
  const dest = dist?.path ?? join(agent.dir, record.name);
  let st;
  try {
    st = await lstat(dest);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    st = undefined;
  }
  if (st === undefined) return; // already absent; entry cleanup stays with the caller
  if (st.isSymbolicLink() && dist?.mode === 'symlink') {
    await rm(dest, { force: true });
    delete record.distributions[agent.id];
    return;
  }
  if (st.isDirectory() && dist?.mode === 'copy') {
    await rm(dest, { recursive: true, force: true });
    delete record.distributions[agent.id];
    return;
  }
  throw new Error(`disable failed: ${dest} is not managed by skill-center (remove it manually)`);
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
