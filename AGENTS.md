# AGENTS.md — Coding & Collaboration Standards for HarnessHub

This file defines repository-wide standards for AI coding agents and human contributors working on **HarnessHub**.

## Core Principles

1. **Safety Over Magic**: Never mutate real user harness configs (`~/.codex`, `~/.config/opencode`, `~/.hermes`, `~/.claude`, `~/.gemini`, `~/.t3`) during automated tests. Always test against temporary directories (`mkdtemp`) or isolated fixtures.
2. **Never Leak Secrets**: Never log, commit, or print API keys, OAuth tokens, or resolved `op://` secret values. Store only secret references (`env`, `op://Vault/Item/Field`) in `registry.yaml` and UI responses.
3. **Dry-Run & Backup Always**: Every adapter `applySync()` must be derived from an inspectable `SyncPlan` and write a timestamped backup prior to mutating existing files.
4. **Scoped Ownership**: HarnessHub only removes or updates symlinks and config entries that it manages (tracked in manifest/metadata). Unmanaged user files and harness builtins must remain untouched.
5. **No Technical Jargon Leakage to End Users**: Keep plumbing (symlinks vs. standard MCP fallback vs. gateway routing) abstracted behind clean UI actions ("Assign to Codex", "Verify Live").
6. **Verify Before Claiming Done**: Run typecheck, unit tests, and build/smoke checks after final edits and report exact observed results.

## Documentation Map

- Product vision & user requirements: [docs/PRD.md](docs/PRD.md)
- System architecture & interfaces: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Phased milestones: [docs/ROADMAP.md](docs/ROADMAP.md)
- Technical decisions: [docs/adr/](docs/adr/)

## Commit Convention

Use Conventional Commits:
- `feat(core): ...`
- `feat(web): ...`
- `fix(adapter-codex): ...`
- `docs: ...`
- `test: ...`
