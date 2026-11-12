import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { allocateId } from './registry.js';
import { hashPath } from './hashdir.js';

/**
 * Transactionally collect one scanned skill into the central library:
 * copy → verify hash → replace origin with a symlink (backup dance, rollback on failure).
 * Flat `.md` skills are wrapped as `<id>/SKILL.md`; the origin file becomes a symlink to it.
 * Idempotent: an origin already linked into this library returns the existing record.
 * `deps.hasher` / `deps.symlinker` are injectable for failure simulation in tests.
 */
export async function collectOne(finding, libraryRoot, existingSkills, deps = {}) {
  const hasher = deps.hasher ?? hashPath;
  const linker = deps.symlinker ?? symlink;
  const libRootAbs = resolve(libraryRoot);
  // On macOS the workspace may live behind a symlink (e.g. /var → /private/var),
  // so a realpath'd origin link can never match the lexical root; accept both forms.
  let libRootReal = libRootAbs;
  try { libRootReal = await realpath(libraryRoot); } catch { /* keep lexical form */ }

  // Idempotent re-collection: the origin is already a link into this library.
  const originStat = await lstat(finding.path);
  if (originStat.isSymbolicLink()) {
    const resolved = await realpath(finding.path);
    const linkedDir = basename(resolved) === 'SKILL.md' ? dirname(resolved) : resolved;
    const inside = (root) => linkedDir === root || linkedDir.startsWith(root + '/');
    if (inside(libRootAbs) || inside(libRootReal)) {
      const linkId = basename(linkedDir);
      const existing = existingSkills.find((s) => s.id === linkId);
      if (existing !== undefined) return { id: linkId, record: existing };
      throw new Error(`already collected: ${finding.path} links into the library but record "${linkId}" is missing; remove the link or repair the registry`);
    }
  }

  const id = allocateId(existingSkills, finding.name);
  const libDir = join(libraryRoot, id);
  const staging = await mkdtemp(join(tmpdir(), 'sc-stage-'));
  try {
    if (finding.kind === 'dir') {
      await cp(finding.path, join(staging, id), { recursive: true });
    } else {
      await mkdir(join(staging, id), { recursive: true });
      const raw = await readFile(finding.path, 'utf8');
      await writeFile(join(staging, id, 'SKILL.md'), raw, 'utf8');
    }
    // Compare like with like: a dir source against the staged dir, a flat file
    // against the staged SKILL.md file (hashPath(file) != hashPath(dir-of-file)).
    const stagedTarget = finding.kind === 'dir' ? join(staging, id) : join(staging, id, 'SKILL.md');
    const sourceHash = finding.hash ?? await hashPath(finding.path);
    const stagedHash = await hasher(stagedTarget);
    if (sourceHash !== stagedHash) throw new Error(`verify failed: staged copy of "${finding.name}" hash ${stagedHash} != source ${sourceHash}`);
    await mkdir(libraryRoot, { recursive: true });
    await rename(join(staging, id), libDir);

    // Swap the origin for a symlink pointing at the library copy.
    const backup = `${finding.path}.skill-center-bak`;
    await rename(finding.path, backup);
    try {
      await linker(finding.kind === 'dir' ? libDir : join(libDir, 'SKILL.md'), finding.path, finding.kind === 'dir' ? 'dir' : 'file');
      if (finding.kind === 'dir') {
        const st = await lstat(finding.path);
        if (!st.isSymbolicLink() || (await readlink(finding.path)) !== libDir) throw new Error('symlink verify failed');
      }
    } catch (error) {
      let restored = true;
      try {
        await rename(backup, finding.path);
      } catch {
        restored = false;
      }
      await rm(libDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`symlink failed: ${error?.message ?? error}; origin ${restored ? 'restored' : `NOT restored — recover from ${backup}`}; library copy removed`);
    }
    await rm(backup, { recursive: true, force: true });

    const record = {
      id,
      name: finding.name,
      description: finding.frontmatter?.description ?? '',
      version: finding.frontmatter?.version ?? null,
      hash: sourceHash,
      source: { type: 'collected', origin: finding.path, installedAt: new Date().toISOString() },
      distributions: {},
    };
    record.distributions[finding.agentId] = { enabled: true, mode: 'symlink', lastSyncedHash: sourceHash, path: finding.path };
    return { id, record };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
