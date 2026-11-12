import { readFile } from 'node:fs/promises';

/** Parse `---`-delimited frontmatter; extract top-level scalar fields only. */
export function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  if ((lines[0] ?? '').replace(/\r$/, '') !== '---') return undefined;
  const fields = {};
  let closed = false;
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (line === '---') { closed = true; closeIndex = i; break; }
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (Object.hasOwn(fields, m[1])) continue;
    let value = m[2].trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    fields[m[1]] = value;
  }
  if (!closed) return undefined;
  return { fields, body: lines.slice(closeIndex + 1).join('\n') };
}

/** Read a skill file and parse its frontmatter; undefined when absent/unreadable. */
export async function readFrontmatter(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); } catch { return undefined; }
  return parseFrontmatter(raw);
}
