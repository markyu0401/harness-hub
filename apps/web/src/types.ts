export type HarnessId = 'codex' | 'opencode' | 'antigravity' | 'hermes';

export const HARNESS_META: Array<{
  id: HarnessId;
  name: string;
  shortName: string;
  tagline: string;
  accent: string;
}> = [
  { id: 'codex', name: 'Codex', shortName: 'Codex', tagline: 'OpenAI Codex CLI & App', accent: 'emerald' },
  { id: 'opencode', name: 'OpenCode', shortName: 'OpenCode', tagline: 'Model-agnostic coding CLI', accent: 'sky' },
  { id: 'antigravity', name: 'Antigravity', shortName: 'AGY', tagline: 'T3 Code / ACP agent', accent: 'violet' },
  { id: 'hermes', name: 'Hermes', shortName: 'Hermes', tagline: 'Autonomous personal agent', accent: 'amber' },
];

export interface SkillLocation {
  source: string;
  path: string;
  isSymlink: boolean;
  realPath: string;
  sha256: string;
}

export interface SkillWarning {
  code: string;
  severity: 'warn' | 'info';
  message: string;
}

export interface SkillPortability {
  status: 'portable' | 'caution' | 'incomplete';
  hasName: boolean;
  hasDescription: boolean;
  warnings: SkillWarning[];
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  sha256: string;
  canonicalPath: string;
  originSource: string;
  category: string;
  tags: string[];
  attachments: string[];
  locations: SkillLocation[];
  portability?: SkillPortability;
}

export interface SkillConflictVariant {
  source: string;
  path: string;
  realPath: string;
  sha256: string;
  description: string;
  fileCount: number;
}

export interface SkillConflict {
  id: string;
  name: string;
  resolvedPath?: string;
  variants: SkillConflictVariant[];
}

export interface McpServerItem {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  timeoutSec?: number;
  authType: 'none' | 'oauth' | 'bearer' | 'header';
  discoveredIn: string[];
  defaultEnabledTools?: string[];
  defaultDisabledTools?: string[];
}

export interface McpHarnessAllocation {
  enabled: boolean;
  mode: 'direct' | 'gateway';
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface RegistryFile {
  version: 1;
  lastScanAt?: string;
  lastApplyAt?: string;
  gatewayPort: number;
  skills: SkillItem[];
  conflicts: SkillConflict[];
  mcps: McpServerItem[];
  allocations: {
    skills: Record<string, Record<string, boolean>>;
    mcps: Record<string, Record<string, McpHarnessAllocation>>;
  };
}

export interface HarnessDetectionResult {
  harnessId: HarnessId;
  displayName: string;
  installed: boolean;
  skillsDir: string;
  skillsDirExists: boolean;
  configPath: string;
  configExists: boolean;
}

export interface SyncAction {
  kind: string;
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

export interface BackupSnapshot {
  id: string;
  createdAt: string;
  reason: string;
  harnesses: HarnessId[];
  files: Array<{ originalPath: string; backupPath: string; existed: boolean }>;
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

export interface OrganizeAction {
  kind: 'dedup_physical' | 'flatten_symlink' | 'remove_broken_symlink' | 'adopt_symlink';
  skillId: string;
  source: string;
  path: string;
  targetPath?: string;
  summary: string;
}

export interface OrganizePlan {
  actions: OrganizeAction[];
  skippedConflicts: string[];
  counts: {
    duplicateCopies: number;
    chainedSymlinks: number;
    brokenSymlinks: number;
    adoptableSymlinks: number;
  };
  hasChanges: boolean;
}

export interface OrganizeArchiveRecord {
  id: string;
  createdAt: string;
  summary: string;
}

export interface HermesOAuthTokenStatus {
  present: boolean;
  valid: boolean;
  expiresAt?: string;
  hasRefreshToken: boolean;
}

export interface ServiceStatusInfo {
  supported: boolean;
  platform: string;
  installed: boolean;
  running: boolean;
  unitPath: string;
  logPath: string;
  label: string;
}

export interface SettingsPayload {
  settings: {
    version: 1;
    bindMode: 'local' | 'lan';
    bindHost: '127.0.0.1' | '0.0.0.0';
    port: number;
    hasPasscode: boolean;
    exposeSkillsMcp: boolean;
    verifyAfterApply: boolean;
  };
  runtime: {
    listeningHost: string;
    listeningPort: number;
    restartRequired: boolean;
    localUrl: string;
    lanUrls: string[];
    tailscaleUrls: string[];
    serviceStatus: ServiceStatusInfo;
  };
}

export interface HubStatePayload {
  registry: RegistryFile;
  detections: Record<HarnessId, HarnessDetectionResult>;
  plans: Record<HarnessId, SyncPlan>;
  pendingChangesCount: number;
  backups: BackupSnapshot[];
  organizePlan?: OrganizePlan;
  organizeArchives?: OrganizeArchiveRecord[];
  oauthStatuses?: Record<string, HermesOAuthTokenStatus>;
  verifications: VerificationResult[];
  mcpProbes: McpProbeResult[];
}
