# HarnessHub

> **The visual control plane for your AI coding agents' Skills, MCP servers, and Rules.**  
> Stop hunting through `~/.codex`, `~/.config/opencode`, `~/.hermes`, `~/.claude`, and `~/.gemini` to maintain fragile symlinks and duplicate configs. Manage once, assign with a click or drag-and-drop, and verify live readiness across every agent harness.

[简体中文](README.zh-CN.md) · [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [ADR-001](docs/adr/001-dual-channel-skill-distribution-and-mcp-compatibility.md)

---

## Why HarnessHub?

Modern AI engineers rarely stick to a single coding agent. You might use **Hermes** for daily autonomous workflows, **Codex** for deep coding, **OpenCode** for model-agnostic runs, **Antigravity** inside **T3 Code**, and **Claude Code** for quick tasks.

Meanwhile, model APIs already have unified routers (LiteLLM, OpenRouter, etc.), **but your Skills (`SKILL.md`), MCP tools, CLI guides, and Rules are still fragmented per harness**:

- Every harness stores skills and MCP configs in a different directory and format (`.toml`, `.json`, `.yaml`, symlinks).
- Adding a new harness means manually re-wiring everything from scratch — with zero guarantee it actually loaded correctly.
- Existing MCP gateways (like `MCPHub` or `MetaMCP`) route MCP servers well, but their beta `Skills over MCP` extension (`MCP 2026-07-28` `skills/list`) is **not yet supported** by current local builds of Codex, OpenCode, Hermes, or Antigravity.
- Desktop config tools don't fit **headless server setups** (e.g., running agents on a Mac mini / Linux box while operating from a laptop browser).

**HarnessHub solves this with one self-hosted Web UI and zero manual file-hunting.**

---

## Core Experience

- **Visual Allocation Matrix (Click or Drag & Drop)**  
  - **Skill / MCP View**: See every discovered `SKILL.md` (auto-deduplicated across `~/.agents`, `~/.hermes`, `~/.claude`, etc.) and MCP server, with instant toggles/drag targets for `Codex`, `OpenCode`, `Antigravity`, `Hermes`, and `Claude Code`.
  - **Harness View**: Open any harness card to see everything currently assigned to it, drag new capabilities in, or remove unused ones.
- **Zero Plumbing Exposed**  
  Users never pick between "symlinks vs. MCP extensions" — HarnessHub automatically handles native directory adapters + standard MCP fallback (`tools/call`) + unified credential injection under the hood.
- **Built-in MCP Gateway & Future-Proof Routing**  
  Manage MCP servers (local `stdio` and remote `Streamable HTTP` / `SSE`) in one place and expose tailored per-harness endpoints.
- **Real Headless Smoke Verification**  
  One-click live probe verifies what each harness *actually* loaded (e.g., `Codex: 4/4 MCPs, 18 Skills active`) instead of assuming a config file edit worked.

---

## Harness Compatibility Matrix (Verified Baseline)

| Harness | Config / Skill Format | Standard MCP Gateway | Native `SKILL.md` Sync | `MCP 2026-07-28` `skills/list` |
| :--- | :--- | :---: | :---: | :---: |
| **Codex** | `~/.codex/config.toml`, `~/.codex/skills` | ✅ Supported | ✅ Supported | ❌ Not yet |
| **OpenCode** | `~/.config/opencode/opencode.json`, `skills/` | ✅ Supported | ✅ Supported | ❌ Not yet |
| **Hermes** | `~/.hermes/config.yaml`, `~/.hermes/skills` | ✅ Supported | ✅ Supported | ❌ Not yet |
| **Antigravity** | `mcp_config.json`, `config/skills` | ✅ Supported | ✅ Supported | ❌ Not yet |
| **Claude Code** | `~/.claude/`, `~/.claude/skills` | ✅ Supported | ✅ Supported | ⚠️ Client-dependent |

See [ADR-001](docs/adr/001-dual-channel-skill-distribution-and-mcp-compatibility.md) for the technical audit behind this matrix.

---

## Planned Stack

- **Monorepo**: `pnpm` workspaces + TypeScript
- **Web UI**: React + Vite + Tailwind CSS + `@dnd-kit` (drag-and-drop & toggle matrix)
- **Control Plane & Gateway**: Node.js + Hono / Fastify + `@modelcontextprotocol/sdk`
- **State Store**: Canonical YAML/JSON registry (`~/.harness-hub/registry.yaml`) + SQLite for verification/audit logs

---

## Project Status

**Stage: Interactive Prototype Working (M1–M3 implemented, M4 daemonization upcoming).**  
Check [docs/ROADMAP.md](docs/ROADMAP.md) for milestones and open issues.

### Quick Start

```bash
pnpm install
pnpm test
pnpm build

# Interactive setup wizard (choose 127.0.0.1 local-only or 0.0.0.0 LAN/Tailscale + auto-start)
node apps/server/dist/cli.js setup

# Or install the persistent background service directly (defaults to 127.0.0.1:4310)
node apps/server/dist/cli.js service install
```

Then open `http://127.0.0.1:4310/` (or your LAN/Tailscale URL when remote access is enabled) and install it as a standalone desktop app via Chrome's **Install page as app** menu.

---

## Contributing

Contributions, adapter plugins for additional harnesses, and UX feedback are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before opening a PR.

## License

[MIT](LICENSE) © 2026 markyu0401
