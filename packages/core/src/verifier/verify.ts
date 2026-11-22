import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import YAML from 'yaml';
import {
  resolveHermesOAuthHeader,
  resolveRuntimeSecrets,
  type OpSecretReader,
} from '../secrets.js';
import type {
  HarnessId,
  McpProbeResult,
  McpServerItem,
  VerificationResult,
  VerificationStatus,
} from '../types.js';

async function checkConfigParseable(
  harnessId: HarnessId,
  configPath: string
): Promise<{ exists: boolean; valid: boolean; error?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { exists: false, valid: true };
    }
    return {
      exists: false,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    if (harnessId === 'codex') {
      parseToml(raw);
    } else if (harnessId === 'hermes') {
      YAML.parse(raw);
    } else {
      JSON.parse(raw);
    }
    return { exists: true, valid: true };
  } catch (err) {
    return {
      exists: true,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkSkillsHealth(skillsDir: string): Promise<{
  exists: boolean;
  skillsChecked: number;
  skillsHealthy: number;
  brokenSymlinks: string[];
}> {
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return { exists: false, skillsChecked: 0, skillsHealthy: 0, brokenSymlinks: [] };
  }

  let skillsChecked = 0;
  let skillsHealthy = 0;
  const brokenSymlinks: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(skillsDir, entry.name);
    try {
      const lstat = await fs.lstat(fullPath);
      if (lstat.isSymbolicLink()) {
        skillsChecked++;
        try {
          const real = await fs.realpath(fullPath);
          await fs.access(path.join(real, 'SKILL.md'));
          skillsHealthy++;
        } catch {
          brokenSymlinks.push(entry.name);
        }
      } else if (lstat.isDirectory()) {
        // Check direct SKILL.md or nested category directory
        try {
          await fs.access(path.join(fullPath, 'SKILL.md'));
          skillsChecked++;
          skillsHealthy++;
        } catch {
          // Might be category folder (e.g. ~/.hermes/skills/devops)
          const sub = await checkSkillsHealth(fullPath);
          skillsChecked += sub.skillsChecked;
          skillsHealthy += sub.skillsHealthy;
          brokenSymlinks.push(...sub.brokenSymlinks.map((s) => `${entry.name}/${s}`));
        }
      }
    } catch {
      brokenSymlinks.push(entry.name);
    }
  }

  return { exists: true, skillsChecked, skillsHealthy, brokenSymlinks };
}

/**
 * Probe a single HTTP/SSE MCP server via JSON-RPC `initialize` + `tools/list`.
 */
export async function probeHttpMcpServer(
  item: McpServerItem,
  options?: { timeoutMs?: number; opReader?: OpSecretReader; homeDir?: string }
): Promise<McpProbeResult> {
  if (!item.url) {
    return { id: item.id, status: 'error', message: 'Missing MCP URL' };
  }

  const startedAt = Date.now();
  const timeoutMs = options?.timeoutMs ?? 6000;
  let headers: Record<string, string>;
  let usedHermesOAuth = false;
  try {
    headers = await resolveRuntimeSecrets(item.headers, { opReader: options?.opReader });
    if (!headers.Authorization && !headers.authorization) {
      const oauthHeader = await resolveHermesOAuthHeader(item.id, { homeDir: options?.homeDir });
      if (oauthHeader) {
        headers = { ...headers, ...oauthHeader };
        usedHermesOAuth = true;
      }
    }
  } catch (err) {
    return {
      id: item.id,
      status: 'auth_required',
      message: `Secret resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const initResp = await fetch(item.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'harness-hub-verifier', version: '0.1.0' },
        },
      }),
      signal: controller.signal,
    });

    if (initResp.status === 401 || initResp.status === 403) {
      return {
        id: item.id,
        status: 'auth_required',
        latencyMs: Date.now() - startedAt,
        message: `HTTP ${initResp.status} (authentication required)`,
      };
    }

    if (!initResp.ok) {
      return {
        id: item.id,
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: `HTTP ${initResp.status} ${initResp.statusText}`,
      };
    }

    const sessionId = initResp.headers.get('mcp-session-id');
    const listResp = await fetch(item.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
      signal: controller.signal,
    });

    const text = await listResp.text();
    const tools = extractToolsFromMcpResponse(text);
    const authSuffix = usedHermesOAuth ? ' · shared Hermes OAuth' : '';
    return {
      id: item.id,
      status: 'healthy',
      toolCount: tools?.length,
      tools,
      latencyMs: Date.now() - startedAt,
      message:
        tools !== undefined
          ? `Connected (${tools.length} tools${authSuffix})`
          : `Connected (initialize succeeded${authSuffix})`,
    };
  } catch (err) {
    return {
      id: item.id,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractToolsFromMcpResponse(body: string): string[] | undefined {
  const tryParse = (jsonStr: string): string[] | undefined => {
    try {
      const obj = JSON.parse(jsonStr) as {
        result?: { tools?: Array<{ name?: string }> };
      };
      if (Array.isArray(obj.result?.tools)) {
        return obj.result.tools
          .map((t) => t.name)
          .filter((n): n is string => typeof n === 'string');
      }
    } catch {
      // Ignore parse error
    }
    return undefined;
  };

  const direct = tryParse(body.trim());
  if (direct) return direct;

  // Handle SSE `data: {...}` lines
  for (const line of body.split('\n')) {
    if (line.startsWith('data:')) {
      const parsed = tryParse(line.slice(5).trim());
      if (parsed) return parsed;
    }
  }
  return undefined;
}

export interface CodexAppServerProbeResult {
  mcpProbes: McpProbeResult[];
  loadedSkillNames: string[];
}

/**
 * Probe Codex live via `codex app-server --listen stdio://`
 * (`initialize` + `mcpServerStatus/list` + `skills/list`).
 */
export async function probeCodexAppServer(timeoutMs = 8000): Promise<CodexAppServerProbeResult> {
  if (process.env.HARNESS_HUB_SKIP_CODEX_CLI === '1') {
    return { mcpProbes: [], loadedSkillNames: [] };
  }

  return new Promise((resolve) => {
    const codexBin = process.env.HARNESS_HUB_CODEX_BIN || 'codex';
    let settled = false;
    let mcpProbes: McpProbeResult[] | null = null;
    let loadedSkillNames: string[] | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore
      }
      resolve({
        mcpProbes: mcpProbes ?? [],
        loadedSkillNames: loadedSkillNames ?? [],
      });
    };

    const child = spawn(codexBin, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => finish(), timeoutMs);

    child.on('error', () => finish());

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as {
            id?: number;
            result?: {
              data?: Array<{
                name?: string;
                authStatus?: string;
                tools?: Record<string, unknown>;
                error?: string | null;
                skills?: Array<{ name?: string; enabled?: boolean }>;
              }>;
            };
          };
          if (msg.id === 1) {
            child.stdin.write(
              JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'mcpServerStatus/list', params: {} }) +
                '\n' +
                JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'skills/list', params: {} }) +
                '\n'
            );
          } else if (msg.id === 2) {
            const rows = Array.isArray(msg.result?.data) ? msg.result.data : [];
            mcpProbes = rows.map((srv) => {
              const toolNames = srv.tools ? Object.keys(srv.tools) : [];
              const auth = (srv.authStatus ?? '').toLowerCase();
              let status: VerificationStatus = 'healthy';
              if (srv.error) {
                status = srv.error.includes('401') ? 'auth_required' : 'error';
              } else if (auth.includes('not_logged_in') || auth.includes('required')) {
                status = 'auth_required';
              }
              return {
                id: srv.name ?? 'unknown',
                status,
                toolCount: toolNames.length,
                tools: toolNames,
                message: srv.error
                  ? srv.error
                  : `Codex loaded ${toolNames.length} tools (${srv.authStatus ?? 'ok'})`,
              };
            });
            if (loadedSkillNames !== null) finish();
          } else if (msg.id === 3) {
            const groups = Array.isArray(msg.result?.data) ? msg.result.data : [];
            const names = new Set<string>();
            for (const g of groups) {
              for (const sk of g.skills ?? []) {
                if (sk.name && sk.enabled !== false) {
                  names.add(sk.name);
                }
              }
            }
            loadedSkillNames = Array.from(names).sort();
            if (mcpProbes !== null) finish();
          }
        } catch {
          // Ignore non-JSON stdout
        }
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'harness-hub', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        },
      }) + '\n'
    );
  });
}

export async function verifyHarnessStatic(
  harnessId: HarnessId,
  displayName: string,
  skillsDir: string,
  configPath: string,
  mcpItems?: McpServerItem[]
): Promise<VerificationResult> {
  const [skillCheck, configCheck] = await Promise.all([
    checkSkillsHealth(skillsDir),
    checkConfigParseable(harnessId, configPath),
  ]);

  const installed = skillCheck.exists || configCheck.exists;
  let mcpProbes: McpProbeResult[] = [];
  let loadedSkillNames: string[] | undefined;

  if (harnessId === 'codex' && installed) {
    const codexProbe = await probeCodexAppServer();
    mcpProbes = codexProbe.mcpProbes;
    if (codexProbe.loadedSkillNames.length > 0) {
      loadedSkillNames = codexProbe.loadedSkillNames;
    }
  }

  if (mcpProbes.length === 0 && mcpItems && mcpItems.length > 0) {
    mcpProbes = await Promise.all(
      mcpItems.filter((m) => Boolean(m.url)).map((m) => probeHttpMcpServer(m))
    );
  }

  let status: VerificationStatus = 'healthy';
  if (!installed) {
    status = 'not_installed';
  } else if (!configCheck.valid || skillCheck.brokenSymlinks.length > 0) {
    status = 'error';
  } else if (mcpProbes.some((p) => p.status === 'error')) {
    status = 'error';
  } else if (mcpProbes.some((p) => p.status === 'auth_required')) {
    status = 'auth_required';
  }

  const parts: string[] = [];
  if (!installed) {
    parts.push('Harness directory not detected on host');
  } else {
    parts.push(`${skillCheck.skillsHealthy}/${skillCheck.skillsChecked} skills valid`);
    if (loadedSkillNames !== undefined) {
      parts.push(`${loadedSkillNames.length} loaded in Codex runtime`);
    }
    if (skillCheck.brokenSymlinks.length > 0) {
      parts.push(`${skillCheck.brokenSymlinks.length} broken symlinks`);
    }
    if (!configCheck.valid) {
      parts.push(`Config parse error: ${configCheck.error}`);
    }
    if (mcpProbes.length > 0) {
      const ok = mcpProbes.filter((p) => p.status === 'healthy').length;
      parts.push(`${ok}/${mcpProbes.length} MCP probes healthy`);
    }
  }

  return {
    harnessId,
    displayName,
    status,
    checkedAt: new Date().toISOString(),
    installed,
    skillsChecked: skillCheck.skillsChecked,
    skillsHealthy: skillCheck.skillsHealthy,
    liveSkillsLoaded: loadedSkillNames?.length,
    loadedSkillNames,
    brokenSymlinks: skillCheck.brokenSymlinks,
    configValid: configCheck.valid,
    configError: configCheck.error,
    mcpProbes,
    summary: parts.join(' · '),
  };
}
