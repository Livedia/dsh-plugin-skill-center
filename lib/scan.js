import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontmatter } from './frontmatter.js';
import { hashPath } from './hashdir.js';

/**
 * Scan one agent skill root (DSH-compatible discovery):
 * depth-1 directories containing SKILL.md, or flat `<name>.md` files.
 * Symlinked entries are followed with stat (matching DSH skill-filesystem,
 * which also discovers symlinked flat .md files) and hashed via realpath
 * so identical content hashes identically regardless of link spelling.
 * Unreadable entries are reported in `skipped` instead of vanishing.
 */
export async function scanRoot(rootDir, agentId) {
  const found = [];
  const skipped = [];
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    return { found, skipped: [{ name: rootDir, reason: `unreadable root: ${error?.code ?? String(error)}` }] };
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = join(rootDir, entry.name);
    try {
      let kind = null;
      if (entry.isDirectory()) kind = 'dir';
      else if (entry.isSymbolicLink()) {
        const st = await stat(entryPath);
        kind = st.isDirectory() ? 'dir' : (st.isFile() && entry.name.endsWith('.md') ? 'flat' : null);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        kind = 'flat';
      }
      if (kind === 'dir') {
        const fm = await readFrontmatter(join(entryPath, 'SKILL.md'));
        if (fm?.fields.name && fm.fields.description) {
          found.push({
            agentId, path: entryPath, name: fm.fields.name, stem: entry.name,
            frontmatter: fm.fields, kind, hash: await hashPath(await realpath(entryPath)),
          });
        }
      } else if (kind === 'flat') {
        const fm = await readFrontmatter(entryPath);
        if (fm?.fields.name && fm.fields.description) {
          found.push({
            agentId, path: entryPath, name: fm.fields.name, stem: entry.name,
            frontmatter: fm.fields, kind, hash: await hashPath(await realpath(entryPath)),
          });
        }
      }
    } catch (error) {
      skipped.push({ name: entry.name, reason: String(error?.code ?? error?.message ?? error) });
    }
  }
  return { found, skipped };
}

/** Scan every configured agent root, aggregating findings and skips. */
export async function scanAll(agents) {
  const found = [];
  const skipped = [];
  for (const agent of agents) {
    const result = await scanRoot(agent.dir, agent.id);
    found.push(...result.found);
    skipped.push(...result.skipped);
  }
  return { found, skipped };
}

/** Group findings by skill name into duplicate / conflict / single reports. */
export function groupFindings(findings) {
  const byName = new Map();
  for (const f of findings) {
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }
  const groups = [];
  for (const [name, list] of byName) {
    const byHash = new Map();
    for (const f of list) {
      const v = byHash.get(f.hash) ?? { hash: f.hash, entries: [] };
      v.entries.push({ agentId: f.agentId, path: f.path, kind: f.kind, frontmatter: f.frontmatter });
      byHash.set(f.hash, v);
    }
    const variants = [...byHash.values()];
    groups.push({
      name,
      kind: variants.length > 1 ? 'conflict' : (list.length > 1 ? 'duplicate' : 'single'),
      variants,
    });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}
