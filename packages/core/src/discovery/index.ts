import { createEmptyRegistry } from '../registry-store.js';
import {
  HARNESS_IDS,
  type HarnessId,
  type HostPaths,
  type McpHarnessAllocation,
  type RegistryFile,
} from '../types.js';
import { scanMcps } from './mcp-scanner.js';
import { scanSkills } from './skill-scanner.js';

export {
  computeSkillFingerprint,
  inferSkillCategory,
  parseSkillFrontmatter,
  scanSkills,
  slugifySkillName,
} from './skill-scanner.js';
export { analyzeSkillPortability } from './skill-lint.js';
export { scanMcps } from './mcp-scanner.js';

const HARNESS_SET = new Set<string>(HARNESS_IDS);

function isHarnessId(val: string): val is HarnessId {
  return HARNESS_SET.has(val);
}

/**
 * Non-destructive Import / Audit scan:
 * Scans all skill folders and MCP configs on the host, merges with any existing
 * registry customizations (resolved conflicts, user-added MCPs, gateway modes),
 * and returns a fresh RegistryFile without mutating any harness config or symlink.
 */
export async function discoverAndMergeRegistry(
  paths: HostPaths,
  existing?: RegistryFile
): Promise<RegistryFile> {
  const base = existing ?? createEmptyRegistry(paths);
  const resolvedConflictMap: Record<string, string> = {};
  for (const c of base.conflicts) {
    if (c.resolvedPath) {
      resolvedConflictMap[c.id] = c.resolvedPath;
    }
  }

  const [skillReport, mcpReport] = await Promise.all([
    scanSkills(paths, resolvedConflictMap),
    scanMcps(paths),
  ]);

  // Merge skills allocations: keep existing overrides, otherwise infer from actual presence on disk
  const skillAllocations: Record<string, Record<HarnessId, boolean>> = {};
  for (const skill of skillReport.skills) {
    const prev = base.allocations.skills[skill.id];
    const presentIn = new Set(
      skill.locations.map((loc) => loc.source).filter((s): s is HarnessId => isHarnessId(s))
    );
    skillAllocations[skill.id] = {
      codex: prev?.codex ?? presentIn.has('codex'),
      opencode: prev?.opencode ?? presentIn.has('opencode'),
      antigravity: prev?.antigravity ?? presentIn.has('antigravity'),
      hermes: prev?.hermes ?? presentIn.has('hermes'),
    };
  }

  // Merge MCP catalog (preserve manually registered MCPs not yet written to any harness)
  const mcpById = new Map(mcpReport.mcps.map((m) => [m.id, m]));
  for (const existingMcp of base.mcps) {
    if (!mcpById.has(existingMcp.id)) {
      mcpById.set(existingMcp.id, existingMcp);
    } else {
      // Keep user-customized headers/env secret refs if previously configured in HarnessHub
      const scanned = mcpById.get(existingMcp.id)!;
      mcpById.set(existingMcp.id, {
        ...scanned,
        headers: existingMcp.headers ?? scanned.headers,
        env: existingMcp.env ?? scanned.env,
      });
    }
  }

  const mergedMcps = Array.from(mcpById.values()).sort((a, b) => a.id.localeCompare(b.id));
  const mcpAllocations: Record<string, Record<HarnessId, McpHarnessAllocation>> = {};

  for (const mcp of mergedMcps) {
    const prev = base.allocations.mcps[mcp.id];
    const scanned = mcpReport.allocations[mcp.id];
    const row = {} as Record<HarnessId, McpHarnessAllocation>;
    for (const h of HARNESS_IDS) {
      row[h] = prev?.[h] ??
        scanned?.[h] ?? {
          enabled: false,
          mode: 'direct',
        };
    }
    mcpAllocations[mcp.id] = row;
  }

  const harnesses: RegistryFile['harnesses'] = {};
  for (const h of HARNESS_IDS) {
    harnesses[h] = {
      skillsDir: paths.harnesses[h].skillsDir,
      configPath: paths.harnesses[h].configPath,
      gatewayUrl: `http://127.0.0.1:${base.gatewayPort}/mcp/${h}`,
      exposeSkillsMcp: base.harnesses[h]?.exposeSkillsMcp ?? true,
    };
  }

  return {
    version: 1,
    lastScanAt: new Date().toISOString(),
    lastApplyAt: base.lastApplyAt,
    gatewayPort: base.gatewayPort,
    harnesses,
    skills: skillReport.skills,
    conflicts: skillReport.conflicts,
    mcps: mergedMcps,
    allocations: {
      skills: skillAllocations,
      mcps: mcpAllocations,
    },
  };
}
