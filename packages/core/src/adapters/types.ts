import type {
  ApplyResult,
  HarnessId,
  McpHarnessAllocation,
  McpServerItem,
  RegistryFile,
  SyncPlan,
  VerificationResult,
} from '../types.js';

export interface HarnessDetectionResult {
  harnessId: HarnessId;
  displayName: string;
  installed: boolean;
  skillsDir: string;
  skillsDirExists: boolean;
  configPath: string;
  configExists: boolean;
}

export interface HarnessCurrentState {
  harnessId: HarnessId;
  installedSkillNames: string[];
  managedSkillNames: string[];
  configuredMcpKeys: string[];
  managedMcpKeys: string[];
}

export interface DesiredMcpEntry {
  id: string;
  item: McpServerItem;
  allocation: McpHarnessAllocation;
}

export interface HarnessDesiredState {
  harnessId: HarnessId;
  skills: Array<{ id: string; canonicalPath: string }>;
  mcps: DesiredMcpEntry[];
  disabledMcpIds?: string[];
  gatewayEntry?: {
    id: string;
    url: string;
  };
}

export interface HarnessAdapter {
  readonly id: HarnessId;
  readonly displayName: string;
  readonly skillsDir: string;
  readonly configPath: string;
  detect(): Promise<HarnessDetectionResult>;
  readCurrentState(): Promise<HarnessCurrentState>;
  planSync(desired: HarnessDesiredState): Promise<SyncPlan>;
  applySync(plan: SyncPlan, backupDir: string): Promise<ApplyResult>;
  verifyLive(): Promise<VerificationResult>;
}

export function buildDesiredStateForHarness(
  registry: RegistryFile,
  harnessId: HarnessId,
  options?: { includeGateway?: boolean }
): HarnessDesiredState {
  const skills: Array<{ id: string; canonicalPath: string }> = [];
  for (const skill of registry.skills) {
    if (registry.allocations.skills[skill.id]?.[harnessId]) {
      skills.push({ id: skill.id, canonicalPath: skill.canonicalPath });
    }
  }

  const mcps: DesiredMcpEntry[] = [];
  const disabledMcpIds: string[] = [];
  let hasGatewayMcp = false;
  for (const item of registry.mcps) {
    const alloc = registry.allocations.mcps[item.id]?.[harnessId];
    if (!alloc || !alloc.enabled) {
      disabledMcpIds.push(item.id);
      continue;
    }
    if (alloc.mode === 'gateway') {
      hasGatewayMcp = true;
      disabledMcpIds.push(item.id);
    } else {
      mcps.push({ id: item.id, item, allocation: alloc });
    }
  }

  const settings = registry.harnesses[harnessId];
  const wantGateway =
    options?.includeGateway !== false && (hasGatewayMcp || settings?.exposeSkillsMcp);

  const gatewayEntry =
    wantGateway && settings?.gatewayUrl
      ? { id: 'harness-hub', url: settings.gatewayUrl }
      : undefined;

  return {
    harnessId,
    skills,
    mcps,
    disabledMcpIds,
    gatewayEntry,
  };
}
