import { homedir } from 'node:os';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function defaultConfigFile() {
  return join(homedir(), '.skill-center', 'config.json');
}

export function resolveTilde(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function defaultConfig() {
  const home = join(homedir(), '.skill-center');
  return {
    libraryRoot: join(home, 'library'),
    archiveRoot: join(home, 'archive'),
    registryFile: join(home, 'registry.json'),
    agents: [
      { id: 'dsh', label: 'DSH', dir: join(homedir(), '.agent', 'skills'), mode: 'symlink' },
      { id: 'codex', label: 'Codex CLI', dir: join(homedir(), '.codex', 'skills'), mode: 'symlink' },
    ],
  };
}

export async function loadConfig(file = defaultConfigFile()) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    const base = defaultConfig();
    return { ...base, ...parsed, agents: Array.isArray(parsed.agents) ? parsed.agents : base.agents };
  } catch { return defaultConfig(); }
}

export async function saveConfig(config, file = defaultConfigFile()) {
  const tmp = `${file}.tmp`;
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}
