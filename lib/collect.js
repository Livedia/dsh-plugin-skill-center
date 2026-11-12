import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateId } from './registry.js';
import { hashPath } from './hashdir.js';

/**
 * Transactionally collect one scanned skill into the central library:
 * copy to staging → verify hash → move into library → replace origin with a
 * symlink (backup dance, rollback on failure). Flat `.md` skills are wrapped as
 * `<id>/SKILL.md`; the origin file becomes a symlink to it.
 *
 * The source hash is `finding.hash` from the scan (or a fresh real `hashPath`);
 * the staged copy is hashed through `deps.hasher`, which is injectable so tests
 * can simulate a corrupted copy and exercise the rollback path.
 */
export async function collectOne(finding, libraryRoot, existingSkills, deps = {}) {
  const hasher = deps.hasher ?? hashPath;
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
      await symlink(finding.kind === 'dir' ? libDir : join(libDir, 'SKILL.md'), finding.path, finding.kind === 'dir' ? 'dir' : 'file');
      if (finding.kind === 'dir') {
        const st = await lstat(finding.path);
        if (!st.isSymbolicLink() || (await readlink(finding.path)) !== libDir) throw new Error('symlink verify failed');
      }
    } catch (error) {
      await rename(backup, finding.path); // rollback the swap
      throw error;
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
    record.distributions[finding.agentId] = { enabled: true, mode: 'symlink', lastSyncedHash: sourceHash };
    return { id, record };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
