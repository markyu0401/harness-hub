# ADR-001: Dual-Channel Skill Distribution & Standard MCP Compatibility

- **Date:** 2026-11-22
- **Status:** Accepted
- **Context:** Local audit of target harnesses on macOS (`arm64`)

---

## Context

While designing HarnessHub, we evaluated whether existing MCP gateways (specifically `samanhappy/mcphub`'s **"Skills over MCP"** feature) could serve as a single transport for both **MCP tools** and **`SKILL.md` skills** across our 4 target harnesses.

`MCPHub`'s `Skills over MCP` relies on the beta **MCP Skills Extension (`MCP 2026-07-28`)**, which introduces `skills/list`, `skills/get`, and `resources/read` semantics.

## Empirical Audit Results (2026-11-22)

We inspected the actual binaries, source trees, and configurations of all 4 target harnesses running on the host:

| Harness | Inspected Version | Standard MCP (`tools/list`, `tools/call`) | `MCP 2026-07-28` (`skills/list`) |
| :--- | :--- | :--- | :--- |
| **Codex** | `codex-cli 0.171.0-alpha.13` | ✅ `stdio` + `Streamable HTTP` | ❌ No `skills/list` / `modelcontextprotocol/skills` support found |
| **OpenCode** | `opencode v2.3.2` | ✅ `local` + `remote` HTTP/SSE | ❌ No `skills/list` / `modelcontextprotocol/skills` support found |
| **Hermes** | `Hermes Agent v0.23.3` | ✅ `stdio` + `sse` + `streamablehttp` | ❌ No `skills/list` / `modelcontextprotocol/skills` in `hermes-agent` source |
| **Antigravity** | `agy` (via T3 Code ACP) | ✅ Standard MCP (`tools/list`, `tools/call`) | ❌ Has `2026-07-28` version string, no `skills/list` capability |

## Decision

HarnessHub will **not** depend on the `MCP 2026-07-28` `skills/list` extension for v1. Instead, it will implement a **User-Invisible Dual-Channel Architecture**:

1. **Native Directory Sync (Primary Channel for Assigned Skills)**  
   Skills toggled ON for a harness in the UI are synced into that harness's native `skills/` directory via managed symlinks. This preserves 100% native progressive loading and trigger reliability today.
2. **Standard `tools/call` Skill Server (Universal Fallback & Long-Tail Channel)**  
   The full deduplicated catalog (130+ skills) is also exposed as ordinary MCP tools (`list_skills`, `search_skills`, `read_skill`) using standard `tools/list` + `tools/call` — which all 4 harnesses already support. This prevents bloating startup context with rarely used skills while ensuring universal access.
3. **Standard MCP Gateway for Tools**  
   All 4 harnesses support standard MCP tool routing, so MCP servers can be aggregated behind HarnessHub's gateway today.

## Consequences

- **Positive:** Works immediately across Codex, OpenCode, Hermes, and Antigravity without waiting for upstream client upgrades.
- **Positive:** End users never have to choose between technical channels in the UI — they simply toggle or drag skills to harnesses.
- **Future-Friendly:** Once target harnesses adopt `io.modelcontextprotocol/skills` (`skills/list`), HarnessHub can add an adapter capability flag to use it seamlessly without changing the UI or registry model.
