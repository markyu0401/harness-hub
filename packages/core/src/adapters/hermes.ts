import YAML from 'yaml';
import { BaseHarnessAdapter, type ConfigPlanOutput } from './base-adapter.js';
import {
  computeMcpConfigActions,
  deepEqualMcpEntry,
  resolveEffectiveMcp,
} from './mcp-config-helper.js';
import type { DesiredMcpEntry, HarnessDesiredState } from './types.js';

function buildHermesEntry(entry: DesiredMcpEntry): Record<string, unknown> {
  const item = resolveEffectiveMcp(entry.item, 'hermes');
  const { allocation } = entry;
  const out: Record<string, unknown> = {};

  if (item.url) {
    out.url = item.url;
    if (item.timeoutSec !== undefined) out.timeout = item.timeoutSec;
    if (item.authType === 'oauth') out.auth = 'oauth';
    if (item.headers && Object.keys(item.headers).length > 0) {
      out.headers = item.headers;
    }
  } else if (item.command) {
    out.command = item.command;
    if (item.args && item.args.length > 0) out.args = item.args;
    if (item.env && Object.keys(item.env).length > 0) out.env = item.env;
  }

  out.enabled = true;

  const enabledTools = allocation.enabledTools ?? item.defaultEnabledTools;
  const disabledTools = allocation.disabledTools ?? item.defaultDisabledTools;
  if ((enabledTools && enabledTools.length > 0) || (disabledTools && disabledTools.length > 0)) {
    const tools: Record<string, unknown> = {};
    if (enabledTools && enabledTools.length > 0) tools.include = enabledTools;
    if (disabledTools && disabledTools.length > 0) tools.exclude = disabledTools;
    out.tools = tools;
  }

  return out;
}

export class HermesAdapter extends BaseHarnessAdapter {
  readonly id = 'hermes' as const;
  readonly displayName = 'Hermes';

  protected parseConfiguredMcpKeys(configText: string): string[] {
    try {
      const parsed = YAML.parse(configText) as Record<string, unknown>;
      const servers = parsed?.mcp_servers;
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
    const doc = YAML.parseDocument(beforeText || '{}\n');
    const plain = (doc.toJS() as Record<string, unknown>) ?? {};
    const existingServers: Record<string, unknown> =
      plain.mcp_servers && typeof plain.mcp_servers === 'object'
        ? (plain.mcp_servers as Record<string, unknown>)
        : {};

    const currentKeys = Object.keys(existingServers);
    const comp = computeMcpConfigActions<Record<string, unknown>>({
      configPath: this.configPath,
      currentKeys,
      desired,
      managedMcpKeys,
      buildEntry: buildHermesEntry,
      buildGatewayEntry: (gw) => ({
        url: gw.url,
        enabled: true,
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
      doc.setIn(['mcp_servers', id], entry);
    }
    for (const key of comp.removeKeys) {
      doc.deleteIn(['mcp_servers', key]);
    }

    const afterText = doc.toString();

    return {
      changed: true,
      actions: comp.actions,
      beforeText,
      afterText,
      nextManagedMcpKeys: comp.nextManagedMcpKeys,
    };
  }
}
