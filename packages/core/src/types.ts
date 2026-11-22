import { z } from 'zod';

export const HARNESS_IDS = ['codex', 'opencode', 'antigravity', 'hermes'] as const;
export const ALL_DISCOVERY_HARNESS_IDS = [
  'codex',
  'opencode',
  'antigravity',
  'hermes',
  'claude',
  'gemini',
  'agents',
] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];
export type DiscoverySourceId = (typeof ALL_DISCOVERY_HARNESS_IDS)[number];

export const HarnessIdSchema = z.enum(HARNESS_IDS);

export const SkillLocationSchema = z.object({
  source: z.string(),
  path: z.string(),
  isSymlink: z.boolean(),
  realPath: z.string(),
  sha256: z.string(),
});
export type SkillLocation = z.infer<typeof SkillLocationSchema>;

export const SkillWarningSchema = z.object({
  code: z.string(),
  severity: z.enum(['warn', 'info']),
  message: z.string(),
});
export type SkillWarning = z.infer<typeof SkillWarningSchema>;

export const SkillPortabilitySchema = z.object({
  status: z.enum(['portable', 'caution', 'incomplete']),
  hasName: z.boolean(),
  hasDescription: z.boolean(),
  warnings: z.array(SkillWarningSchema).default([]),
});
export type SkillPortability = z.infer<typeof SkillPortabilitySchema>;

export const SkillItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sha256: z.string(),
  canonicalPath: z.string(),
  originSource: z.string(),
  category: z.string().default('general'),
  tags: z.array(z.string()).default([]),
  attachments: z.array(z.string()).default([]),
  locations: z.array(SkillLocationSchema).default([]),
  portability: SkillPortabilitySchema.optional(),
});
export type SkillItem = z.infer<typeof SkillItemSchema>;

export const SkillConflictVariantSchema = z.object({
  source: z.string(),
  path: z.string(),
  realPath: z.string(),
  sha256: z.string(),
  description: z.string(),
  fileCount: z.number(),
});
export type SkillConflictVariant = z.infer<typeof SkillConflictVariantSchema>;

export const SkillConflictSchema = z.object({
  id: z.string(),
  name: z.string(),
  resolvedPath: z.string().optional(),
  variants: z.array(SkillConflictVariantSchema),
});
export type SkillConflict = z.infer<typeof SkillConflictSchema>;

export const McpTransportSchema = z.enum(['stdio', 'http', 'sse']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpHarnessOverrideSchema = z.object({
  transport: McpTransportSchema.optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  env: z.record(z.string()).optional(),
});
export type McpHarnessOverride = z.infer<typeof McpHarnessOverrideSchema>;

export const McpServerItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: McpTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  env: z.record(z.string()).optional(),
  envVars: z.array(z.string()).optional(),
  timeoutSec: z.number().optional(),
  authType: z.enum(['none', 'oauth', 'bearer', 'header']).default('none'),
  discoveredIn: z.array(z.string()).default([]),
  defaultEnabledTools: z.array(z.string()).optional(),
  defaultDisabledTools: z.array(z.string()).optional(),
  harnessOverrides: z.record(z.string(), McpHarnessOverrideSchema).optional(),
});
export type McpServerItem = z.infer<typeof McpServerItemSchema>;

export const McpHarnessAllocationSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['direct', 'gateway']).default('direct'),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});
export type McpHarnessAllocation = z.infer<typeof McpHarnessAllocationSchema>;

export const AllocationMatrixSchema = z.object({
  skills: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
  mcps: z.record(z.string(), z.record(z.string(), McpHarnessAllocationSchema)).default({}),
});
export type AllocationMatrix = z.infer<typeof AllocationMatrixSchema>;

export const HarnessRuntimeSettingsSchema = z.object({
  skillsDir: z.string(),
  configPath: z.string(),
  gatewayUrl: z.string().optional(),
  exposeSkillsMcp: z.boolean().default(true),
});
export type HarnessRuntimeSettings = z.infer<typeof HarnessRuntimeSettingsSchema>;

export const RegistryFileSchema = z.object({
  version: z.literal(1).default(1),
  lastScanAt: z.string().optional(),
  lastApplyAt: z.string().optional(),
  gatewayPort: z.number().default(4310),
  harnesses: z.record(z.string(), HarnessRuntimeSettingsSchema).default({}),
  skills: z.array(SkillItemSchema).default([]),
  conflicts: z.array(SkillConflictSchema).default([]),
  mcps: z.array(McpServerItemSchema).default([]),
  allocations: AllocationMatrixSchema.default({ skills: {}, mcps: {} }),
});
export type RegistryFile = z.infer<typeof RegistryFileSchema>;

export interface HostPaths {
  homeDir: string;
  hubDir: string;
  registryPath: string;
  backupsDir: string;
  canonicalSkillsDir: string;
  skillScanDirs: Array<{ source: DiscoverySourceId; dir: string }>;
  harnesses: Record<
    HarnessId,
    {
      skillsDir: string;
      configPath: string;
    }
  >;
}

export type SyncActionKind =
  | 'symlink_create'
  | 'symlink_update'
  | 'symlink_remove'
  | 'symlink_skip_unmanaged'
  | 'mcp_upsert'
  | 'mcp_remove'
  | 'config_create';

export interface SyncAction {
  kind: SyncActionKind;
  target: string;
  summary: string;
  details?: string;
}

export interface SyncPlan {
  harnessId: HarnessId;
  displayName: string;
  actions: SyncAction[];
  configPreviewBefore?: string;
  configPreviewAfter?: string;
  warnings: string[];
  hasChanges: boolean;
}

export interface ApplyResult {
  harnessId: HarnessId;
  appliedCount: number;
  skippedCount: number;
  backupId?: string;
  errors: string[];
}

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  reason: string;
  harnesses: HarnessId[];
  files: Array<{
    originalPath: string;
    backupPath: string;
    existed: boolean;
  }>;
}

export type VerificationStatus = 'healthy' | 'auth_required' | 'error' | 'not_installed';

export interface McpProbeResult {
  id: string;
  status: VerificationStatus;
  toolCount?: number;
  tools?: string[];
  latencyMs?: number;
  message: string;
}

export interface VerificationResult {
  harnessId: HarnessId;
  displayName: string;
  status: VerificationStatus;
  checkedAt: string;
  installed: boolean;
  skillsChecked: number;
  skillsHealthy: number;
  liveSkillsLoaded?: number;
  loadedSkillNames?: string[];
  brokenSymlinks: string[];
  configValid: boolean;
  configError?: string;
  mcpProbes: McpProbeResult[];
  summary: string;
}
