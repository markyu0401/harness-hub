import { formatRecordForOpenCode, hasSecretBackedAuth } from '../secrets.js';
import { BaseHarnessAdapter, type ConfigPlanOutput } from './base-adapter.js';
import {
  computeMcpConfigActions,
  deepEqualMcpEntry,
  resolveEffectiveMcp,
} from './mcp-config-helper.js';
import type { DesiredMcpEntry, HarnessDesiredState } from './types.js';

function buildOpenCodeEntry(entry: DesiredMcpEntry): Record<string, unknown> {
  const item = resolveEffectiveMcp(entry.item, 'opencode');
  if (item.url) {
    const out: Record<string, unknown> = {
      type: 'remote',
      url: item.url,
      enabled: true,
    };
    if (item.headers && Object.keys(item.headers).length > 0) {
      out.headers = formatRecordForOpenCode(item.headers);
      if (hasSecretBackedAuth(item)) {
        out.oauth = false;
      }
    }
    return out;
  }

  const out: Record<string, unknown> = {
    type: 'local',
    command: [item.command ?? '', ...(item.args ?? [])].filter(Boolean),
    enabled: true,
  };
  if (item.env && Object.keys(item.env).length > 0) {
    out.environment = formatRecordForOpenCode(item.env);
  }
  return out;
}

export class OpenCodeAdapter extends BaseHarnessAdapter {
  readonly id = 'opencode' as const;
  readonly displayName = 'OpenCode';

  protected parseConfiguredMcpKeys(configText: string): string[] {
    try {
      const parsed = JSON.parse(configText) as Record<string, unknown>;
      const mcp = parsed.mcp;
      if (!mcp || typeof mcp !== 'object') return [];
      return Object.keys(mcp as Record<string, unknown>)
        .filter((k) => k !== 'servers')
        .sort();
    } catch {
      return [];
    }
  }

  protected planConfigUpdate(
    currentConfigText: string | undefined,
    desired: HarnessDesiredState,
    managedMcpKeys: string[],
    availableEnvVars?: Set<string>
  ): ConfigPlanOutput {
    const beforeText = currentConfigText ?? '';
    const parsed: Record<string, unknown> = beforeText.trim()
      ? (JSON.parse(beforeText) as Record<string, unknown>)
      : {};

    const existingMcp: Record<string, unknown> =
      parsed.mcp && typeof parsed.mcp === 'object'
        ? { ...(parsed.mcp as Record<string, unknown>) }
        : {};

    const currentKeys = Object.keys(existingMcp).filter((k) => k !== 'servers');
    const comp = computeMcpConfigActions<Record<string, unknown>>({
      configPath: this.configPath,
      currentKeys,
      desired,
      managedMcpKeys,
      buildEntry: buildOpenCodeEntry,
      buildGatewayEntry: (gw) => ({
        type: 'remote',
        url: gw.url,
        enabled: true,
      }),
      explicitlyDisabledIds: desired.disabledMcpIds,
      existingEntries: existingMcp,
      availableEnvVars,
      isSameEntry: (key, nextEntry) => deepEqualMcpEntry(existingMcp[key], nextEntry),
    });

    if (comp.actions.length === 0) {
      return {
        changed: false,
        actions: [],
        beforeText,
        afterText: beforeText,
        nextManagedMcpKeys: comp.nextManagedMcpKeys,
        warnings: comp.warnings,
      };
    }

    for (const [id, entry] of comp.desiredEntries) {
      existingMcp[id] = entry;
    }
    for (const key of comp.removeKeys) {
      delete existingMcp[key];
    }

    parsed.mcp = existingMcp;
    const afterText = JSON.stringify(parsed, null, 2) + '\n';

    return {
      changed: true,
      actions: comp.actions,
      beforeText,
      afterText,
      nextManagedMcpKeys: comp.nextManagedMcpKeys,
      warnings: comp.warnings,
    };
  }
}
