import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analyzeSkillPortability,
  applyLibraryOrganization,
  buildDesiredStateForHarness,
  createAdapters,
  discoverAndMergeRegistry,
  getHermesOAuthStatus,
  getServiceStatus,
  hashPasscode,
  inferSkillCategory,
  installBackgroundService,
  listBackupSnapshots,
  loadRegistry,
  loadSettings,
  maskRecordForUi,
  parseSkillFrontmatter,
  planLibraryOrganization,
  probeCodexAppServer,
  renderLaunchdPlist,
  renderSystemdUnit,
  resolveBindHost,
  resolveHermesOAuthHeader,
  resolveHostPaths,
  resolveRuntimeSecrets,
  restoreBackupSnapshot,
  sanitizeRecordForStorage,
  saveRegistry,
  saveSettings,
  undoLibraryOrganization,
  uninstallBackgroundService,
  verifyPasscode,
} from '../index.js';

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-hub-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('HarnessHub Core: Discovery, Deduplication, Secrets & Adapters', () => {
  it('scans multi-harness skills, deduplicates identical SHA-256, and flags conflicts', async () => {
    const home = await makeTempHome();

    // Shared canonical skill in ~/.agents/skills/brainstorming
    const agentsBrain = path.join(home, '.agents', 'skills', 'brainstorming');
    await fs.mkdir(path.join(agentsBrain, 'scripts'), { recursive: true });
    await fs.writeFile(
      path.join(agentsBrain, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Structured idea exploration\ntags: [planning]\n---\n\n# Brainstorming\n',
      'utf8'
    );
    await fs.writeFile(path.join(agentsBrain, 'scripts', 'helper.sh'), '#!/bin/sh\necho ok\n');

    // Symlink in ~/.config/opencode/skills/brainstorming -> agentsBrain (should deduplicate cleanly!)
    const ocSkills = path.join(home, '.config', 'opencode', 'skills');
    await fs.mkdir(ocSkills, { recursive: true });
    await fs.symlink(agentsBrain, path.join(ocSkills, 'brainstorming'), 'dir');

    // Nested Hermes skill in ~/.hermes/skills/devops/docker-helper
    const hermesDocker = path.join(home, '.hermes', 'skills', 'devops', 'docker-helper');
    await fs.mkdir(hermesDocker, { recursive: true });
    await fs.writeFile(
      path.join(hermesDocker, 'SKILL.md'),
      '---\nname: docker-helper\ndescription: Manage containers\n---\n\n# Docker\n',
      'utf8'
    );

    // Divergent duplicate conflict: ~/.hermes/skills/brainstorming (different content!)
    const hermesBrain = path.join(home, '.hermes', 'skills', 'brainstorming');
    await fs.mkdir(hermesBrain, { recursive: true });
    await fs.writeFile(
      path.join(hermesBrain, 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Divergent Hermes copy\n---\n\n# Different\n',
      'utf8'
    );

    const paths = resolveHostPaths({ homeDir: home });
    const registry = await discoverAndMergeRegistry(paths);

    expect(registry.skills.map((s) => s.id)).toEqual(['brainstorming', 'docker-helper']);
    const brain = registry.skills.find((s) => s.id === 'brainstorming')!;
    expect(brain.originSource).toBe('agents');
    expect(brain.attachments).toEqual(['scripts/helper.sh']);
    expect(brain.locations.length).toBe(3);

    expect(registry.conflicts).toHaveLength(1);
    expect(registry.conflicts[0]!.id).toBe('brainstorming');
    expect(registry.conflicts[0]!.variants).toHaveLength(2);

    const docker = registry.skills.find((s) => s.id === 'docker-helper')!;
    expect(docker.category).toBe('devops');
    expect(registry.allocations.skills['brainstorming']?.opencode).toBe(true);
    expect(registry.allocations.skills['brainstorming']?.codex).toBe(false);
  });

  it('sanitizes inline secrets on MCP import and resolves op:// + env refs only at runtime', async () => {
    const home = await makeTempHome();
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.codex', 'config.toml'),
      [
        'model = "gpt-5"',
        '',
        '[mcp_servers.node_repl]',
        'command = "/bin/node_repl"',
        '',
        '[mcp_servers.hindsight]',
        'url = "http://127.0.0.1:8888/mcp"',
        'http_headers = { "X-Bank-Id" = "hermes", "Authorization" = "Bearer sk-raw-secret-1234567890" }',
        'enabled_tools = ["recall"]',
      ].join('\n'),
      'utf8'
    );

    const paths = resolveHostPaths({ homeDir: home });
    const registry = await discoverAndMergeRegistry(paths);

    // Builtin node_repl must not be imported into catalog
    expect(registry.mcps.map((m) => m.id)).toEqual(['hindsight']);
    const hindsight = registry.mcps[0]!;
    expect(hindsight.headers?.['X-Bank-Id']).toBe('hermes');
    expect(hindsight.headers?.['Authorization']).toBe('${AUTHORIZATION}');
    expect(JSON.stringify(registry)).not.toContain('sk-raw-secret-1234567890');

    const sanitized = sanitizeRecordForStorage({
      API_KEY: 'sk-test-value-abcdefg123456',
      OP_REF: 'op://Hermes/Test/token',
      JAVA_HOME: '/usr/lib/jvm',
    });
    expect(sanitized).toEqual({
      API_KEY: '${API_KEY}',
      OP_REF: 'op://Hermes/Test/token',
      JAVA_HOME: '/usr/lib/jvm',
    });

    const masked = maskRecordForUi({
      TOKEN: 'raw-token-xyz',
      OP_REF: 'op://Hermes/Test/token',
    });
    expect(masked).toEqual({
      TOKEN: '<redacted>',
      OP_REF: 'op://Hermes/Test/token',
    });

    const resolved = await resolveRuntimeSecrets(
      {
        OP_REF: 'op://Hermes/Demo/secret',
        ENV_REF: '${MY_TEST_ENV}',
      },
      {
        env: { MY_TEST_ENV: 'from-env' },
        opReader: async (ref) => `resolved:${ref}`,
      }
    );
    expect(resolved).toEqual({
      OP_REF: 'resolved:op://Hermes/Demo/secret',
      ENV_REF: 'from-env',
    });
  });

  it('plans, backs up, applies, preserves unmanaged entries, and rolls back across all 4 adapters', async () => {
    const home = await makeTempHome();
    const paths = resolveHostPaths({ homeDir: home });

    // Create canonical skill + unmanaged user skill in codex
    const skillDir = path.join(home, '.agents', 'skills', 'ego-browser');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: ego-browser\ndescription: Browser CLI\n---\n# Ego Browser\n'
    );

    await fs.mkdir(path.join(home, '.codex', 'skills', 'my-manual-skill'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.codex', 'skills', 'my-manual-skill', 'SKILL.md'),
      '# Manual\n'
    );
    await fs.writeFile(
      path.join(home, '.codex', 'config.toml'),
      'model = "gpt-5"\n\n[mcp_servers.node_repl]\ncommand = "/bin/node"\n'
    );

    await fs.mkdir(path.join(home, '.config', 'opencode'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: {} }, null, 2)
    );

    await fs.mkdir(path.join(home, '.hermes'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.hermes', 'config.yaml'),
      '# Hermes user comment\nmodel: claude\nmcp_servers: {}\n'
    );

    await fs.mkdir(path.join(home, '.gemini', 'antigravity'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
      JSON.stringify({ mcpServers: {} }, null, 2)
    );

    let registry = await discoverAndMergeRegistry(paths);
    registry.mcps.push({
      id: 'workspace',
      name: 'workspace',
      transport: 'http',
      url: 'http://127.0.0.1:8000/mcp',
      authType: 'none',
      discoveredIn: [],
    });

    for (const h of ['codex', 'opencode', 'antigravity', 'hermes'] as const) {
      registry.allocations.skills['ego-browser']![h] = true;
      registry.allocations.mcps['workspace'] = {
        ...registry.allocations.mcps['workspace'],
        [h]: { enabled: true, mode: 'direct' },
      };
    }

    await saveRegistry(paths.registryPath, registry);
    const reloaded = await loadRegistry(paths.registryPath, paths);
    expect(reloaded.mcps).toHaveLength(1);

    const adapters = createAdapters(paths);

    // Dry-run plan + apply for all 4 adapters
    const backupIds: string[] = [];
    for (const h of ['codex', 'opencode', 'antigravity', 'hermes'] as const) {
      const desired = buildDesiredStateForHarness(reloaded, h, { includeGateway: false });
      const plan = await adapters[h].planSync(desired);
      expect(plan.hasChanges).toBe(true);
      const res = await adapters[h].applySync(plan, paths.backupsDir);
      expect(res.errors).toEqual([]);
      if (res.backupId) backupIds.push(res.backupId);
    }

    // Verify symlinks exist and unmanaged Codex skill & node_repl remain untouched!
    const codexSkillStat = await fs.lstat(path.join(home, '.codex', 'skills', 'ego-browser'));
    expect(codexSkillStat.isSymbolicLink()).toBe(true);
    const manualExists = await fs.stat(path.join(home, '.codex', 'skills', 'my-manual-skill'));
    expect(manualExists.isDirectory()).toBe(true);

    const codexToml = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(codexToml).toContain('[mcp_servers.node_repl]');
    expect(codexToml).toContain('[mcp_servers.workspace]');

    const hermesYaml = await fs.readFile(path.join(home, '.hermes', 'config.yaml'), 'utf8');
    expect(hermesYaml).toContain('# Hermes user comment');
    expect(hermesYaml).toContain('workspace:');

    // Now toggle OFF ego-browser + workspace on Codex and apply -> managed items removed, unmanaged preserved
    reloaded.allocations.skills['ego-browser']!.codex = false;
    reloaded.allocations.mcps['workspace']!.codex!.enabled = false;
    const codexTurnOffPlan = await adapters.codex.planSync(
      buildDesiredStateForHarness(reloaded, 'codex', { includeGateway: false })
    );
    await adapters.codex.applySync(codexTurnOffPlan, paths.backupsDir);

    await expect(fs.lstat(path.join(home, '.codex', 'skills', 'ego-browser'))).rejects.toThrow();
    const codexTomlAfterOff = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(codexTomlAfterOff).toContain('[mcp_servers.node_repl]');
    expect(codexTomlAfterOff).not.toContain('[mcp_servers.workspace]');

    // Verify backup list & rollback restores previous codex config
    const snapshots = await listBackupSnapshots(paths.backupsDir);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    const codexSnapshot = snapshots.find((s) => s.harnesses.includes('codex'))!;
    await restoreBackupSnapshot(paths.backupsDir, codexSnapshot.id);
    const codexAfterRollback = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(codexAfterRollback).toContain('[mcp_servers.workspace]');
  });

  it('flags Hermes-specific tool/path dependencies and missing frontmatter via analyzeSkillPortability', () => {
    const clean = analyzeSkillPortability({
      hasName: true,
      hasDescription: true,
      body: '# Generic\nUse standard steps.\n',
      attachments: [],
    });
    expect(clean.status).toBe('portable');
    expect(clean.warnings).toEqual([]);

    const hermesOnly = analyzeSkillPortability({
      hasName: true,
      hasDescription: true,
      body: 'Run `execute_code` and read `~/.hermes/config.yaml`.\n',
      attachments: ['scripts/run.sh'],
    });
    expect(hermesOnly.status).toBe('caution');
    expect(hermesOnly.warnings.map((w) => w.code)).toEqual([
      'hermes_tool_ref',
      'hermes_path_ref',
      'has_scripts',
    ]);

    const incomplete = analyzeSkillPortability({
      hasName: false,
      hasDescription: false,
      body: '# No frontmatter\n',
      attachments: [],
    });
    expect(incomplete.status).toBe('incomplete');

    const hermesFrontmatter = parseSkillFrontmatter(
      '---\nname: trace\ndescription: Observe runs\nmetadata:\n  hermes:\n    category: devops\n    tags: [tracing]\n---\nBody'
    );
    expect(hermesFrontmatter.meta.category).toBe('devops');
    expect(hermesFrontmatter.meta.tags).toEqual(['tracing']);

    expect(
      inferSkillCategory({
        id: 'playwright-runner',
        name: 'playwright-runner',
        description: 'Automate headless browser tests',
        tags: [],
      })
    ).toBe('browser');
  });

  it('probes Codex app-server for both mcpServerStatus/list and skills/list', async () => {
    const dir = await makeTempHome();
    const fakeCodex = path.join(dir, 'fake-codex.mjs');
    await fs.writeFile(
      fakeCodex,
      [
        '#!/usr/bin/env node',
        'let buf = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => {',
        '  buf += chunk;',
        '  const lines = buf.split("\\n");',
        '  buf = lines.pop() ?? "";',
        '  for (const line of lines) {',
        '    if (!line.trim()) continue;',
        '    const msg = JSON.parse(line);',
        '    if (msg.method === "initialize") {',
        '      console.log(JSON.stringify({ id: msg.id, result: {} }));',
        '    } else if (msg.method === "mcpServerStatus/list") {',
        '      console.log(JSON.stringify({ id: msg.id, result: { data: [{ name: "hindsight", authStatus: "ok", tools: { recall: {} } }] } }));',
        '    } else if (msg.method === "skills/list") {',
        '      console.log(JSON.stringify({ id: msg.id, result: { data: [{ cwd: "/tmp", skills: [{ name: "ego-browser", enabled: true }, { name: "disabled-one", enabled: false }] }] } }));',
        '    }',
        '  }',
        '});',
      ].join('\n'),
      { mode: 0o755 }
    );

    const prevSkip = process.env.HARNESS_HUB_SKIP_CODEX_CLI;
    const prevBin = process.env.HARNESS_HUB_CODEX_BIN;
    delete process.env.HARNESS_HUB_SKIP_CODEX_CLI;
    process.env.HARNESS_HUB_CODEX_BIN = fakeCodex;
    try {
      const probe = await probeCodexAppServer(4000);
      expect(probe.mcpProbes).toHaveLength(1);
      expect(probe.mcpProbes[0]!.id).toBe('hindsight');
      expect(probe.loadedSkillNames).toEqual(['ego-browser']);
    } finally {
      if (prevSkip !== undefined) process.env.HARNESS_HUB_SKIP_CODEX_CLI = prevSkip;
      if (prevBin !== undefined) process.env.HARNESS_HUB_CODEX_BIN = prevBin;
      else delete process.env.HARNESS_HUB_CODEX_BIN;
    }
  });

  it('plans, applies, and undoes library organization (duplicate physicals, chained & broken symlinks, adopt)', async () => {
    const home = await makeTempHome();
    const skillContent = '---\nname: clean-skill\ndescription: Shared skill\n---\n# Clean\n';

    // Canonical copy in ~/.agents/skills/clean-skill
    const agentsDir = path.join(home, '.agents', 'skills', 'clean-skill');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(path.join(agentsDir, 'SKILL.md'), skillContent);

    // Duplicate physical copy with identical content in ~/.hermes/skills/clean-skill
    const hermesDup = path.join(home, '.hermes', 'skills', 'clean-skill');
    await fs.mkdir(hermesDup, { recursive: true });
    await fs.writeFile(path.join(hermesDup, 'SKILL.md'), skillContent);

    // Chained symlink in ~/.config/opencode/skills/clean-skill -> hermesDup (should flatten to agentsDir!)
    const ocSkills = path.join(home, '.config', 'opencode', 'skills');
    await fs.mkdir(ocSkills, { recursive: true });
    await fs.symlink(hermesDup, path.join(ocSkills, 'clean-skill'), 'dir');

    // Broken symlink in ~/.codex/skills/ghost
    const codexSkills = path.join(home, '.codex', 'skills');
    await fs.mkdir(codexSkills, { recursive: true });
    await fs.symlink(path.join(home, 'non-existent-target'), path.join(codexSkills, 'ghost'), 'dir');

    const paths = resolveHostPaths({ homeDir: home });
    const registry = await discoverAndMergeRegistry(paths);
    const plan = await planLibraryOrganization(paths, registry);

    expect(plan.hasChanges).toBe(true);
    expect(plan.counts.duplicateCopies).toBe(1);
    expect(plan.counts.chainedSymlinks).toBe(1);
    expect(plan.counts.brokenSymlinks).toBe(1);
    expect(plan.counts.adoptableSymlinks).toBe(1);

    const applied = await applyLibraryOrganization(paths, plan);
    expect(applied.errors).toEqual([]);
    expect(applied.archiveId).toBeTruthy();

    // Verify duplicate became 1-hop symlink to agentsDir, opencode flattened to agentsDir, ghost removed
    const hermesStat = await fs.lstat(hermesDup);
    expect(hermesStat.isSymbolicLink()).toBe(true);
    expect(await fs.readlink(hermesDup)).toBe(await fs.realpath(agentsDir));
    expect(await fs.readlink(path.join(ocSkills, 'clean-skill'))).toBe(await fs.realpath(agentsDir));
    await expect(fs.lstat(path.join(codexSkills, 'ghost'))).rejects.toThrow();

    // Undo restores the archived physical folder and broken link
    const undone = await undoLibraryOrganization(paths, applied.archiveId!);
    expect(undone.restoredCount).toBeGreaterThanOrEqual(2);
    const hermesRestoredStat = await fs.lstat(hermesDup);
    expect(hermesRestoredStat.isDirectory()).toBe(true);
    expect(hermesRestoredStat.isSymbolicLink()).toBe(false);
  });

  it('reuses and refreshes Hermes default profile OAuth tokens in memory without leaking secrets', async () => {
    const home = await makeTempHome();
    const tokensDir = path.join(home, '.hermes', 'mcp-tokens');
    await fs.mkdir(tokensDir, { recursive: true });

    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    await fs.writeFile(
      path.join(tokensDir, 'demo.json'),
      JSON.stringify({
        access_token: 'tok-valid-1',
        token_type: 'Bearer',
        expires_at: futureExp,
        refresh_token: 'ref-1',
      })
    );

    const status = await getHermesOAuthStatus('demo', home);
    expect(status.present).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.hasRefreshToken).toBe(true);
    expect(JSON.stringify(status)).not.toContain('tok-valid-1');
    expect(JSON.stringify(status)).not.toContain('ref-1');

    const hdr = await resolveHermesOAuthHeader('demo', { homeDir: home });
    expect(hdr).toEqual({ Authorization: 'Bearer tok-valid-1' });

    // Simulate expired token -> refreshes via token_endpoint
    await fs.writeFile(
      path.join(tokensDir, 'demo.json'),
      JSON.stringify({
        access_token: 'tok-expired',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) - 10,
        refresh_token: 'ref-1',
      })
    );
    await fs.writeFile(
      path.join(tokensDir, 'demo.meta.json'),
      JSON.stringify({ token_endpoint: 'https://auth.example.test/token' })
    );
    await fs.writeFile(
      path.join(tokensDir, 'demo.client.json'),
      JSON.stringify({ client_id: 'cid-123' })
    );

    const refreshedHdr = await resolveHermesOAuthHeader('demo', {
      homeDir: home,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            access_token: 'tok-refreshed-2',
            token_type: 'Bearer',
            expires_in: 7200,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )) as typeof fetch,
    });
    expect(refreshedHdr).toEqual({ Authorization: 'Bearer tok-refreshed-2' });

    const updatedFile = JSON.parse(await fs.readFile(path.join(tokensDir, 'demo.json'), 'utf8'));
    expect(updatedFile.access_token).toBe('tok-refreshed-2');
    expect(updatedFile.refresh_token).toBe('ref-1');
  });

  it('persists settings safely (127.0.0.1 default, scrypt passcode) and renders/installs launchd & systemd units in sandbox', async () => {
    const home = await makeTempHome();
    const hubDir = path.join(home, '.harness-hub');

    const defaults = await loadSettings(hubDir);
    expect(defaults.bindMode).toBe('local');
    expect(resolveBindHost(defaults.bindMode)).toBe('127.0.0.1');
    expect(defaults.port).toBe(4310);

    const hash = hashPasscode('my-secret-pin');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(verifyPasscode('my-secret-pin', hash)).toBe(true);
    expect(verifyPasscode('wrong-pin', hash)).toBe(false);

    await saveSettings(hubDir, { ...defaults, bindMode: 'lan', port: 4410, accessPasscodeHash: hash });
    const reloaded = await loadSettings(hubDir);
    expect(reloaded.bindMode).toBe('lan');
    expect(resolveBindHost(reloaded.bindMode)).toBe('0.0.0.0');
    expect(reloaded.port).toBe(4410);

    const plist = renderLaunchdPlist({
      nodeBin: '/usr/local/bin/node',
      cliScript: '/opt/hh/cli.js',
      host: '127.0.0.1',
      port: 4310,
      homeDir: home,
      hubDir,
      logPath: path.join(hubDir, 'logs', 'server.log'),
    });
    expect(plist).toContain('<string>127.0.0.1</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');

    const unit = renderSystemdUnit({
      nodeBin: '/usr/bin/node',
      cliScript: '/opt/hh/cli.js',
      host: '0.0.0.0',
      port: 4410,
      homeDir: home,
      hubDir,
    });
    expect(unit).toContain('--host 0.0.0.0 --port 4410');

    const installed = await installBackgroundService({
      homeDir: home,
      hubDir,
      platform: 'darwin',
      cliScript: '/opt/hh/cli.js',
      host: '127.0.0.1',
      port: 4310,
      skipDaemonControl: true,
    });
    expect(installed.installed).toBe(true);
    expect((await getServiceStatus({ homeDir: home, hubDir, platform: 'darwin', skipDaemonControl: true })).installed).toBe(true);

    const removed = await uninstallBackgroundService({
      homeDir: home,
      hubDir,
      platform: 'darwin',
      skipDaemonControl: true,
    });
    expect(removed.installed).toBe(false);
  });

  it('preserves working inline secrets when env vars are unset and translates env refs per harness', async () => {
    const home = await makeTempHome();
    const paths = resolveHostPaths({ homeDir: home });

    // 1) OpenCode originally has a working literal key; Codex does not have litellm yet
    await fs.mkdir(path.join(home, '.config', 'opencode'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify(
        {
          mcp: {
            litellm: {
              type: 'remote',
              url: 'http://127.0.0.1:4000/mcp',
              headers: {
                'x-litellm-api-key': 'Bearer sk-original-working-key-123456',
              },
              enabled: true,
            },
          },
        },
        null,
        2
      )
    );
    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n');

    const registry = await discoverAndMergeRegistry(paths);
    expect(registry.mcps[0]?.headers?.['x-litellm-api-key']).toBe('${X_LITELLM_API_KEY}');

    // 2) Because X_LITELLM_API_KEY is NOT set, OpenCodeAdapter must preserve the working literal key
    const adapters = createAdapters(paths);
    const openCodePlan = await adapters.opencode.planSync(
      buildDesiredStateForHarness(registry, 'opencode', { includeGateway: false })
    );
    expect(openCodePlan.warnings.some((w) => w.includes('X_LITELLM_API_KEY'))).toBe(true);
    expect(openCodePlan.warnings.some((w) => w.includes('Preserved existing on-disk credentials'))).toBe(
      true
    );
    await adapters.opencode.applySync(openCodePlan, paths.backupsDir);
    const openCodeAfter = JSON.parse(
      await fs.readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8')
    );
    expect(openCodeAfter.mcp.litellm.headers['x-litellm-api-key']).toBe(
      'Bearer sk-original-working-key-123456'
    );

    // 3) When env var IS set, CodexAdapter emits env_http_headers/bearer_token_env_var and OpenCode emits {env:VAR} + oauth: false
    process.env.HARNESS_TEST_LITELLM_KEY = 'sk-env-present';
    process.env.HARNESS_TEST_BEARER = 'tok-env-present';
    try {
      registry.mcps[0]!.headers = {
        'x-litellm-api-key': '${HARNESS_TEST_LITELLM_KEY}',
        Authorization: 'Bearer ${HARNESS_TEST_BEARER}',
        'X-Static': 'v1',
      };
      registry.allocations.mcps.litellm!.codex = { enabled: true, mode: 'direct' };
      registry.allocations.mcps.litellm!.opencode = { enabled: true, mode: 'direct' };

      const codexPlan = await adapters.codex.planSync(
        buildDesiredStateForHarness(registry, 'codex', { includeGateway: false })
      );
      await adapters.codex.applySync(codexPlan, paths.backupsDir);
      const codexToml = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
      expect(codexToml).toContain('bearer_token_env_var = "HARNESS_TEST_BEARER"');
      expect(codexToml).toContain('x-litellm-api-key = "HARNESS_TEST_LITELLM_KEY"');
      expect(codexToml).toContain('[mcp_servers.litellm.env_http_headers]');
      expect(codexToml).not.toContain('${HARNESS_TEST_LITELLM_KEY}');

      const ocPlan2 = await adapters.opencode.planSync(
        buildDesiredStateForHarness(registry, 'opencode', { includeGateway: false })
      );
      await adapters.opencode.applySync(ocPlan2, paths.backupsDir);
      const ocJson2 = JSON.parse(
        await fs.readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8')
      );
      expect(ocJson2.mcp.litellm.oauth).toBe(false);
      expect(ocJson2.mcp.litellm.headers['x-litellm-api-key']).toBe(
        '{env:HARNESS_TEST_LITELLM_KEY}'
      );

      // Re-scanning Codex round-trips env_http_headers + bearer_token_env_var cleanly
      const rescanned = await discoverAndMergeRegistry(paths);
      const codexMcp = rescanned.mcps.find((m) => m.id === 'litellm')!;
      expect(codexMcp.headers?.['x-litellm-api-key']).toBe('${HARNESS_TEST_LITELLM_KEY}');
      expect(codexMcp.headers?.['Authorization']).toBe('Bearer ${HARNESS_TEST_BEARER}');
    } finally {
      delete process.env.HARNESS_TEST_LITELLM_KEY;
      delete process.env.HARNESS_TEST_BEARER;
    }

    // 4) resolveRuntimeSecrets supports embedded refs and throws clearly on missing env vars
    const embedded = await resolveRuntimeSecrets(
      { Authorization: 'Bearer op://Hermes/Demo/secret' },
      { opReader: async () => 'sk-op-val' }
    );
    expect(embedded.Authorization).toBe('Bearer sk-op-val');
    await expect(
      resolveRuntimeSecrets({ 'x-api-key': '${DEFINITELY_MISSING_VAR_123}' }, { env: {} })
    ).rejects.toThrow('Missing environment variable: DEFINITELY_MISSING_VAR_123');
  });
});
