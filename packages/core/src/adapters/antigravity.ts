import { BaseHarnessAdapter, type ConfigPlanOutput } from './base-adapter.js';
import {
  computeMcpConfigActions,
  deepEqualMcpEntry,
  resolveEffectiveMcp,
} from './mcp-config-helper.js';
import type { DesiredMcpEntry, HarnessDesiredState } from './types.js';

function buildAntigravityEntry(entry: DesiredMcpEntry): Record<string, unknown> {
  const item = resolveEffectiveMcp(entry.item, 'antigravity');
  if (item.url) {
    const out: Record<string, unknown> = {
      serverUrl: item.url,
    };
    if (item.headers && Object.keys(item.headers).length > 0) {
      out.headers = item.headers;
    }
    return out;
  }

  const out: Record<string, unknown> = {
    command: item.command ?? '',
  };
  if (item.args && item.args.length > 0) {
    out.args = item.args;
  }
  if (item.env && Object.keys(item.env).length > 0) {
    out.env = item.env;
  }
  return out;
}

export class AntigravityAdapter extends BaseHarnessAdapter {
  readonly id = 'antigravity' as const;
  readonly displayName = 'Antigravity';

  protected parseConfiguredMcpKeys(configText: string): string[] {
    try {
      const parsed = JSON.parse(configText) as Record<string, unknown>;
      const servers = parsed.mcpServers;
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
      ? (JSON.parse(beforeText) as Record<string, unknown>)
      : {};

    const existingServers: Record<string, unknown> =
      parsed.mcpServers && typeof parsed.mcpServers === 'object'
        ? { ...(parsed.mcpServers as Record<string, unknown>) }
        : {};

    const currentKeys = Object.keys(existingServers);
    const comp = computeMcpConfigActions<Record<string, unknown>>({
      configPath: this.configPath,
      currentKeys,
      desired,
      managedMcpKeys,
      buildEntry: buildAntigravityEntry,
      buildGatewayEntry: (gw) => ({
        serverUrl: gw.url,
      }),
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

    parsed.mcpServers = existingServers;
    const afterText = JSON.stringify(parsed, null, 2) + '\n';

    return {
      changed: true,
      actions: comp.actions,
      beforeText,
      afterText,
      nextManagedMcpKeys: comp.nextManagedMcpKeys,
    };
  }
}
