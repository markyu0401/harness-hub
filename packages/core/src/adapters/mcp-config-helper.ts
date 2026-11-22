import {
  extractEnvVarReferences,
  extractExactEnvVarName,
  hasOpReferences,
  recordHasInlineSecret,
} from '../secrets.js';
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
  warnings: string[];
  nextManagedMcpKeys: string[];
}

function asStringMap(val: unknown): Record<string, string> | undefined {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(val)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Inspect an on-disk harness MCP entry to see if it currently stores inline literal credentials.
 */
export function entryHasInlineSecret(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const obj = entry as Record<string, unknown>;
  return (
    recordHasInlineSecret(asStringMap(obj.headers)) ||
    recordHasInlineSecret(asStringMap(obj.http_headers)) ||
    recordHasInlineSecret(asStringMap(obj.env)) ||
    recordHasInlineSecret(asStringMap(obj.environment))
  );
}

/**
 * Validate whether a Direct-mode MCP's secret references can be resolved by the target harness.
 */
export function inspectDirectMcpSecrets(
  item: McpServerItem,
  harnessId: HarnessId,
  availableEnvVars: Set<string>
): { warnings: string[]; hasUnresolvableSecret: boolean } {
  const warnings: string[] = [];
  let hasUnresolvableSecret = false;

  if (hasOpReferences(item.headers) || hasOpReferences(item.env)) {
    hasUnresolvableSecret = true;
    warnings.push(
      `MCP '${item.id}' uses 1Password (op://) references, which ${harnessId} cannot resolve in Direct mode. Switch '${item.id}' to Hub Gateway.`
    );
  }

  const envRefs = Array.from(
    new Set([
      ...extractEnvVarReferences(item.headers),
      ...extractEnvVarReferences(item.env),
    ])
  ).sort();
  const missingEnvVars = envRefs.filter((v) => !availableEnvVars.has(v));
  if (missingEnvVars.length > 0) {
    hasUnresolvableSecret = true;
    warnings.push(
      `MCP '${item.id}' references unset env var(s) (${missingEnvVars.join(', ')}) in Direct mode. Switch '${item.id}' to Hub Gateway with op:// or export them.`
    );
  }

  if (harnessId === 'antigravity' && extractEnvVarReferences(item.headers).length > 0) {
    warnings.push(
      `Antigravity does not expand \${ENV_VAR} inside HTTP headers in Direct mode. Switch '${item.id}' to Hub Gateway.`
    );
  }

  if (harnessId === 'codex' && item.headers) {
    for (const [headerName, rawVal] of Object.entries(item.headers)) {
      const hasEnv = extractEnvVarReferences({ [headerName]: rawVal }).length > 0;
      if (!hasEnv) continue;
      if (extractExactEnvVarName(rawVal)) continue;
      if (
        headerName.toLowerCase() === 'authorization' &&
        /^Bearer\s+\$\{[A-Z0-9_]+\}$/i.test(rawVal.trim())
      ) {
        continue;
      }
      warnings.push(
        `Codex env_http_headers sends env var values verbatim for '${headerName}' and cannot interpolate '${rawVal}'. Store the full header value in the env var or switch '${item.id}' to Hub Gateway.`
      );
    }
  }

  return { warnings, hasUnresolvableSecret };
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
  existingEntries?: Record<string, unknown>;
  availableEnvVars?: Set<string>;
}): McpPlanComputation<TConfigEntry> {
  const availableEnvVars =
    options.availableEnvVars ?? new Set(Object.keys(process.env).filter((k) => process.env[k] !== undefined));
  const desiredEntries = new Map<string, TConfigEntry>();
  const warnings: string[] = [];

  for (const item of options.desired.mcps) {
    const effective = resolveEffectiveMcp(item.item, options.desired.harnessId);
    const diag = inspectDirectMcpSecrets(effective, options.desired.harnessId, availableEnvVars);
    warnings.push(...diag.warnings);

    const existingRaw = options.existingEntries?.[item.id];
    if (diag.hasUnresolvableSecret && existingRaw !== undefined && entryHasInlineSecret(existingRaw)) {
      desiredEntries.set(item.id, existingRaw as TConfigEntry);
      warnings.push(
        `Preserved existing on-disk credentials for '${item.id}' in ${options.desired.harnessId} instead of overwriting with unresolved secret references.`
      );
    } else {
      desiredEntries.set(item.id, options.buildEntry(item));
    }
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
    warnings,
    nextManagedMcpKeys: Array.from(nextManagedSet).sort(),
  };
}
