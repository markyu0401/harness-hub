#!/usr/bin/env node
/**
 * HarnessHub Isolated English Demo Sandbox
 *
 * Spins up an isolated temporary home directory with realistic English Skills,
 * nested Hermes categories, duplicate/symlink patterns for the Organizer,
 * live local HTTP mock MCP servers, and dummy Hermes OAuth entries so you can
 * explore every feature of HarnessHub without touching real agent configs.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parsePort(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      return Number(argv[i + 1]);
    }
  }
  return process.env.HARNESS_HUB_DEMO_PORT ? Number(process.env.HARNESS_HUB_DEMO_PORT) : 4319;
}

const DEMO_SKILLS = [
  {
    dir: '.agents/skills/git-pr-reviewer',
    content: `---
name: git-pr-reviewer
description: Structured pull request review covering correctness, test coverage, and Conventional Commit hygiene.
category: git
tags:
  - git
  - review
  - quality
---

# Git PR Reviewer

Use this workflow when reviewing a branch or pull request:

1. Check diff scope for unrelated formatting or leftover debug logs.
2. Verify unit/integration tests cover modified branches and edge cases.
3. Confirm Conventional Commit titles and clear breaking-change notes.
`,
  },
  {
    dir: '.agents/skills/typescript-strict-refactor',
    content: `---
name: typescript-strict-refactor
description: Safe TypeScript refactoring patterns enforcing strict null checks, discriminated unions, and zero implicit any.
category: engineering
tags:
  - typescript
  - refactor
---

# TypeScript Strict Refactor

- Prefer discriminated unions over optional boolean bags.
- Extract shared helpers rather than duplicating validation blocks.
- Run \`pnpm typecheck && pnpm test\` after every refactor pass.
`,
  },
  {
    dir: '.agents/skills/sql-query-auditor',
    content: `---
name: sql-query-auditor
description: Analyze SQL queries with EXPLAIN plans, missing index checks, and N+1 query detection.
category: database
tags:
  - sql
  - postgres
  - performance
---

# SQL Query Auditor

Inspect query plans before recommending schema changes:

- Flag sequential scans on high-cardinality filter columns.
- Check composite index column ordering against equality vs range predicates.
`,
  },
  {
    dir: '.hermes/skills/devops/docker-compose-ops',
    content: `---
name: docker-compose-ops
description: Manage multi-container Compose stacks with healthcheck verification, rolling recreation, and log diagnostics.
category: devops
tags:
  - docker
  - devops
  - containers
---

# Docker Compose Operations

1. Inspect container health status before restarting dependent services.
2. Tail bounded logs (\`--tail 200\`) rather than streaming unbounded output.
3. Validate volume mount permissions before rolling updates.
`,
  },
  {
    dir: '.hermes/skills/research/arxiv-digest',
    content: `---
name: arxiv-digest
description: Summarize recent ML and systems papers with structured methodology, benchmarks, and ablation notes.
category: research
tags:
  - papers
  - research
  - synthesis
---

# arXiv Paper Digest

Extract problem formulation, baseline comparisons, key ablations, and reproducibility caveats into concise structured briefs.
`,
  },
  {
    dir: '.hermes/skills/finance/portfolio-brief',
    content: `---
name: portfolio-brief
description: Morning portfolio and watchlist digest using local broker credentials and Hermes memory context.
category: finance
tags:
  - finance
  - briefing
---

# Portfolio Brief

Reads credentials from ~/.hermes/.env and dispatches alerts via \`hermes\` CLI helper when thresholds trigger.
`,
  },
  {
    dir: '.codex/skills/vitest-tdd-loop',
    content: `---
name: vitest-tdd-loop
description: Tight red-green-refactor workflow using Vitest isolated temp workspaces and snapshot-free assertions.
category: testing
tags:
  - vitest
  - testing
  - tdd
---

# Vitest TDD Loop

- Isolate filesystem tests in \`mkdtemp\` directories.
- Assert exact contract outputs rather than brittle snapshots.
`,
  },
  {
    dir: '.codex/skills/openapi-contract-check',
    content: `---
name: openapi-contract-check
description: Verify REST endpoints and Zod schemas stay backward-compatible across client and server packages.
category: api
tags:
  - openapi
  - zod
  - contracts
---

# OpenAPI Contract Check

Compare request/response schemas against route handlers before bumping minor versions.
`,
  },
  {
    dir: '.config/opencode/skills/multi-model-bench',
    content: `---
name: multi-model-bench
description: Compare latency, token usage, and structured tool-calling reliability across coding models.
category: evaluation
tags:
  - benchmark
  - llm
---

# Multi-Model Benchmark

Run identical deterministic prompts across configured providers and report median latency alongside pass rates.
`,
  },
  {
    dir: '.gemini/config/skills/ui-a11y-inspector',
    content: `---
name: ui-a11y-inspector
description: Audit dark and light themes for WCAG AA contrast, focus rings, keyboard traps, and responsive layout stability.
category: frontend
tags:
  - accessibility
  - ui
  - css
---

# UI Accessibility Inspector

Verify keyboard tab order, contrast ratios >= 4.5:1, and zero horizontal overflow at 390px and 1440px viewports.
`,
  },
];

const MOCK_MCP_TOOLS = {
  'github-docs': [
    { name: 'search_repos', description: 'Search public GitHub repositories by keyword' },
    { name: 'get_file_contents', description: 'Read file or directory contents from a repo' },
    { name: 'list_pull_requests', description: 'List open or merged pull requests' },
    { name: 'read_issue', description: 'Fetch GitHub issue details and comments' },
  ],
  'postgres-readonly': [
    { name: 'describe_tables', description: 'Inspect PostgreSQL schemas, tables, and indexes' },
    { name: 'explain_query', description: 'Run EXPLAIN ANALYZE in a rolled-back transaction' },
    { name: 'run_readonly_sql', description: 'Execute bounded SELECT queries' },
  ],
  'web-fetch': [
    { name: 'fetch_markdown', description: 'Fetch a public URL and extract clean Markdown' },
    { name: 'extract_links', description: 'Extract outbound links from a web document' },
  ],
  'linear-oauth': [
    { name: 'list_issues', description: 'List team issues filtered by cycle or state' },
    { name: 'get_issue', description: 'Read issue body, comments, and assignee metadata' },
    { name: 'search_projects', description: 'Search roadmap projects and milestones' },
  ],
};

function startMockMcpServer() {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    const match = urlPath.match(/^\/mcp\/([a-z0-9-]+)$/i);
    if (!match || !MOCK_MCP_TOOLS[match[1]]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown mock MCP server' }));
      return;
    }

    const serverId = match[1];
    if (serverId === 'linear-oauth' && !req.headers.authorization) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bearer token required' }));
      return;
    }
    const tools = MOCK_MCP_TOOLS[serverId];
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      let rpc;
      try {
        rpc = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON-RPC payload' }));
        return;
      }

      if (rpc.method === 'initialize') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'mcp-session-id': `demo-session-${serverId}`,
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id ?? 1,
            result: {
              protocolVersion: '2025-03-26',
              serverInfo: { name: serverId, version: '0.1.0-demo' },
              capabilities: { tools: {} },
            },
          })
        );
        return;
      }

      if (rpc.method === 'notifications/initialized') {
        res.writeHead(202);
        res.end();
        return;
      }

      if (rpc.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id ?? 2,
            result: {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: { type: 'object', properties: {} },
              })),
            },
          })
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id ?? 1,
          result: { ok: true },
        })
      );
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

async function seedDemoHome(homeDir, mockPort) {
  for (const sk of DEMO_SKILLS) {
    const targetDir = path.join(homeDir, sk.dir);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), sk.content, 'utf8');
  }

  // Create an intentional duplicate copy & symlink so Organize Library previews consolidation
  const dupOpenCodeDir = path.join(homeDir, '.config/opencode/skills/git-pr-reviewer');
  await fs.mkdir(dupOpenCodeDir, { recursive: true });
  await fs.writeFile(path.join(dupOpenCodeDir, 'SKILL.md'), DEMO_SKILLS[0].content, 'utf8');

  await fs.symlink(
    path.join(homeDir, '.hermes/skills/devops/docker-compose-ops'),
    path.join(homeDir, '.codex/skills/docker-compose-ops')
  );

  // Dummy Hermes OAuth store inside demo sandbox (synthetic non-secret data)
  await fs.mkdir(path.join(homeDir, '.hermes/mcp-tokens'), { recursive: true });
  await fs.writeFile(
    path.join(homeDir, '.hermes/mcp-tokens/linear-oauth.json'),
    JSON.stringify(
      {
        access_token: 'demo-synthetic-oauth-token',
        token_type: 'Bearer',
        expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
        refresh_token: 'demo-synthetic-refresh-token',
      },
      null,
      2
    ),
    'utf8'
  );

  // Hermes config.yaml
  await fs.writeFile(
    path.join(homeDir, '.hermes/config.yaml'),
    `model: claude-sonnet-4-5
mcp_servers:
  github-docs:
    url: http://127.0.0.1:${mockPort}/mcp/github-docs
    enabled: true
  linear-oauth:
    url: http://127.0.0.1:${mockPort}/mcp/linear-oauth
    auth: oauth
    enabled: true
  filesystem:
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - ${homeDir}/workspace
    enabled: true
`,
    'utf8'
  );

  // Codex config.toml
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await fs.writeFile(
    path.join(homeDir, '.codex/config.toml'),
    `model = "gpt-5.3-codex"

[mcp_servers.github-docs]
url = "http://127.0.0.1:${mockPort}/mcp/github-docs"

[mcp_servers.postgres-readonly]
url = "http://127.0.0.1:${mockPort}/mcp/postgres-readonly"

[mcp_servers.web-fetch]
url = "http://127.0.0.1:${mockPort}/mcp/web-fetch"
`,
    'utf8'
  );

  // OpenCode config
  await fs.mkdir(path.join(homeDir, '.config/opencode'), { recursive: true });
  await fs.writeFile(
    path.join(homeDir, '.config/opencode/opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          'github-docs': {
            type: 'remote',
            url: `http://127.0.0.1:${mockPort}/mcp/github-docs`,
            enabled: true,
          },
          'web-fetch': {
            type: 'remote',
            url: `http://127.0.0.1:${mockPort}/mcp/web-fetch`,
            enabled: true,
          },
          filesystem: {
            type: 'local',
            command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', `${homeDir}/workspace`],
            enabled: true,
          },
        },
      },
      null,
      2
    ),
    'utf8'
  );

  // Antigravity mcp_config.json
  await fs.mkdir(path.join(homeDir, '.gemini/antigravity'), { recursive: true });
  await fs.writeFile(
    path.join(homeDir, '.gemini/antigravity/mcp_config.json'),
    JSON.stringify(
      {
        mcpServers: {
          'github-docs': {
            serverUrl: `http://127.0.0.1:${mockPort}/mcp/github-docs`,
          },
          'linear-oauth': {
            serverUrl: `http://127.0.0.1:${mockPort}/mcp/linear-oauth`,
          },
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', `${homeDir}/workspace`],
          },
        },
      },
      null,
      2
    ),
    'utf8'
  );
}

async function main() {
  const port = parsePort(process.argv.slice(2));
  const distServerEntry = path.join(repoRoot, 'apps/server/dist/index.js');
  const distWebHtml = path.join(repoRoot, 'apps/web/dist/index.html');
  try {
    await fs.access(distServerEntry);
    await fs.access(distWebHtml);
  } catch {
    console.error('Build output not found. Run `pnpm build` first, then `pnpm demo`.');
    process.exit(1);
  }

  process.env.HARNESS_HUB_SKIP_CODEX_CLI = '1';

  const demoHome = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-hub-demo-'));
  const { server: mockMcp, port: mockPort } = await startMockMcpServer();
  await seedDemoHome(demoHome, mockPort);

  const { createHarnessHubApp } = await import(distServerEntry);
  const { app } = await createHarnessHubApp({
    homeDir: demoHome,
    hubDir: path.join(demoHome, '.harness-hub'),
    host: '127.0.0.1',
    port,
    skipServiceControl: true,
  });

  await app.listen({ host: '127.0.0.1', port });
  console.log(`\nHarnessHub English Demo Sandbox running at http://127.0.0.1:${port}/`);
  console.log(`Isolated sandbox directory: ${demoHome}`);
  console.log(`Mock HTTP MCP endpoints running on 127.0.0.1:${mockPort}`);
  console.log('Press Ctrl+C to stop and remove the temporary sandbox.\n');

  const cleanup = async () => {
    await app.close().catch(() => {});
    await new Promise((resolve) => mockMcp.close(resolve));
    await fs.rm(demoHome, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
