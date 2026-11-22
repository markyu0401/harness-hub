# HarnessHub

> **面向多 Agent Harness 的可视化能力中枢（Skills + MCP 工具中转站）**  
> 告别在 `~/.codex`、`~/.config/opencode`、`~/.hermes`、`~/.claude`、`~/.gemini` 之间来回翻文件夹和手敲软链。在一个网页界面里统一盘点、点击或拖拽分配，并一键验证各 Harness 是否真实生效。

[English](README.md) · [配置指南 (英文)](docs/SETUP.md) · [产品需求文档 (PRD)](docs/PRD.md) · [技术架构](docs/ARCHITECTURE.md) · [开发路线图](docs/ROADMAP.md) · [架构决策 ADR-001](docs/adr/001-dual-channel-skill-distribution-and-mcp-compatibility.md)

---

## 为什么做这个项目？

用模型 API 时，大家早就习惯了 **API 中转站**（LiteLLM、OneAPI 等）：所有渠道收口到一处，按需路由给不同客户端。

但到了 **Agent 能力层（Skills、MCP 工具、Rules、CLI 指南）**，整个生态依然处于各自为政的状态：

- **配置与目录碎片化**：Codex 用 `config.toml`，OpenCode 用 `opencode.json`，Hermes 用 `config.yaml` + 嵌套分类目录，Antigravity 有独立 provider 目录——每换一个或新开一个 Harness，都要重新配一遍。
- **Skill 资产散落失控**：日常积累上百个 `SKILL.md` 后，分散在 `.agents`、`.hermes`、`.claude` 里，靠人工 `ln -s` 维护极易漏同步或污染上下文。
- **不知道“到底设好没有”**：改完配置文件并不代表目标 Harness 真的加载成功，常常出现某一家 OAuth `401` 或工具数对不上。
- **无头服务器 + 远程浏览器场景缺失**：后端跑在 Mac mini / Linux 服务器，用户在笔记本浏览器（如 T3 Code）里远程操控时，桌面端工具并不顺手。
- **协议断层**：实测本机 `Codex`、`OpenCode`、`Hermes`、`Antigravity` 目前均已兼容标准 MCP 网关，但**尚未支持** `MCP 2026-07-28` 的 `skills/list` 扩展协议——因此仅靠现有 MCPHub 无法真正管好你的 Skill。

---

## 核心体验

**像用“能力中转站”一样简单，让用户完全忘记底层路径和协议差异：**

1. **Skill / MCP 视角**：打开网页就能看到全机自动去重归纳好的所有 Skill（带原生归属标记，如 `Native: Hermes` / `Native: Codex` / `Shared Pool`）与 MCP 服务；点击开关或直接拖拽即可完成分配与收回。
2. **Harness 视角**：点开任意一个 Harness 卡片，一眼看到它当前拥有哪些 Skill 和 MCP，直接勾选增删或查看细粒度工具开关。
3. **一键整理与单真身去重**：内置 Skill 库整理向导，安全归并散落副本到共享池 `~/.agents/skills`、拍平多层套娃软链为一跳直连，并保留完整撤销归档。
4. **OAuth 凭证复用与绿灯真实校验**：支持复用 Hermes 默认 OAuth 登录态跨端下发，并一键触发无头探针验证 MCP 工具数、软链完整度与 `codex app-server` 真实加载状态。

---

## 项目阶段

已完成 **M0–M3 与 M4.1–M4.2**（发现引擎 + 四端适配器 + 拖拽矩阵 Web UI + 内置 MCP 网关与探针校验 + `launchd`/`systemd` 常驻守护 + 一键整理向导 + PWA 桌面应用安装 + 英文 Demo 沙盒与文档）。剩余待办为 **M4.3 Claude Code / Cursor 适配器**，详见 [docs/ROADMAP.md](docs/ROADMAP.md)。

### 零风险体验 Demo 沙盒

不影响本机真实配置，直接在临时目录启动全隔离演练环境：

```bash
pnpm install
pnpm build
pnpm demo
```

### 本机安装与常驻启动

```bash
pnpm install
pnpm test
pnpm build

# 交互式安装向导（可选仅本机 127.0.0.1 或远程 0.0.0.0、访问口令与开机自启）
node apps/server/dist/cli.js setup

# 或直接安装常驻后台服务（默认仅监听安全的 127.0.0.1:4310）
node apps/server/dist/cli.js service install
```

打开网页后，可通过 Chrome **将网页安装为应用** 一键做成独立桌面 App，无需每次输入端口。
