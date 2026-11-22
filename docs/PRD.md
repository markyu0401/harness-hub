# Product Requirements Document (PRD): HarnessHub

> **Status:** Draft v1.0 (Baseline Approved for M0)  
> **Owner:** markyu0401  
> **Target Environment:** Local-first / Headless Host (Mac mini / Linux) operated via Web Browser (MacBook / Tailscale)

---

## 1. Problem Statement & User Story

### 1.1 The Real Pain Point
A power user running multiple AI agent harnesses (**Codex**, **OpenCode**, **Antigravity**, **Hermes**, **Claude Code**) on a headless Mac mini accumulates:
- **130+ `SKILL.md` skills** scattered across `~/.agents/skills` (95), `~/.hermes/skills` (44), `~/.claude/skills` (16), `~/.config/opencode/skills` (16), `~/.gemini/config/skills` (5), and `~/.codex/skills` (0).
- **Multiple MCP servers** (`rea`, `hindsight`, `workspace`, `nasfiles`, `brightspace`, `kiwi`, `hugging_face`, plus future servers).
- **Shared CLI tools & rules** (e.g., `ego-browser`, `op-hermes`, `AGENTS.md`).

Today, wiring these across harnesses requires manual symlinks, editing heterogeneous config files (`toml`, `json`, `yaml`), repeating setup whenever a new harness is added, and manually checking whether each harness actually loaded the tools without errors (`401` OAuth drift, missing tools, broken symlinks).

### 1.2 Core User Vision
> *"Just like an LLM API relay/router, I want a **Skill & Tool Relay/Hub** with a dead-simple graphical Web UI:*
> - *For every Skill or MCP, I can assign it to Codex / OpenCode / Antigravity / Hermes with a single click or drag-and-drop.*
> - *For every Harness, I can see what Skills and MCPs it currently has, and drag capabilities in or out.*
> - *I should NEVER have to hunt down where files live on disk or choose between technical plumbing options."*

---

## 2. Goals & Non-Goals

### Goals
1. **Zero-File-Hunting Discovery**: Automatically scan all known harness directories on the host, deduplicate skills (by content hash / canonical name), inventory MCP servers, and present a unified catalog in a clean Web UI.
2. **Dual-Perspective Allocation UI**:
   - **By Capability (Skill / MCP)**: Toggle pills or drag cards onto Harness targets.
   - **By Harness**: Inspect a specific harness's assigned Skills, MCPs, and Rules; drag items in/out.
3. **One-Click Safe Apply (Atomic Sync)**: Write/update symlinks, per-harness MCP configurations, and fallback index automatically with automatic backup and rollback on error.
4. **Built-in MCP Gateway + Standard Fallback Skill Tool**:
   - Route future MCP servers through one unified local gateway with per-harness profiles and centralized secret/OAuth handling.
   - Expose unlinked/long-tail skills via a **standard `tools/call` MCP server** (`search_skills`, `read_skill`) so *every* MCP-capable harness can access the full library without bloating startup context or waiting for `MCP 2026-07-28`.
5. **Live Headless Verification ("Green Light Confidence")**: Run real probes against each harness (e.g., `codex app-server` `mcpServerStatus/list`, config/symlink health checks, HTTP MCP `/mcp` ping) and show live pass/fail status in the UI.
6. **Headless-First Web Architecture**: Run as a lightweight background daemon on the Mac mini, accessed from any browser over localhost or Tailscale.

### Non-Goals (for Prototype v1)
- Multi-tenant cloud SaaS or user login/billing systems.
- Unifying harness-proprietary JS/Python internal plugins/hooks (e.g., OpenCode JS plugins vs. Hermes curator internals) into a single runtime — v1 only displays their status/inventory.
- Requiring users to install a native macOS desktop app on the headless host.

---

## 3. Target Personas & Harnesses (v1)

| Harness | Primary User Usage | v1 Adapter Scope |
| :--- | :--- | :--- |
| **Codex** | Coding & CLI agent (`codex-cli`) | `~/.codex/skills` + `~/.codex/config.toml` + `codex app-server` live probe |
| **OpenCode** | Model-agnostic coding agent | `~/.config/opencode/skills` + `~/.config/opencode/opencode.json` |
| **Antigravity** | T3 Code / ACP agent | Antigravity `config/skills` + `mcp_config.json` |
| **Hermes** | Autonomous personal & devops agent | `~/.hermes/skills` + `~/.hermes/config.yaml` |
| **Claude Code** *(stretch in M2/M3)* | Terminal coding agent | `~/.claude/skills` + Claude MCP config |

---

## 4. Functional Requirements

### F1. Unified Discovery & Canonical Pool
- Scan existing skill folders (`~/.agents/skills`, `~/.hermes/skills`, `~/.claude/skills`, `~/.config/opencode/skills`, `~/.codex/skills`, `~/.gemini/config/skills`, T3 Antigravity config).
- Parse `SKILL.md` YAML frontmatter (`name`, `description`), detect duplicates/conflicts (e.g., same skill name with different content across Hermes and `.agents`), and let the user promote/consolidate into a canonical store (`~/.harness-hub/skills/` or `~/.agents/skills/`).
- Scan existing MCP definitions across Codex, OpenCode, Hermes, and Antigravity and merge into one catalog.

### F2. Interactive Web UI (Drag-and-Drop + Toggle Matrix)
- **Main Matrix / Split View**:
  - Left pane: Searchable, tag-filterable list of **Skills** and **MCP Servers** (with category badges, source origin, and "currently assigned to N harnesses" chips).
  - Right pane: **4 Harness Dropzones / Cards** (`Codex`, `OpenCode`, `Antigravity`, `Hermes`), showing active counts, health badge, and assigned items.
  - Interactions: Click harness pills inline on any row **OR** drag-and-drop capability cards onto a harness card.
- **Harness Detail Drawer**:
  - Inspect all Skills & MCPs assigned to one harness, toggle individual tools on/off (e.g., read-only mode for `nasfiles`), preview generated config diff before applying (optional "Advanced" toggle, hidden by default).
- **Skill / MCP Detail Drawer**:
  - Preview `SKILL.md` rendered Markdown, see attachments (`scripts/`, `references/`), or edit MCP URL/command/env-ref (`op://...` secret reference without showing plaintext).

### F3. Atomic Apply & Diff Engine
- Maintain canonical desired state in `~/.harness-hub/registry.yaml`.
- On **Apply**, compute exact filesystem & config diffs per harness adapter:
  - Create timestamped backups before modifying `config.toml` / `opencode.json` / `config.yaml` / `mcp_config.json`.
  - Only manage HarnessHub-owned symlinks/entries (preserve user's manual or harness-builtin items safely).
  - Support one-click **Rollback** to previous snapshot.

### F4. Built-in MCP Gateway & Standard Skill Search MCP
- Aggregate registered MCP servers (`stdio`, `Streamable HTTP`, `SSE`) behind per-harness gateway endpoints (e.g., `http://127.0.0.1:4310/mcp/:harness`).
- Filter exposed tools per harness according to matrix toggles.
- Automatically expose a built-in `harness-skills` MCP toolset (`list_skills`, `search_skills`, `read_skill`) using standard `tools/call` so any harness can access unpinned/long-tail skills on demand without needing `MCP 2026-07-28`.

### F5. Live Smoke Verification
- Trigger verification checks on demand (and optionally after Apply):
  - Symlink integrity & target `SKILL.md` readability check.
  - Codex live probe (`codex app-server` `mcpServerStatus/list`).
  - HTTP MCP endpoint reachability & tool count check.
  - Clear status indicators: `Healthy (Green)`, `Auth Required / 401 (Amber)`, `Error / Drift (Red)`.

---

## 5. Non-Functional Requirements
- **Safety First**: Never print or log plaintext secrets/tokens (`OP_SERVICE_ACCOUNT_TOKEN`, OAuth tokens, API keys). Support `op-hermes` / env-var references.
- **Non-Destructive Adoption**: First run in **Import / Audit Mode** — never delete or overwrite existing user skills/configs without explicit preview + user Apply.
- **Responsive UI**: Works cleanly on desktop and tablet/laptop viewports (`1280px+` and `768px+`), dark/light mode aligned with modern developer dashboards.
- **Zero Lock-In**: If HarnessHub is stopped, all synced native symlinks and configs continue working standalone (except gateway-routed MCPs unless direct fallback is used).
