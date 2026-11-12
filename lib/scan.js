import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFrontmatter } from './frontmatter.js';
import { hashPath } from './hashdir.js';

/**
 * Scan one agent skill root (DSH-compatible discovery):
 * depth-1 directories containing SKILL.md, or flat `<name>.md` files.
 * Symlinked entries are followed (stat), matching DSH skill-filesystem.
 */
export async function scanRoot(rootDir, agentId) {
  const found = [];
  let entries;
  try { entries = await readdir(rootDir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(rootDir, entry.name);
    try {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const st = await stat(path);
        if (!st.isDirectory()) continue;
        const fm = await readFrontmatter(join(path, 'SKILL.md'));
        if (fm?.fields.name && fm.fields.description) {
          found.push({
            agentId, path, name: fm.fields.name, stem: entry.name,
            frontmatter: fm.fields, kind: 'dir', hash: await hashPath(path),
          });
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const fm = await readFrontmatter(path);
        if (fm?.fields.name && fm.fields.description) {
          found.push({
            agentId, path, name: fm.fields.name, stem: entry.name,
            frontmatter: fm.fields, kind: 'flat', hash: await hashPath(path),
          });
        }
      }
    } catch { /* unreadable entry: skip */ }
  }
  return found;
}

/** Scan every configured agent root. */
export async function scanAll(agents) {
  const all = [];
  for (const agent of agents) all.push(...(await scanRoot(agent.dir, agent.id)));
  return all;
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
