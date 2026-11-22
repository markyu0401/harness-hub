import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { BaseHarnessAdapter, type ConfigPlanOutput } from './base-adapter.js';
import {
  computeMcpConfigActions,
  deepEqualMcpEntry,
  resolveEffectiveMcp,
} from './mcp-config-helper.js';
import type { DesiredMcpEntry, HarnessDesiredState } from './types.js';

function buildCodexEntry(entry: DesiredMcpEntry): Record<string, unknown> {
  const item = resolveEffectiveMcp(entry.item, 'codex');
  const { allocation } = entry;
  const out: Record<string, unknown> = {};

  if (item.url) {
    out.url = item.url;
    if (item.headers && Object.keys(item.headers).length > 0) {
      out.http_headers = item.headers;
    }
  } else if (item.command) {
    out.command = item.command;
    if (item.args && item.args.length > 0) {
      out.args = item.args;
    }
    if (item.env && Object.keys(item.env).length > 0) {
      out.env = item.env;
    }
    if (item.envVars && item.envVars.length > 0) {
      out.env_vars = item.envVars;
    }
  }

  if (item.timeoutSec !== undefined) {
    out.tool_timeout_sec = item.timeoutSec;
  }

  const enabledTools = allocation.enabledTools ?? item.defaultEnabledTools;
  const disabledTools = allocation.disabledTools ?? item.defaultDisabledTools;
  if (enabledTools && enabledTools.length > 0) {
    out.enabled_tools = enabledTools;
  }
  if (disabledTools && disabledTools.length > 0) {
    out.disabled_tools = disabledTools;
  }

  return out;
}

export class CodexAdapter extends BaseHarnessAdapter {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex';

  protected parseConfiguredMcpKeys(configText: string): string[] {
    try {
      const parsed = parseToml(configText) as Record<string, unknown>;
      const servers = parsed.mcp_servers;
      if (!servers || typeof servers !== 'object') return [];
      return Object.keys(servers as Record<string, unknown>).sort();
    } catch {
      return [];
    }
  }

  protected planConfigUpdate(
    currentConfigText: string | undefined,
    desired: HarnessDesiredState,
    managedMcpKeys: string[]
  ): ConfigPlanOutput {
    const beforeText = currentConfigText ?? '';
    const parsed: Record<string, unknown> = beforeText.trim()
      ? (parseToml(beforeText) as Record<string, unknown>)
      : {};

    const existingServers: Record<string, unknown> =
      parsed.mcp_servers && typeof parsed.mcp_servers === 'object'
        ? { ...(parsed.mcp_servers as Record<string, unknown>) }
        : {};

    const currentKeys = Object.keys(existingServers);
    const comp = computeMcpConfigActions<Record<string, unknown>>({
      configPath: this.configPath,
      currentKeys,
      desired,
      managedMcpKeys,
      buildEntry: buildCodexEntry,
      buildGatewayEntry: (gw) => ({ url: gw.url }),
      explicitlyDisabledIds: desired.disabledMcpIds,
      isSameEntry: (key, nextEntry) => deepEqualMcpEntry(existingServers[key], nextEntry),
    });

    if (comp.actions.length === 0) {
      return {
        changed: false,
        actions: [],
        beforeText,
        afterText: beforeText,
        nextManagedMcpKeys: comp.nextManagedMcpKeys,
      };
    }

    for (const [id, entry] of comp.desiredEntries) {
      existingServers[id] = entry;
    }
    for (const key of comp.removeKeys) {
      delete existingServers[key];
    }

    parsed.mcp_servers = existingServers;
    const afterText = stringifyToml(parsed) + '\n';

    return {
      changed: true,
      actions: comp.actions,
      beforeText,
      afterText,
      nextManagedMcpKeys: comp.nextManagedMcpKeys,
    };
  }
}
