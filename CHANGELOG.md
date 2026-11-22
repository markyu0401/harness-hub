# Changelog

All notable changes to HarnessHub are documented in this file.

## [0.1.0-rc] - Unreleased (Preparing v0.1.0)

### Added
- **Multi-Harness Discovery & Origin Attribution (`@harness-hub/core`)**: Automatic discovery across Codex, OpenCode, Hermes, Antigravity, Claude, Gemini, and shared `~/.agents/skills`, with SHA-256 deduplication, divergent conflict reporting, nested category support, and portability linting.
- **Safe Bidirectional Sync Adapters**: Inspectable `SyncPlan` preview, timestamped pre-mutation backups, manifest-tracked symlinks, and structured TOML/JSON/YAML config syncing for Codex, OpenCode, Hermes, and Antigravity.
- **One-Click Skill Library Organizer**: Safely consolidates scattered duplicates into `~/.agents/skills`, flattens multi-hop symlinks, preserves nested categories, and supports full undo archives.
- **Built-in Streamable HTTP MCP Gateway & Skill Fallback (`@harness-hub/server`, `@harness-hub/skills-mcp`)**: Per-harness endpoints (`/mcp/:harness`) with tool filtering (`disabledTools`), runtime secret injection (`${ENV}` and `op://`), shared Hermes OAuth token reuse/refresh, and standard MCP `tools/call` skill access (`list_skills`, `search_skills`, `read_skill`).
- **Live Headless Verifier**: Probes upstream HTTP/Gateway MCPs, symlink/config integrity, and `codex app-server` readiness.
- **Visual Allocation Matrix Web UI (`@harness-hub/web`)**: React + Tailwind + `@dnd-kit` drag-and-drop and toggle matrix, Origin & Category filters, Markdown `SKILL.md` & portability inspector, Apply Diff & Rollback History, Settings panel (`127.0.0.1` vs `0.0.0.0` + `scrypt` passcode), and installable PWA app support.
- **Daemon Installer & Isolated English Demo**: Cross-platform `launchd` / `systemd --user` service installer (`setup` & `service` CLI) and zero-risk sandbox (`pnpm demo`).
