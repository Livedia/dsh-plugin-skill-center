import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { collectOne } from './collect.js';
import { enableForAgent, disableForAgent, uninstallSkill } from './distribute.js';
import { scanAll, groupFindings } from './scan.js';
import { loadRegistry, saveRegistry } from './registry.js';
import { defaultConfig, loadConfig, saveConfig } from './config.js';

/**
 * The skill-center operations core. `dispatch(method, route, body)` is callable
 * directly (tests, future agent tool) and from the HTTP handler below.
 * Routes are relative to the /skill-center-api prefix.
 */
export function createSkillCenter({ configFile, initial } = {}) {
  let config = initial;
  let loaded = false;
  async function ensureConfig() {
    if (loaded) return;
    loaded = true;
    // A configFile only wins when it actually exists on disk; a missing file
    // must not clobber a caller-provided `initial` with home defaults.
    if (configFile !== undefined) {
      let onDisk = true;
      try { await access(configFile); } catch { onDisk = false; }
      if (onDisk) config = await loadConfig(configFile);
    }
    if (config === undefined) config = defaultConfig();
  }

  const api = {
    async dispatch(method, route, body) {
      try {
        await ensureConfig();
        return await handle(method, route, body ?? {});
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
  };

  async function handle(method, route, body) {
    if (method === 'GET' && route === '/state') {
      const registry = await loadRegistry(config.registryFile);
      return { ok: true, config: publicConfig(), registry };
    }
    if (method === 'GET' && route.startsWith('/skill/')) {
      const id = decodeURIComponent(route.slice('/skill/'.length));
      const registry = await loadRegistry(config.registryFile);
      const record = registry.skills.find((s) => s.id === id);
      if (record === undefined) return { ok: false, error: `unknown skill ${id}` };
      const files = await listFiles(join(config.libraryRoot, id));
      return { ok: true, record, files };
    }
    if (method === 'POST' && route === '/scan') {
      const { found, skipped } = await scanAll(config.agents);
      return { ok: true, groups: groupFindings(found), total: found.length, skipped };
    }
    if (method === 'POST' && route === '/collect') {
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const { found } = await scanAll(config.agents);
      const registry = await loadRegistry(config.registryFile);
      const results = [];
      for (const entry of entries) {
        const finding = found.find(
          (f) => f.name === entry.name && (entry.agentId === undefined || f.agentId === entry.agentId));
        if (finding === undefined) {
          results.push({ ok: false, error: `not found: ${entry.name}` });
          continue;
        }
        try {
          const { id, record } = await collectOne(finding, config.libraryRoot, registry.skills);
          if (!registry.skills.some((s) => s.id === id)) registry.skills.push(record);
          results.push({ ok: true, id });
        } catch (error) {
          results.push({ ok: false, error: String(error?.message ?? error) });
        }
      }
      await saveRegistry(config.registryFile, registry);
      return { ok: results.every((r) => r.ok), results };
    }
    if ((method === 'POST' && route === '/enable') || (method === 'POST' && route === '/disable')) {
      const enable = route === '/enable';
      const registry = await loadRegistry(config.registryFile);
      const record = registry.skills.find((s) => s.id === body.skillId);
      const agent = config.agents.find((a) => a.id === body.agentId);
      if (record === undefined || agent === undefined) return { ok: false, error: 'unknown skillId or agentId' };
      if (enable) {
        await enableForAgent(record, config.libraryRoot, agent);
      } else {
        await disableForAgent(record, agent);
        delete record.distributions[agent.id]; // clean lingering entries from the absent path
      }
      await saveRegistry(config.registryFile, registry);
      return { ok: true };
    }
    if (method === 'POST' && route === '/uninstall') {
      const registry = await loadRegistry(config.registryFile);
      const index = registry.skills.findIndex((s) => s.id === body.skillId);
      if (index < 0) return { ok: false, error: 'unknown skillId' };
      const record = registry.skills[index];
      await uninstallSkill(record, config.libraryRoot, config.agents,
        body.archive === false ? {} : { archiveRoot: config.archiveRoot });
      registry.skills.splice(index, 1);
      await saveRegistry(config.registryFile, registry);
      return { ok: true };
    }
    if (method === 'POST' && route === '/config') {
      const next = { ...config, ...body };
      delete next.ok;
      config = next;
      if (configFile !== undefined) await saveConfig(config, configFile);
      return { ok: true, config: publicConfig() };
    }
    return { ok: false, error: `no route ${method} ${route}` };
  }

  function publicConfig() {
    return { libraryRoot: config.libraryRoot, archiveRoot: config.archiveRoot, agents: config.agents };
  }

  return api;
}

async function listFiles(dir, prefix = '') {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await listFiles(join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

/** Raw node:http handler for the webServer prefix route. */
export function makeHttpHandler(sc) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const route = url.pathname.replace(/^\/skill-center-api/, '') || '/';
    const send = (code, payload) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };
    try {
      let body = null;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        body = raw === '' ? {} : JSON.parse(raw);
      }
      const result = await sc.dispatch(req.method ?? 'GET', route, body);
      send(result.ok === false ? 400 : 200, result);
    } catch (error) {
      send(400, { ok: false, error: String(error?.message ?? error) });
    }
  };
}
