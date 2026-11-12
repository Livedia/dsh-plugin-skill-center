window.__ModuleLoader__.load({
  id: 'skill-center',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'skill-center';

    const CSS = `
.sc-root { display: flex; flex-direction: column; height: 100%; padding: 16px 20px; gap: 12px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); overflow-y: auto; }
.sc-head { display: flex; align-items: center; gap: 8px; }
.sc-title { font-size: 16px; font-weight: 600; }
.sc-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.sc-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
.sc-btn[disabled] { opacity: 0.5; cursor: default; }
.sc-btn.primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
.sc-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.sc-name { font-weight: 500; font-size: 13px; }
.sc-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sc-chip { border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; padding: 2px 10px;
  font-size: 11px; cursor: pointer; background: transparent; color: var(--dsw-alias-label-secondary); }
.sc-chip.on { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
.sc-section { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 12px; background: var(--dsw-alias-bg-layer-1); }
.sc-banner { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 8px 12px; font-size: 12px; color: var(--dsw-alias-label-primary); }
.sc-list { display: flex; flex-direction: column; gap: 6px; }
.sc-icon { background: none; border: none; cursor: pointer; color: var(--dsw-alias-label-secondary); padding: 6px; border-radius: 6px; }
.sc-icon:hover { color: var(--dsw-alias-label-primary); }
`;

    function Icon() {
      return h('svg', { viewBox: '0 0 64 64', width: 22, height: 22, 'aria-hidden': true },
        h('rect', { x: 10, y: 6, width: 36, height: 24, rx: 4, fill: 'currentColor', opacity: 0.4 }),
        h('rect', { x: 14, y: 14, width: 36, height: 24, rx: 4, fill: 'currentColor', opacity: 0.7 }),
        h('rect', { x: 18, y: 22, width: 36, height: 24, rx: 4, fill: 'currentColor' }));
    }

    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      render() {
        if (this.state.error !== null) {
          return h('div', { className: 'sc-root' },
            h('style', null, CSS),
            h('div', { className: 'sc-banner', role: 'alert' },
              'skill-center crashed: ' + (this.state.error?.message ?? String(this.state.error)),
              h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 8 } },
                String(this.state.error?.stack ?? '').split('\n').slice(0, 8).join('\n'))));
        }
        return this.props.children;
      }
    }

    function Panel({ ctx }) {
      const [state, setState] = React.useState(null);
      const [scan, setScan] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const t = React.useMemo(() => {
        try {
          return ctx.locale.bind(NS);
        } catch {
          return (key) => DICTS.zh[key] ?? DICTS.en[key] ?? key;
        }
      }, [ctx]);

      const call = async (method, route, body) => {
        setBusy(true); setError('');
        try {
          const res = await fetch(`/skill-center-api${route}`, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined || body === null ? undefined : JSON.stringify(body),
          });
          const json = await res.json();
          if (!json.ok) setError(json.error ?? 'request failed');
          return json;
        } catch (e) { setError(String(e)); return { ok: false }; }
        finally { setBusy(false); }
      };

      const refresh = React.useCallback(async () => {
        const s = await call('GET', '/state', null);
        if (s.ok) setState(s);
      }, []);

      React.useEffect(() => { refresh(); }, [refresh]);

      const doScan = async () => {
        const r = await call('POST', '/scan', {});
        if (r.ok) setScan(r);
      };
      const doCollect = async (name, agentId) => {
        const r = await call('POST', '/collect', { entries: [{ name, agentId }] });
        if (r.ok) { setScan(null); await refresh(); }
      };
      const doCollectAll = async (distribute) => {
        if (scan === null) return;
        const entries = scan.groups.map((g) => ({
          name: g.name,
          agentId: g.variants[0].entries[0].agentId,
        }));
        const r = await call('POST', '/collect', { entries });
        if (Array.isArray(r.results)) {
          const failed = r.results.filter((x) => !x.ok);
          if (failed.length > 0) setError(`${failed.length}/${r.results.length} 失败: ${failed[0]?.error ?? ''}`);
        }
        if (distribute) {
          const s = await call('GET', '/state', null);
          if (s.ok) {
            for (const skill of s.registry.skills) {
              for (const agent of s.config.agents) {
                if (skill.distributions?.[agent.id]?.enabled === true) continue;
                try {
                  await fetch('/skill-center-api/enable', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ skillId: skill.id, agentId: agent.id }),
                  });
                } catch { /* best effort per agent */ }
              }
            }
          }
        }
        if (r.ok) setScan(null);
        await refresh();
      };
      const doToggle = async (skill, agent) => {
        const on = skill.distributions?.[agent.id]?.enabled === true;
        await call('POST', on ? '/disable' : '/enable', { skillId: skill.id, agentId: agent.id });
        await refresh();
      };
      const doUninstall = async (skill) => {
        await call('POST', '/uninstall', { skillId: skill.id });
        await refresh();
      };

      if (state === null) {
        return h('div', { className: 'sc-root' },
          h('style', null, CSS),
          error !== '' && h('div', { className: 'sc-banner', role: 'alert' }, `${t('loadFailed')}: ${error}`),
          error === '' && h('p', null, t('loading')),
          h('button', { className: 'sc-btn', onClick: refresh, disabled: busy }, t('retry')));
      }
      const agents = state.config.agents;
      const skills = state.registry.skills;

      return h('div', { className: 'sc-root' },
        h('style', null, CSS),
        h('div', { className: 'sc-head' },
          h('span', { className: 'sc-title' }, t('title')),
          h('button', { className: 'sc-btn', onClick: refresh, disabled: busy }, t('refresh')),
          h('button', { className: 'sc-btn primary', onClick: doScan, disabled: busy }, t('scan'))),
        error !== '' && h('div', { className: 'sc-banner', role: 'alert' }, error),
        scan !== null && h('div', { className: 'sc-section' },
          h('div', { className: 'sc-head' },
            h('div', { className: 'sc-title' }, `${t('scanReport')}: ${scan.total}`),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'sc-btn primary', disabled: busy, onClick: () => doCollectAll(false) }, t('collectAll')),
            h('button', { className: 'sc-btn', disabled: busy, onClick: () => doCollectAll(true) }, t('collectAllDistribute'))),
          scan.skipped?.length > 0 && h('div', { className: 'sc-meta' },
            `${t('skipped')}: ${scan.skipped.map((s) => s.name).join(', ')}`),
          h('div', { className: 'sc-list' },
            scan.groups.map((g) => h('div', { key: g.name, className: 'sc-row' },
              h('span', { className: 'sc-name' }, g.name),
              h('span', { className: 'sc-meta' }, t(`kind.${g.kind}`)),
              g.kind !== 'single' && h('span', { className: 'sc-meta' },
                g.variants.map((v) => v.entries.map((e) => e.agentId).join('+')).join(' vs ')),
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'sc-btn', disabled: busy,
                onClick: () => doCollect(g.name, g.variants[0].entries[0].agentId) },
                t('collect')))))),
        h('div', { className: 'sc-list' },
          skills.length === 0 && h('div', { className: 'sc-sub' }, t('empty')),
          skills.map((skill) => h('div', { key: skill.id, className: 'sc-row' },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { className: 'sc-name' }, skill.name,
                skill.version !== null && h('span', { className: 'sc-meta' }, ` v${skill.version}`)),
              h('div', { className: 'sc-meta' }, (skill.description ?? '').slice(0, 120),
                h('br', null), `${t(`source.${skill.source.type}`)} · ${skill.id}`)),
            agents.map((agent) => h('button', {
              key: agent.id,
              className: 'sc-chip' + (skill.distributions?.[agent.id]?.enabled === true ? ' on' : ''),
              onClick: () => doToggle(skill, agent),
              disabled: busy,
              title: agent.dir,
            }, agent.label)),
            h('button', { className: 'sc-btn', onClick: () => doUninstall(skill), disabled: busy },
              t('uninstall'))))));
    }

    const DICTS = {
      zh: {
        loading: '加载中…', title: '技能中心', refresh: '刷新', scan: '扫描',
        loadFailed: '加载失败', retry: '重试',
        'kind.single': '唯一', 'kind.duplicate': '重复', 'kind.conflict': '版本冲突',
        scanReport: '扫描报告', skipped: '已跳过', collect: '收编入库',
        collectAll: '收编全部', collectAllDistribute: '收编并分发到全部 agent',
        empty: '中央库为空。先扫描并收编现有技能。',
        uninstall: '卸载', 'source.collected': '本地收编', 'source.market': '市场安装',
        'source.github': 'GitHub 安装', 'source.remote': '远程同步',
      },
      en: {
        loading: 'Loading…', title: 'Skill Center', refresh: 'Refresh', scan: 'Scan',
        loadFailed: 'Load failed', retry: 'Retry',
        'kind.single': 'single', 'kind.duplicate': 'duplicate', 'kind.conflict': 'version conflict',
        scanReport: 'Scan report', skipped: 'Skipped', collect: 'Collect',
        collectAll: 'Collect all', collectAllDistribute: 'Collect & distribute all',
        empty: 'Library is empty. Scan and collect existing skills first.',
        uninstall: 'Uninstall', 'source.collected': 'collected', 'source.market': 'marketplace',
        'source.github': 'GitHub', 'source.remote': 'remote sync',
      },
    };

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTS));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'skill-center', order: 60, locale: NS, label: () => ctx.locale.bind(NS)('title'),
        }, function SkillCenterIcon() {
          return h('span', {
            className: 'sc-icon', role: 'button', tabIndex: 0,
            title: ctx.locale.bind(NS)('title'),
            'aria-label': ctx.locale.bind(NS)('title'),
            onClick: () => ctx.layout.selectPanel('skill-center'),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                ctx.layout.selectPanel('skill-center');
              }
            },
          }, h(Icon));
        }));
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'skill-center', locale: NS,
        }, function SkillCenterPanel() {
          return h(PanelBoundary, null, h(Panel, { ctx }));
        }));
      },
    };
  },
});
