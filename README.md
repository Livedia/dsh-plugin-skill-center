# 技能中心（dsh-plugin-skill-center）

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)插件：把散落在各 agent 目录的本地技能（skill）统一收进中央库，去重与版本对比，一键分发给每个 agent。

## 功能

- **扫描**：发现各 agent 技能目录里的全部技能（DSH 兼容发现规则：深度 1 的 `SKILL.md` 目录与平铺 `.md`，跟随 symlink），按「唯一 / 重复 / 版本冲突」分组报告，不可读条目单独列出
- **事务式收编**：把现有技能复制进中央库（`~/.skill-center/library`），哈希校验后原位替换为 symlink —— 先备份、失败回滚，任何一步中断都不丢数据；重复收编幂等
- **按 agent 分发**：中央库为唯一真身，DSH（`~/.agent/skills`）、Codex CLI（`~/.codex/skills`）等目标目录用 symlink 指入；每个技能对每个 agent 独立开关；不跟 symlink 的工具可按 agent 改为复制模式
- **卸载与归档**：停用全部分发并移出中央库，默认归档到 `~/.skill-center/archive/`
- **侧边栏面板**：DSH Web GUI 侧边栏「技能中心」入口，扫描报告、技能列表、来源标识、分发开关，中英双语

## 安装

要求：已安装 DeepSeek Harness（Desktop 或 CLI profile）。

1. 克隆本仓库：

   ```bash
   git clone https://github.com/Livedia/dsh-plugin-skill-center.git
   ```

2. 在 DSH 会话中让 agent 安装（插件管理工具接受本地目录）：

   > 用 plugin_manager 安装 bundle，target 为 <仓库克隆的绝对路径>

   安装结果 `application: "applied"` 即生效；刷新 Web GUI 页面，侧边栏出现「技能中心」图标。

## 配置

`~/.skill-center/config.json`（面板或 HTTP API 可改，改完即持久化）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `libraryRoot` | `~/.skill-center/library` | 中央库（技能唯一真身） |
| `archiveRoot` | `~/.skill-center/archive` | 卸载归档目录 |
| `registryFile` | `~/.skill-center/registry.json` | 注册表 |
| `agents` | DSH + Codex CLI 两项 | 分发目标数组：`{id, label, dir, mode}`，`mode` 为 `symlink`（默认）或 `copy` |

其他 agent（Claude Code、OpenCode 等）在 `agents` 里加一项即可接入，无需改代码。

## HTTP API（本机 loopback）

前缀 `/skill-center-api`，POST 需 `content-type: application/json`，body 上限 1MB：

| 方法与路径 | 作用 |
|---|---|
| `GET /state` | 配置 + 注册表快照 |
| `POST /scan` | 扫描全部 agent 目录，返回分组报告与跳过清单 |
| `POST /collect` | `{entries:[{name, agentId?}]}` 事务式收编入库 |
| `POST /collect-all` | `{distribute?: boolean}` 一键收编全部扫描分组（可选同步分发到全部 agent） |
| `POST /enable` / `POST /disable` | `{skillId, agentId}` 分发开关 |
| `POST /uninstall` | `{skillId, archive?}` 卸载（默认归档） |
| `POST /config` | 更新并持久化配置 |
| `GET /skill/:id` | 单个技能详情与文件清单 |

## 工作原理

- **中央库 + symlink 分发**：每个技能只在 `libraryRoot` 存一份真身；agent 目录中的条目是指向它的 symlink。DSH 的技能加载器（`skill-filesystem`）默认跟随 symlink，因此 DSH 无需重启即可发现变化
- **事务式收编**：复制到暂存区 → 哈希校验（源与副本逐字节等价）→ 原子 rename 入库 → 原位换链（备份 → 建链 → 校验 → 删备份）；任一步失败回滚，数据任何时刻至少存一份完整副本
- **内容哈希**：目录确定性 sha256（排序遍历），用于重复检测与迁移校验；同一内容无论链接怎么拼，哈希一致

## 开发与测试

```bash
git clone https://github.com/Livedia/dsh-plugin-skill-center.git
cd dsh-plugin-skill-center
node --test        # 44 项测试，零第三方依赖
```

代码结构：`lib/frontmatter.js`（frontmatter 标量解析）、`lib/hashdir.js`（内容哈希）、`lib/scan.js`（扫描与分组）、`lib/registry.js`（注册表）、`lib/collect.js`（事务收编）、`lib/distribute.js`（分发）、`lib/config.js`（配置）、`lib/api.js`（操作核心 + HTTP）；`client.js` 为 Web 面板。

## 已知限制（P1）

- 冲突组（同名不同内容）收编时取第一个匹配变体，其余变体保留原地；逐变体消歧在路线图中
- frontmatter 仅解析顶层标量字段（name/description/version），嵌套 YAML 块不解析（DSH 自身解析不受影响）
- HTTP API 无鉴权，信任边界为本机 GUI 用户；请勿将 DSH Web 端口暴露到网络
- Electron file:// 部署形态（无 webServer）不支持，需 loopback Web 载体

## 路线图

- **P2**：技能市场（skills.sh、Anthropic 官方仓库）浏览与安装；GitHub 直装
- **P3**：SSH 远程主机扫描与拉取同步

## License

[MIT](LICENSE)
