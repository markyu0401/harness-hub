# HarnessHub

> **面向多 Agent Harness 的可视化能力中枢（Skills + MCP 工具中转站）**  
> 告别在 `~/.codex`、`~/.config/opencode`、`~/.hermes`、`~/.claude`、`~/.gemini` 之间来回翻文件夹和手敲软链。在一个网页界面里统一盘点、点击或拖拽分配，并一键验证各 Harness 是否真实生效。

[English](README.md) · [产品需求文档 (PRD)](docs/PRD.md) · [技术架构](docs/ARCHITECTURE.md) · [开发路线图](docs/ROADMAP.md) · [架构决策 ADR-001](docs/adr/001-dual-channel-skill-distribution-and-mcp-compatibility.md)

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

## 我们想做到什么样的体验？

**像用“能力中转站”一样简单，让用户完全忘记底层路径和协议差异：**

1. **Skill / MCP 视角**：打开网页就能看到全机自动去重归纳好的所有 Skill 和 MCP；每行后面一排 Harness 开关（`Codex` / `OpenCode` / `Antigravity` / `Hermes`），**点一下或拖进去就分配，再点一下就收回**。
2. **Harness 视角**：点开任意一个 Harness 卡片，一眼看到它当前拥有哪些 Skill 和 MCP，直接拖拽增删。
3. **底层自动全包（无感双通道）**：用户无需纠结“软链”还是“MCP 协议”——应用变更时，系统自动完成各家原生目录同步、统一 MCP 网关下发与安全检查。
4. **绿灯真实校验**：一键触发各家无头探针，直接显示实际加载到的 MCP 工具数和 Skill 数量，告别盲猜。

---

## 项目阶段

当前已完成 **M1–M3 可运行原型（发现引擎 + 四端适配器 + 拖拽矩阵 Web UI + 内置 MCP 网关与探针校验）**，后续将推进 **M4 后台守护进程与向导完善**。详见 [ROADMAP.md](docs/ROADMAP.md)。

### 快速启动

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

## 开源协议

[MIT](LICENSE) © 2026 markyu0401
