# Architecture Design: HarnessHub

## 1. High-Level Architecture

HarnessHub follows a **Local Control Plane + Adapter Sync + Unified MCP Gateway** architecture designed for a headless host (Mac mini / Linux) controlled from a remote browser.

```
                   +-----------------------------------+
                   |     Browser Web UI (MacBook)      |
                   |  - Drag & Drop / Toggle Matrix    |
                   |  - Harness Health & Diff Viewer   |
                   +-----------------+-----------------+
                                     | HTTP / WebSocket (Tailscale / localhost:4310)
                   +-----------------v-----------------+
                   |    HarnessHub Server (Node/TS)    |
                   |                                   |
                   |  +-----------------------------+  |
                   |  | Canonical Registry & Store  |  |
                   |  |  (~/.harness-hub/registry)  |  |
                   |  +--------------+--------------+  |
                   |                 |                 |
                   |  +--------------v--------------+  |
                   |  |  Discovery & Dedup Scanner  |  |
                   |  +--------------+--------------+  |
                   |                 |                 |
                   |  +--------------v--------------+  |
                   |  |   Harness Adapter Engine    |  |
                   |  | (Codex/OpenCode/AGY/Hermes) |  |
                   |  +--------------+--------------+  |
                   |                 |                 |
                   |  +--------------v--------------+  |
                   |  |  MCP Gateway + Skill MCP    |  |
                   |  |  (/mcp/:harness endpoints)  |  |
                   |  +--------------+--------------+  |
                   |                 |                 |
                   |  +--------------v--------------+  |
                   |  |   Live Headless Verifier    |  |
                   |  +-----------------------------+  |
                   +--+-------+-------+--------+----+--+
                      |       |       |        |
        +-------------+   +---+       +----+   +-------------+
        v                 v                v                 v
  ~/.codex/         ~/.config/opencode/   Antigravity     ~/.hermes/
  - config.toml     - opencode.json       - mcp_config    - config.yaml
  - skills/         - skills/             - config/skills - skills/
```

---

## 2. Core Subsystems

### 2.1 Discovery & Deduplication Scanner (`packages/core/src/discovery`)
- Scans configured and well-known paths for `SKILL.md` packages and MCP definitions.
- Computes SHA-256 fingerprints across `SKILL.md` + supporting files so identical skills linked in multiple places collapse into **one canonical catalog entry** with provenance tags (e.g., `origin: ~/.agents/skills/brainstorming`, `linkedIn: [opencode, hermes]`).
- Flags **divergent duplicates** (same name, different content) so the user can inspect and pick a winner instead of silently overwriting.

### 2.2 Canonical Registry (`~/.harness-hub/registry.yaml`)
Single source of truth storing:
- `skills`: canonical location, tags, mode (`native` | `on-demand-mcp` | `disabled` per harness).
- `mcps`: transport (`stdio` | `http` | `sse`), URL/command, secret references (never raw secrets in plain UI logs), tool allow/deny lists.
- `harnesses`: adapter type, paths, gateway profile name, last verified timestamp & status.

### 2.3 Harness Adapter Engine (`packages/core/src/adapters`)
Every harness implements a strict `HarnessAdapter` interface:

```ts
export interface HarnessAdapter {
  id: HarnessId; // 'codex' | 'opencode' | 'antigravity' | 'hermes' | 'claude'
  displayName: string;
  detect(): Promise<HarnessDetectionResult>;
  readCurrentState(): Promise<HarnessCurrentState>;
  planSync(desired: HarnessDesiredState): Promise<SyncPlan>;
  applySync(plan: SyncPlan, backupDir: string): Promise<ApplyResult>;
  verifyLive(): Promise<VerificationResult>;
}
```

Key safety invariants for every adapter:
1. **Scoped Ownership**: Track managed symlinks via a `.harness-hub-manifest.json` or marker prefix; never delete unmanaged user/builtin skills without explicit user action.
2. **Format-Preserving Edits**: Use proper AST/object merging for TOML (`@iarna/toml` or `smol-toml`), JSON (`opencode.json`, `mcp_config.json`), and YAML (`~/.hermes/config.yaml`), always writing a timestamped backup first.
3. **Dry-Run Planning**: Every `applySync` starts from an inspectable `SyncPlan` (created symlinks, removed symlinks, config keys changed).

### 2.4 Dual-Channel Skill Distribution (Hidden from End User)
Because current builds of Codex, OpenCode, Hermes, and Antigravity do **not** implement `MCP 2026-07-28` (`skills/list`) — see [ADR-001](adr/001-dual-channel-skill-distribution-and-mcp-compatibility.md) — HarnessHub transparently combines two proven mechanisms:
1. **Native Sync (Assigned Skills)**: Any skill toggled ON for a harness is synced into that harness's native `skills/` directory so native progressive loading and trigger matching work at 100% fidelity.
2. **Fallback Skill-Search MCP (`harness-skills`)**: All cataloged skills (including long-tail ones not pinned to a harness's startup directory to save context tokens) are served via a standard `tools/call` MCP server (`search_skills`, `read_skill`), automatically registered as a single lightweight MCP entry.

### 2.5 Built-in MCP Gateway (`apps/server/src/gateway`)
- Connects to upstream MCP servers (`stdio`, `Streamable HTTP`, `SSE`) once, keeping long-lived sessions/auth centralized.
- Exposes per-harness endpoints (`/mcp/codex`, `/mcp/opencode`, `/mcp/antigravity`, `/mcp/hermes`) using `@modelcontextprotocol/sdk`.
- Applies per-harness tool filtering (allowlist/denylist) dynamically.
- **Direct Mode Fallback**: Optionally allows writing direct server entries (instead of gateway URLs) for harnesses or tools where direct stdio/OAuth is preferred.

### 2.6 Live Headless Verifier (`packages/core/src/verifier`)
- **Codex**: Spawns `codex app-server --listen stdio://`, calls `initialize` + `mcpServerStatus/list`, verifies exact loaded tool counts and flags `401` / auth errors.
- **OpenCode / Hermes / Antigravity**: Verifies config parseability, symlink targets, upstream MCP `initialize` + `tools/list` reachability, and CLI health probes where available.

---

## 3. Monorepo Layout

```text
harness-hub/
├── apps/
│   ├── server/          # Fastify/Hono API + WebSocket events + MCP Gateway
│   └── web/             # React + Vite + Tailwind + dnd-kit Web UI
├── packages/
│   ├── core/            # Types, Discovery Scanner, Registry, Adapters, Verifier
│   └── skills-mcp/      # Standard tools/call MCP server for long-tail skills
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── adr/
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```
