import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Load the central registry; a missing or corrupt file yields an empty registry. */
export async function loadRegistry(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed && Array.isArray(parsed.skills)) return { ...parsed, version: 1 };
  } catch { /* fall through */ }
  return { version: 1, skills: [] };
}

/** Atomically save the registry (tmp file + rename). */
export async function saveRegistry(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/** Lowercase slug of a skill name. */
export function slugify(name) {
  return String(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'skill';
}

/** Allocate a fresh id under `slug`, appending -2, -3… on collisions. */
export function allocateId(skills, name) {
  const base = slugify(name);
  const taken = new Set(skills.map((s) => s.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
