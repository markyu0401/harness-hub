# Project Roadmap: HarnessHub

This roadmap breaks the project into 4 concrete milestones so every phase produces runnable, testable, verifiable software.

---

## M0: Foundation & Open-Source Setup
- [x] Initialize public GitHub repository (`markyu0401/harness-hub`, MIT License)
- [x] Author standardized documentation: `README.md`, `README.zh-CN.md`, `PRD.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `ADR-001`
- [x] Set up contributor templates (`CONTRIBUTING.md`, `AGENTS.md`, Issue/PR templates)
- [x] Initialize `pnpm` TypeScript monorepo skeleton + CI workflow (lint, typecheck, unit tests)

---

## M1: Discovery Engine & Safe Adapter Core (CLI + API Prototype)
**Goal:** Discover all real Skills & MCPs on the host, inspect diffs safely, and sync via clean TypeScript APIs (no UI yet, 100% unit + integration tested).

- [x] **M1.1** Canonical data model (`SkillItem`, `McpServerItem`, `HarnessId`, `AllocationMatrix`, `SyncPlan`)
- [x] **M1.2** Filesystem & config discovery scanner:
  - Scan `~/.agents/skills`, `~/.hermes/skills`, `~/.claude/skills`, `~/.config/opencode/skills`, `~/.codex/skills`, `~/.gemini/config/skills`, Antigravity `config/skills`
  - SHA-256 deduplication & conflict reporting
  - Parse existing MCP configs from Codex (`config.toml`), OpenCode (`opencode.json`), Hermes (`config.yaml`), Antigravity (`mcp_config.json`)
- [x] **M1.3** Harness Adapters (`CodexAdapter`, `OpenCodeAdapter`, `HermesAdapter`, `AntigravityAdapter`) with:
  - Timestamped backup before any write
  - `planSync()` dry-run diff + `applySync()` + `rollback()`
- [x] **M1.4** Standard `harness-skills` MCP server (`list_skills`, `search_skills`, `read_skill`) via `@modelcontextprotocol/sdk`
- [x] **Exit Gate**: Dry-run & real-directory integration test suite passes; non-destructive import generates `registry.yaml` from the live Mac mini without mutating unmanaged files.

---

## M2: Visual Matrix Web UI (Interactive Prototype)
**Goal:** Deliver the drag-and-drop & toggle Web UI accessible from any browser over localhost / Tailscale.

- [x] **M2.1** Backend HTTP API (`apps/server`) serving discovery, matrix updates, diff preview, and apply/rollback endpoints
- [x] **M2.2** Web UI (`apps/web`, React + Tailwind + `@dnd-kit`):
  - **Capability Matrix View**: Search, category filter, inline Harness toggle pills (`[Codex] [OpenCode] [AGY] [Hermes]`), and drag-and-drop onto Harness cards
  - **Harness Detail View**: Inspect everything assigned to a single Harness, toggle tools/skills, drag in/out
  - **Markdown Skill Inspector**: Click any skill to preview `SKILL.md` and attachments
  - **Apply Bar & Rollback History**: Clear pending changes count, one-click Apply, and snapshot restore
- [ ] **Exit Gate**: Live browser test (Playwright / preview verification) toggling and dragging a skill to Codex & OpenCode, applying, and confirming symlinks & configs update accurately.

---

## M3: Built-in MCP Gateway & Live Smoke Verification
**Goal:** Turn HarnessHub into a true runtime MCP relay with one-click "green light" verification across all 4 harnesses.

- [x] **M3.1** Unified MCP Gateway (`http://127.0.0.1:4310/mcp/:harness`) proxying `stdio` / `Streamable HTTP` / `SSE` upstream servers with per-harness tool filtering
- [x] **M3.2** Centralized secret reference resolution (e.g., `op-hermes` `op://...` injection at gateway runtime without writing plaintext secrets into harness configs)
- [x] **M3.3** Live Headless Verifier:
  - Codex `codex app-server` probe (`mcpServerStatus/list`)
  - Upstream MCP health & tool-count probe
  - Symlink & `SKILL.md` integrity probe
  - UI status badges (`Healthy` / `Auth 401` / `Error`)
- [x] **Exit Gate**: Add a test MCP server once in HarnessHub UI -> immediately visible & callable from Codex and OpenCode via gateway -> live verifier shows green status.

---

## M4: Polish, Daemonization & Open-Source Release
**Goal:** Make HarnessHub effortless for anyone to install and run on macOS or Linux.

- [x] **M4.1** `launchd` (macOS) / `systemd` (Linux) background service installer (`harness-hub service install`)
- [x] **M4.2** Consolidation wizard (helps clean up scattered duplicate skills into a single canonical pool safely)
- [ ] **M4.3** `Claude Code` & `Cursor` adapters
- [ ] **M4.4** `v0.1.0` GitHub Release, demo GIF/screenshots, and comprehensive setup guide
