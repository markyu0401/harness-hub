import type { HarnessId, McpServerItem, SyncAction } from '../types.js';
import type { DesiredMcpEntry, HarnessDesiredState } from './types.js';

export function resolveEffectiveMcp(item: McpServerItem, harnessId: HarnessId): McpServerItem {
  const override = item.harnessOverrides?.[harnessId];
  if (!override) return item;
  return {
    ...item,
    transport: override.transport ?? item.transport,
    command: override.command ?? (override.url ? undefined : item.command),
    args: override.args ?? (override.url ? undefined : item.args),
    url: override.url ?? (override.command ? undefined : item.url),
    headers: override.headers ?? item.headers,
    env: override.env ?? item.env,
  };
}

export function deepEqualMcpEntry(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, idx) => deepEqualMcpEntry(v, b[idx]));
  }
  if (typeof a === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA).filter((k) => objA[k] !== undefined);
    const keysB = Object.keys(objB).filter((k) => objB[k] !== undefined);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => Object.prototype.hasOwnProperty.call(objB, k) && deepEqualMcpEntry(objA[k], objB[k]));
  }
  return false;
}

export interface McpPlanComputation<TConfigEntry> {
  desiredEntries: Map<string, TConfigEntry>;
  removeKeys: Set<string>;
  actions: SyncAction[];
  nextManagedMcpKeys: string[];
}

export function computeMcpConfigActions<TConfigEntry>(options: {
  configPath: string;
  currentKeys: string[];
  desired: HarnessDesiredState;
  managedMcpKeys: string[];
  buildEntry: (entry: DesiredMcpEntry) => TConfigEntry;
  buildGatewayEntry: (gateway: NonNullable<HarnessDesiredState['gatewayEntry']>) => TConfigEntry;
  isSameEntry: (existingKey: string, nextEntry: TConfigEntry) => boolean;
  explicitlyDisabledIds?: string[];
}): McpPlanComputation<TConfigEntry> {
  const desiredEntries = new Map<string, TConfigEntry>();
  for (const item of options.desired.mcps) {
    desiredEntries.set(item.id, options.buildEntry(item));
  }
  if (options.desired.gatewayEntry) {
    desiredEntries.set(
      options.desired.gatewayEntry.id,
      options.buildGatewayEntry(options.desired.gatewayEntry)
    );
  }

  const currentKeySet = new Set(options.currentKeys);
  const managedSet = new Set(options.managedMcpKeys);
  const disabledSet = new Set(options.explicitlyDisabledIds ?? []);
  const nextManagedSet = new Set(options.managedMcpKeys);
  const actions: SyncAction[] = [];

  for (const [id, nextEntry] of desiredEntries) {
    if (!currentKeySet.has(id) || !options.isSameEntry(id, nextEntry)) {
      actions.push({
        kind: 'mcp_upsert',
        target: options.configPath,
        summary: `${currentKeySet.has(id) ? 'Update' : 'Add'} MCP '${id}'`,
      });
    }
    nextManagedSet.add(id);
  }

  const removeKeys = new Set<string>();
  for (const existingKey of options.currentKeys) {
    if (desiredEntries.has(existingKey)) continue;
    if (managedSet.has(existingKey) || disabledSet.has(existingKey)) {
      removeKeys.add(existingKey);
      nextManagedSet.delete(existingKey);
      actions.push({
        kind: 'mcp_remove',
        target: options.configPath,
        summary: `Remove MCP '${existingKey}'`,
      });
    }
  }

  for (const managedKey of managedSet) {
    if (!desiredEntries.has(managedKey) && !currentKeySet.has(managedKey)) {
      nextManagedSet.delete(managedKey);
    }
  }

  return {
    desiredEntries,
    removeKeys,
    actions,
    nextManagedMcpKeys: Array.from(nextManagedSet).sort(),
  };
}
