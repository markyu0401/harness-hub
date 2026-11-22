# HarnessHub Setup Guide

HarnessHub is a **local-first visual control plane** for managing Skills (`SKILL.md`), MCP servers, and live readiness across **Codex**, **OpenCode**, **Hermes**, and **Antigravity**.

> **Safe by default**: HarnessHub creates timestamped backups before modifying harness configs, tracks only manifest-owned symlinks/entries, keeps resolved secrets out of config files, and binds to `127.0.0.1` unless you explicitly enable remote access.

---

## 1. Prerequisites

- **Node.js** `>= 22.0.0`
- **pnpm** `10.x`
- One or more supported agent harnesses installed locally (Codex, OpenCode, Hermes, or Antigravity)

---

## 2. Try the Isolated English Demo First (Zero Risk)

Before touching your real `~/.codex`, `~/.config/opencode`, `~/.hermes`, or Antigravity configs, you can explore every workflow inside an isolated temporary sandbox:

```bash
pnpm install
pnpm build
pnpm demo
```

Then open **`http://127.0.0.1:4319/`** in your browser.

The demo sandbox populates realistic English sample skills, nested Hermes categories, duplicate copies for the **Organize** wizard, synthetic Hermes OAuth entries, and local mock HTTP MCP servers in a temporary directory that is automatically deleted when you press `Ctrl+C`.

---

## 3. Install & Configure for Your Machine

```bash
pnpm install
pnpm build
```

Run the interactive setup wizard:

```bash
node apps/server/dist/cli.js setup
```

The wizard configures:

1. **Network Binding**:
   - `127.0.0.1` (**Local-only**, recommended default for laptops/desktops)
   - `0.0.0.0` (**LAN / Tailscale**, ideal for headless servers like a Mac mini or Linux home server controlled from a remote laptop browser)
2. **Port**: Defaults to `4310`.
3. **Optional Access Passcode**: When binding `0.0.0.0`, set a browser unlock passcode (stored as a salted `scrypt` hash in `~/.harness-hub/settings.json`).
4. **Background Service Auto-Start**: Installs a persistent daemon via `launchd` (macOS) or `systemd --user` (Linux).

---

## 4. Background Service Commands

You can install or manage the background daemon at any time:

```bash
# Install and start persistent background service
node apps/server/dist/cli.js service install

# Check current service state and log path
node apps/server/dist/cli.js service status

# Restart after rebuilding or changing settings
node apps/server/dist/cli.js service restart

# Stop and remove the background service
node apps/server/dist/cli.js service uninstall
```

On **macOS**, this writes `~/Library/LaunchAgents/dev.harness-hub.server.plist`.  
On **Linux**, this writes `~/.config/systemd/user/harness-hub.service` (using `systemctl --user`).

To run in the foreground instead (useful for debugging):

```bash
node apps/server/dist/cli.js serve --host 127.0.0.1 --port 4310
```

You can also override directories and binding via environment variables:

- `HARNESS_HUB_HOME`: Override home directory discovery root
- `HARNESS_HUB_DIR`: Override `~/.harness-hub` state/backup directory
- `HARNESS_HUB_HOST`: Override bind address (`127.0.0.1` or `0.0.0.0`)
- `HARNESS_HUB_PORT`: Override HTTP port

---

## 5. Install as a Standalone Desktop App (PWA)

HarnessHub ships with a web app manifest and service worker so you do not need to bookmark localhost ports:

1. Open HarnessHub in **Google Chrome** or **Microsoft Edge** (`http://127.0.0.1:4310/` or your Tailscale/LAN URL).
2. Click the **Install App** button in the top bar (or open Chrome's menu → **Cast, save, and share** → **Install page as app...**).
3. Launch **HarnessHub** directly from your macOS Applications folder / Dock / Linux app launcher.

---

## 6. Daily Workflow

1. **Discover & Review**: HarnessHub scans `~/.agents/skills`, `~/.hermes/skills`, `~/.config/opencode/skills`, `~/.codex/skills`, `~/.claude/skills`, and Antigravity configs, deduplicating identical skills by SHA-256 while preserving native owner badges (`Native: Hermes`, `Native: Codex`, etc.).
2. **Assign Skills & MCPs**: Click harness toggle pills or drag capability cards onto `Codex`, `OpenCode`, `Antigravity`, or `Hermes`.
3. **Preview Diff & Apply**: Click **Apply Changes** to inspect exact filesystem/config diffs. HarnessHub automatically writes a timestamped snapshot under `~/.harness-hub/backups/` before applying.
4. **Consolidate Scattered Skills (Optional)**: Click **Organize** to safely move duplicate copies into `~/.agents/skills`, flatten multi-hop symlinks to 1 hop, preserve nested categories, and keep an undo archive.
5. **Route & Verify Live**:
   - Use **Direct** or **Gateway** mode (`http://127.0.0.1:4310/mcp/{codex,opencode,antigravity,hermes}`) per MCP server and per harness.
   - Store secrets only as references (`${ENV_VAR}` or `op://Vault/Item/Field`), or reuse Hermes default OAuth tokens across harnesses.
   - Click **Verify Live** to run headless health checks (`codex app-server`, HTTP/Gateway MCP probes, and symlink integrity checks).
6. **Instant Rollback**: Open **History** at any time to restore any previous snapshot.

---

## 7. Settings & Remote Access

Open **Settings** directly from the Web UI top bar to switch between **Local only (`127.0.0.1`)** and **LAN / Tailscale (`0.0.0.0`)**, set or clear the browser passcode, toggle live verification after apply, toggle the fallback `@harness-hub/skills-mcp` exposure, or restart/manage the daemon.
