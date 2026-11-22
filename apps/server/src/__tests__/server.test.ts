import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHarnessHubApp } from '../app.js';

const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-hub-server-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  delete process.env.HARNESS_HUB_SKIP_CODEX_CLI;
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('HarnessHub Server API & MCP Gateway', () => {
  it('supports matrix allocation, plan/apply, rollback, verify, and live Streamable HTTP /mcp/:harness calls', async () => {
    process.env.HARNESS_HUB_SKIP_CODEX_CLI = '1';
    const home = await makeTempHome();

    // Seed sample skill and harness configs
    const skillDir = path.join(home, '.agents', 'skills', 'ego-browser');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: ego-browser\ndescription: Headless and interactive browser automation\ntags: [browser, qa]\n---\n\n# Ego Browser\nUse ego-browser CLI.\n'
    );

    await fs.mkdir(path.join(home, '.codex'), { recursive: true });
    await fs.writeFile(path.join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n');
    await fs.mkdir(path.join(home, '.config', 'opencode'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ mcp: {} })
    );

    const { app } = await createHarnessHubApp({
      homeDir: home,
      port: 0,
    });

    // Listen on an ephemeral localhost port for real MCP client transport testing
    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      // 1. Verify initial state
      const stateRes = await app.inject({ method: 'GET', url: '/api/state' });
      expect(stateRes.statusCode).toBe(200);
      const state = stateRes.json();
      expect(state.registry.skills).toHaveLength(1);
      expect(state.registry.skills[0].id).toBe('ego-browser');

      // 2. Toggle ego-browser ON for codex
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/allocations/skill',
        payload: { skillId: 'ego-browser', harnessId: 'codex', assigned: true },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().pendingChangesCount).toBeGreaterThan(0);

      // 3. Register a new MCP with an op:// secret ref (must never return raw secret)
      const createMcpRes = await app.inject({
        method: 'POST',
        url: '/api/mcps',
        payload: {
          id: 'demo-api',
          transport: 'http',
          url: 'http://127.0.0.1:9999/mcp',
          headers: { Authorization: 'op://Hermes/Demo/token' },
          authType: 'bearer',
        },
      });
      expect(createMcpRes.statusCode).toBe(200);
      expect(
        createMcpRes.json().registry.mcps.find((m: { id: string }) => m.id === 'demo-api').headers
          .Authorization
      ).toBe('op://Hermes/Demo/token');

      // 4. Apply sync
      const applyRes = await app.inject({ method: 'POST', url: '/api/apply' });
      expect(applyRes.statusCode).toBe(200);
      const applyData = applyRes.json();
      expect(applyData.backups.length).toBeGreaterThanOrEqual(1);

      const codexLink = await fs.lstat(path.join(home, '.codex', 'skills', 'ego-browser'));
      expect(codexLink.isSymbolicLink()).toBe(true);

      // 5. Connect a real MCP Client to /mcp/codex and invoke search_skills + read_skill!
      const mcpClient = new Client({ name: 'test-codex-client', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${address}/mcp/codex`));
      await mcpClient.connect(transport);

      const toolsList = await mcpClient.listTools();
      expect(toolsList.tools.map((t) => t.name)).toContain('search_skills');
      expect(toolsList.tools.map((t) => t.name)).toContain('read_skill');

      const searchOut = await mcpClient.callTool({
        name: 'search_skills',
        arguments: { query: 'browser' },
      });
      const searchText = (searchOut.content as Array<{ text?: string }>)[0]?.text ?? '';
      expect(searchText).toContain('ego-browser');

      const readOut = await mcpClient.callTool({
        name: 'read_skill',
        arguments: { id: 'ego-browser' },
      });
      const readText = (readOut.content as Array<{ text?: string }>)[0]?.text ?? '';
      expect(readText).toContain('Use ego-browser CLI.');

      await mcpClient.close();

      // 6. Run live verify endpoint
      const verifyRes = await app.inject({ method: 'POST', url: '/api/verify' });
      expect(verifyRes.statusCode).toBe(200);
      const codexVerif = verifyRes
        .json()
        .verifications.find((v: { harnessId: string }) => v.harnessId === 'codex');
      expect(codexVerif.status).toBe('healthy');
      expect(codexVerif.skillsHealthy).toBeGreaterThanOrEqual(1);

      // 7. Rollback restores pre-apply state
      const backupId = applyData.backups[0].id as string;
      const rollbackRes = await app.inject({
        method: 'POST',
        url: `/api/rollback/${encodeURIComponent(backupId)}`,
        payload: {},
      });
      expect(rollbackRes.statusCode).toBe(200);

      // 8. Organize plan/apply endpoint responds cleanly
      const orgPlanRes = await app.inject({ method: 'GET', url: '/api/organize/plan' });
      expect(orgPlanRes.statusCode).toBe(200);
      expect(orgPlanRes.json().plan.counts).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('shares Hermes default OAuth token via Hub Gateway and auto-routes non-Hermes harnesses to gateway mode', async () => {
    process.env.HARNESS_HUB_SKIP_CODEX_CLI = '1';
    const home = await makeTempHome();
    const tokensDir = path.join(home, '.hermes', 'mcp-tokens');
    await fs.mkdir(tokensDir, { recursive: true });
    await fs.writeFile(
      path.join(tokensDir, 'oauth-demo.json'),
      JSON.stringify({
        access_token: 'hermes-shared-oauth-secret',
        token_type: 'Bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'ref-xyz',
      })
    );

    // Upstream requiring Bearer authorization header
    const upstreamHttp = http.createServer(async (req, res) => {
      if (req.headers.authorization !== 'Bearer hermes-shared-oauth-secret') {
        res.statusCode = 401;
        res.end('Unauthorized');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      const srv = new McpServer({ name: 'oauth-upstream', version: '0.1.0' });
      srv.tool('account_info', 'Get account summary', {}, async () => ({
        content: [{ type: 'text', text: 'account-ok' }],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await srv.connect(transport);
      await transport.handleRequest(req, res, body);
      await srv.close();
    });

    await new Promise<void>((resolve) => upstreamHttp.listen(0, '127.0.0.1', resolve));
    const upstreamAddr = upstreamHttp.address() as { port: number };
    const upstreamUrl = `http://127.0.0.1:${upstreamAddr.port}/mcp`;

    const { app } = await createHarnessHubApp({ homeDir: home, port: 0 });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      await app.inject({
        method: 'POST',
        url: '/api/mcps',
        payload: { id: 'oauth-demo', transport: 'http', url: upstreamUrl, authType: 'oauth' },
      });

      // Enabling on codex without specifying mode auto-selects gateway mode!
      const toggleRes = await app.inject({
        method: 'PATCH',
        url: '/api/allocations/mcp',
        payload: { mcpId: 'oauth-demo', harnessId: 'codex', enabled: true },
      });
      expect(toggleRes.statusCode).toBe(200);
      const state = toggleRes.json();
      expect(state.registry.allocations.mcps['oauth-demo'].codex.mode).toBe('gateway');
      expect(state.oauthStatuses['oauth-demo'].valid).toBe(true);
      expect(JSON.stringify(state)).not.toContain('hermes-shared-oauth-secret');

      // Codex gateway endpoint calls upstream using Hermes default OAuth token!
      const client = new Client({ name: 'codex-oauth-tester', version: '0.1.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp/codex`)));
      const out = await client.callTool({ name: 'oauth-demo__account_info', arguments: {} });
      expect((out.content as Array<{ text?: string }>)[0]?.text).toBe('account-ok');
      await client.close();

      // Verify probe succeeds using Hermes OAuth token
      const verRes = await app.inject({ method: 'POST', url: '/api/verify' });
      expect(verRes.statusCode).toBe(200);
      const probe = verRes.json().mcpProbes.find((p: { id: string }) => p.id === 'oauth-demo');
      expect(probe.status).toBe('healthy');
      expect(probe.toolCount).toBe(1);
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstreamHttp.close(() => resolve()));
    }
  });

  it('proxies upstream HTTP MCP tools through /mcp/:harness with disabledTools filtering and serves built UI', async () => {
    process.env.HARNESS_HUB_SKIP_CODEX_CLI = '1';
    const home = await makeTempHome();
    const webDist = path.join(home, 'web-dist');
    await fs.mkdir(webDist, { recursive: true });
    await fs.writeFile(path.join(webDist, 'index.html'), '<!doctype html><div id="root"></div>');

    // Spin up a real upstream Streamable HTTP MCP server
    const upstreamHttp = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;

      const srv = new McpServer({ name: 'mock-upstream', version: '0.1.0' });
      srv.tool('echo_ok', 'Safe read tool', { msg: z.string() }, async ({ msg }) => ({
        content: [{ type: 'text', text: `echo:${msg}` }],
      }));
      srv.tool('danger_write', 'Blocked write tool', { path: z.string() }, async () => ({
        content: [{ type: 'text', text: 'should not run' }],
      }));

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await srv.connect(transport);
      await transport.handleRequest(req, res, body);
      await srv.close();
    });

    await new Promise<void>((resolve) => upstreamHttp.listen(0, '127.0.0.1', resolve));
    const upstreamAddr = upstreamHttp.address() as { port: number };
    const upstreamUrl = `http://127.0.0.1:${upstreamAddr.port}/mcp`;

    const { app } = await createHarnessHubApp({
      homeDir: home,
      webDistDir: webDist,
      port: 0,
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      // Static UI served cleanly
      const uiRes = await app.inject({ method: 'GET', url: '/' });
      expect(uiRes.statusCode).toBe(200);
      expect(uiRes.body).toContain('<div id="root">');

      // Register upstream MCP and enable in gateway mode with danger_write disabled
      await app.inject({
        method: 'POST',
        url: '/api/mcps',
        payload: { id: 'mock', transport: 'http', url: upstreamUrl },
      });
      await app.inject({
        method: 'PATCH',
        url: '/api/allocations/mcp',
        payload: {
          mcpId: 'mock',
          harnessId: 'codex',
          enabled: true,
          mode: 'gateway',
          disabledTools: ['danger_write'],
        },
      });

      const client = new Client({ name: 'gateway-tester', version: '0.1.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp/codex`)));

      const listed = await client.listTools();
      const toolNames = listed.tools.map((t) => t.name);
      expect(toolNames).toContain('mock__echo_ok');
      expect(toolNames).not.toContain('mock__danger_write');

      const echoRes = await client.callTool({
        name: 'mock__echo_ok',
        arguments: { msg: 'hello' },
      });
      expect((echoRes.content as Array<{ text?: string }>)[0]?.text).toBe('echo:hello');

      await expect(
        client.callTool({ name: 'mock__danger_write', arguments: { path: '/tmp/x' } })
      ).rejects.toThrow();

      await client.close();
    } finally {
      await app.close();
      await new Promise<void>((resolve) => upstreamHttp.close(() => resolve()));
    }
  });

  it('supports settings persistence, passcode protection, and service unit generation in sandbox', async () => {
    process.env.HARNESS_HUB_SKIP_CODEX_CLI = '1';
    const home = await makeTempHome();
    const { app } = await createHarnessHubApp({
      homeDir: home,
      port: 0,
      skipServiceControl: true,
    });

    try {
      const initialSettings = await app.inject({ method: 'GET', url: '/api/settings' });
      expect(initialSettings.statusCode).toBe(200);
      expect(initialSettings.json().settings.bindMode).toBe('local');
      expect(initialSettings.json().settings.hasPasscode).toBe(false);

      // Enable passcode + lan mode
      const patchRes = await app.inject({
        method: 'PATCH',
        url: '/api/settings',
        payload: { bindMode: 'lan', passcode: 'test-pass-123' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().settings.hasPasscode).toBe(true);

      // Unauthenticated /api/state is now blocked with 401
      const lockedRes = await app.inject({ method: 'GET', url: '/api/state' });
      expect(lockedRes.statusCode).toBe(401);

      // Login returns session token
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { passcode: 'test-pass-123' },
      });
      expect(loginRes.statusCode).toBe(200);
      const token = loginRes.json().token as string;
      expect(token.length).toBeGreaterThan(10);

      // Authenticated /api/state succeeds
      const authedRes = await app.inject({
        method: 'GET',
        url: '/api/state',
        headers: { 'x-harness-token': token },
      });
      expect(authedRes.statusCode).toBe(200);

      // Install sandbox service plist
      const svcRes = await app.inject({
        method: 'POST',
        url: '/api/service/install',
        headers: { 'x-harness-token': token },
        payload: {},
      });
      expect(svcRes.statusCode).toBe(200);
      expect(svcRes.json().runtime.serviceStatus.installed).toBe(true);
    } finally {
      await app.close();
    }
  });
});
