import fs from 'node:fs/promises';
import { parse as parseToml } from 'smol-toml';
import YAML from 'yaml';
import { sanitizeRecordForStorage } from '../secrets.js';
import type { HarnessId, HostPaths, McpHarnessAllocation, McpServerItem } from '../types.js';

const IGNORED_BUILTIN_MCPS = new Set(['node_repl', 'harness-skills', 'harness-hub']);

interface RawDiscoveredMcp {
  id: string;
  harness: HarnessId;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  envVars?: string[];
  timeoutSec?: number;
  authType: 'none' | 'oauth' | 'bearer' | 'header';
  enabled: boolean;
  enabledTools?: string[];
  disabledTools?: string[];
}

function asStringArray(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  return val.filter((v): v is string => typeof v === 'string');
}

function asStringRecord(val: unknown): Record<string, string> | undefined {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(val)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function inferAuthType(
  rawAuth: unknown,
  headers?: Record<string, string>
): 'none' | 'oauth' | 'bearer' | 'header' {
  if (rawAuth === 'oauth') return 'oauth';
  if (headers) {
    const keys = Object.keys(headers).map((k) => k.toLowerCase());
    if (keys.some((k) => k === 'authorization')) return 'bearer';
    if (keys.length > 0) return 'header';
  }
  return 'none';
}

async function scanCodexMcps(configPath: string): Promise<RawDiscoveredMcp[]> {
  const raw = await readIfExists(configPath);
  if (!raw) return [];
  try {
    const parsed = parseToml(raw) as Record<string, unknown>;
    const servers = parsed.mcp_servers;
    if (!servers || typeof servers !== 'object') return [];

    const result: RawDiscoveredMcp[] = [];
    for (const [id, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (IGNORED_BUILTIN_MCPS.has(id) || !entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const url = typeof obj.url === 'string' ? obj.url : undefined;
      const command = typeof obj.command === 'string' ? obj.command : undefined;
      if (!url && !command) continue;

      const rawHeaders: Record<string, string> = {
        ...(asStringRecord(obj.http_headers) ?? {}),
      };
      const envHttpHeaders = asStringRecord(obj.env_http_headers);
      if (envHttpHeaders) {
        for (const [headerName, envVarName] of Object.entries(envHttpHeaders)) {
          rawHeaders[headerName] = `\${${envVarName}}`;
        }
      }
      if (typeof obj.bearer_token_env_var === 'string' && obj.bearer_token_env_var.trim()) {
        rawHeaders.Authorization = `Bearer \${${obj.bearer_token_env_var.trim()}}`;
      }

      const headers = sanitizeRecordForStorage(
        Object.keys(rawHeaders).length > 0 ? rawHeaders : undefined
      );
      const env = sanitizeRecordForStorage(asStringRecord(obj.env));
      result.push({
        id,
        harness: 'codex',
        transport: url ? 'http' : 'stdio',
        command,
        args: asStringArray(obj.args),
        url,
        headers,
        env,
        envVars: asStringArray(obj.env_vars),
        timeoutSec: typeof obj.tool_timeout_sec === 'number' ? obj.tool_timeout_sec : undefined,
        authType: inferAuthType(undefined, headers),
        enabled: obj.enabled !== false,
        enabledTools: asStringArray(obj.enabled_tools),
        disabledTools: asStringArray(obj.disabled_tools),
      });
    }
    return result;
  } catch {
    return [];
  }
}

function extractOpenCodeEntry(id: string, entry: Record<string, unknown>): RawDiscoveredMcp | null {
  if (IGNORED_BUILTIN_MCPS.has(id)) return null;
  const url = typeof entry.url === 'string' ? entry.url : undefined;
  const cmdArr = asStringArray(entry.command);
  const command = cmdArr?.[0];
  const args = cmdArr ? cmdArr.slice(1) : undefined;
  if (!url && !command) return null;

  const headers = sanitizeRecordForStorage(asStringRecord(entry.headers));
  const env = sanitizeRecordForStorage(asStringRecord(entry.environment));
  const transport: 'stdio' | 'http' | 'sse' =
    entry.type === 'remote' || url ? 'http' : 'stdio';

  return {
    id,
    harness: 'opencode',
    transport,
    command,
    args: args && args.length > 0 ? args : undefined,
    url,
    headers,
    env,
    authType: inferAuthType(undefined, headers),
    enabled: entry.enabled !== false,
  };
}

async function scanOpenCodeMcps(configPath: string): Promise<RawDiscoveredMcp[]> {
  const raw = await readIfExists(configPath);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mcp = parsed.mcp;
    if (!mcp || typeof mcp !== 'object') return [];

    const result: RawDiscoveredMcp[] = [];
    for (const [key, val] of Object.entries(mcp as Record<string, unknown>)) {
      if (!val || typeof val !== 'object') continue;
      const obj = val as Record<string, unknown>;
      // Handle occasional nested `mcp.servers.<name>` layout gracefully while supporting standard `mcp.<name>`
      if (key === 'servers' && !obj.type && !obj.url && !obj.command) {
        for (const [nestedId, nestedVal] of Object.entries(obj)) {
          if (nestedVal && typeof nestedVal === 'object') {
            const item = extractOpenCodeEntry(nestedId, nestedVal as Record<string, unknown>);
            if (item) result.push(item);
          }
        }
        continue;
      }
      const item = extractOpenCodeEntry(key, obj);
      if (item) result.push(item);
    }
    return result;
  } catch {
    return [];
  }
}

async function scanHermesMcps(configPath: string): Promise<RawDiscoveredMcp[]> {
  const raw = await readIfExists(configPath);
  if (!raw) return [];
  try {
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    const servers = parsed?.mcp_servers;
    if (!servers || typeof servers !== 'object') return [];

    const result: RawDiscoveredMcp[] = [];
    for (const [id, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (IGNORED_BUILTIN_MCPS.has(id) || !entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const url = typeof obj.url === 'string' ? obj.url : undefined;
      const command = typeof obj.command === 'string' ? obj.command : undefined;
      if (!url && !command) continue;

      const headers = sanitizeRecordForStorage(asStringRecord(obj.headers));
      const env = sanitizeRecordForStorage(asStringRecord(obj.env));
      const toolsObj =
        obj.tools && typeof obj.tools === 'object'
          ? (obj.tools as Record<string, unknown>)
          : undefined;
      const transport: 'stdio' | 'http' | 'sse' = url
        ? obj.transport === 'sse'
          ? 'sse'
          : 'http'
        : 'stdio';

      result.push({
        id,
        harness: 'hermes',
        transport,
        command,
        args: asStringArray(obj.args),
        url,
        headers,
        env,
        timeoutSec: typeof obj.timeout === 'number' ? obj.timeout : undefined,
        authType: inferAuthType(obj.auth, headers),
        enabled: obj.enabled !== false,
        enabledTools: toolsObj ? asStringArray(toolsObj.include) : undefined,
        disabledTools: toolsObj ? asStringArray(toolsObj.exclude) : undefined,
      });
    }
    return result;
  } catch {
    return [];
  }
}

async function scanAntigravityMcps(configPath: string): Promise<RawDiscoveredMcp[]> {
  const raw = await readIfExists(configPath);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const servers = parsed.mcpServers;
    if (!servers || typeof servers !== 'object') return [];

    const result: RawDiscoveredMcp[] = [];
    for (const [id, entry] of Object.entries(servers as Record<string, unknown>)) {
      if (IGNORED_BUILTIN_MCPS.has(id) || !entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const url =
        typeof obj.serverUrl === 'string'
          ? obj.serverUrl
          : typeof obj.url === 'string'
            ? obj.url
            : undefined;
      const command = typeof obj.command === 'string' ? obj.command : undefined;
      if (!url && !command) continue;

      const headers = sanitizeRecordForStorage(asStringRecord(obj.headers));
      const env = sanitizeRecordForStorage(asStringRecord(obj.env));
      result.push({
        id,
        harness: 'antigravity',
        transport: url ? 'http' : 'stdio',
        command,
        args: asStringArray(obj.args),
        url,
        headers,
        env,
        authType: inferAuthType(undefined, headers),
        enabled: obj.disabled !== true,
      });
    }
    return result;
  } catch {
    return [];
  }
}

export interface McpScanReport {
  mcps: McpServerItem[];
  allocations: Record<string, Partial<Record<HarnessId, McpHarnessAllocation>>>;
}

/**
 * Scan all 4 target harnesses for configured MCP servers and merge them into a unified catalog.
 */
export async function scanMcps(paths: HostPaths): Promise<McpScanReport> {
  const discovered = [
    ...(await scanCodexMcps(paths.harnesses.codex.configPath)),
    ...(await scanOpenCodeMcps(paths.harnesses.opencode.configPath)),
    ...(await scanHermesMcps(paths.harnesses.hermes.configPath)),
    ...(await scanAntigravityMcps(paths.harnesses.antigravity.configPath)),
  ];

  const byId = new Map<string, RawDiscoveredMcp[]>();
  for (const item of discovered) {
    const list = byId.get(item.id) ?? [];
    list.push(item);
    byId.set(item.id, list);
  }

  const mcps: McpServerItem[] = [];
  const allocations: Record<string, Partial<Record<HarnessId, McpHarnessAllocation>>> = {};

  for (const [id, entries] of Array.from(byId.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const primary = entries[0]!;
    const mergedHeaders = Object.assign({}, ...entries.map((e) => e.headers ?? {}));
    const mergedEnv = Object.assign({}, ...entries.map((e) => e.env ?? {}));
    const mergedEnvVars = Array.from(new Set(entries.flatMap((e) => e.envVars ?? [])));

    const firstEnabledTools = entries.find((e) => e.enabledTools?.length)?.enabledTools;
    const firstDisabledTools = entries.find((e) => e.disabledTools?.length)?.disabledTools;

    // Preserve per-harness overrides when the same server id uses a different transport/command/url
    const harnessOverrides: Record<
      string,
      {
        transport?: 'stdio' | 'http' | 'sse';
        command?: string;
        args?: string[];
        url?: string;
        headers?: Record<string, string>;
        env?: Record<string, string>;
      }
    > = {};
    for (const entry of entries) {
      if (entry.transport !== primary.transport || entry.url !== primary.url || entry.command !== primary.command) {
        harnessOverrides[entry.harness] = {
          transport: entry.transport,
          command: entry.command,
          args: entry.args,
          url: entry.url,
          headers: entry.headers,
          env: entry.env,
        };
      }
    }

    mcps.push({
      id,
      name: id,
      transport: primary.transport,
      command: primary.command ?? entries.find((e) => e.command)?.command,
      args: primary.args ?? entries.find((e) => e.args)?.args,
      url: primary.url ?? entries.find((e) => e.url)?.url,
      headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
      env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
      envVars: mergedEnvVars.length > 0 ? mergedEnvVars : undefined,
      timeoutSec: entries.find((e) => e.timeoutSec !== undefined)?.timeoutSec,
      authType: entries.find((e) => e.authType !== 'none')?.authType ?? 'none',
      discoveredIn: Array.from(new Set(entries.map((e) => e.harness))),
      defaultEnabledTools: firstEnabledTools,
      defaultDisabledTools: firstDisabledTools,
      harnessOverrides: Object.keys(harnessOverrides).length > 0 ? harnessOverrides : undefined,
    });

    const perHarness: Partial<Record<HarnessId, McpHarnessAllocation>> = {};
    for (const entry of entries) {
      perHarness[entry.harness] = {
        enabled: entry.enabled,
        mode: 'direct',
        enabledTools: entry.enabledTools,
        disabledTools: entry.disabledTools,
      };
    }
    allocations[id] = perHarness;
  }

  return { mcps, allocations };
}
