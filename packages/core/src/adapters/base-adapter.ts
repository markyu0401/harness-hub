import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApplyResult, HarnessId, SyncAction, SyncPlan, VerificationResult } from '../types.js';
import { verifyHarnessStatic } from '../verifier/verify.js';
import {
  createBackupSnapshot,
  getManifestPath,
  readManifest,
  writeManifest,
} from './manifest.js';
import { applySkillSymlinks, planSkillSymlinks, type SymlinkOperation } from './symlink-sync.js';
import type {
  HarnessAdapter,
  HarnessCurrentState,
  HarnessDesiredState,
  HarnessDetectionResult,
} from './types.js';

export interface ConfigPlanOutput {
  changed: boolean;
  actions: SyncAction[];
  beforeText: string;
  afterText: string;
  nextManagedMcpKeys: string[];
  warnings?: string[];
}

export interface ExtendedSyncPlan extends SyncPlan {
  _internal?: {
    symlinkOps: SymlinkOperation[];
    nextManagedSkills: string[];
    nextManagedMcpKeys: string[];
    configChanged: boolean;
    nextConfigText: string;
  };
}

export abstract class BaseHarnessAdapter implements HarnessAdapter {
  abstract readonly id: HarnessId;
  abstract readonly displayName: string;

  constructor(
    public readonly skillsDir: string,
    public readonly configPath: string
  ) {}

  protected abstract parseConfiguredMcpKeys(configText: string): string[];
  protected abstract planConfigUpdate(
    currentConfigText: string | undefined,
    desired: HarnessDesiredState,
    managedMcpKeys: string[],
    availableEnvVars?: Set<string>
  ): ConfigPlanOutput;

  async detect(): Promise<HarnessDetectionResult> {
    const [skillsDirExists, configExists] = await Promise.all([
      pathExists(this.skillsDir),
      pathExists(this.configPath),
    ]);
    const parentExists = await pathExists(path.dirname(this.configPath));
    return {
      harnessId: this.id,
      displayName: this.displayName,
      installed: skillsDirExists || configExists || parentExists,
      skillsDir: this.skillsDir,
      skillsDirExists,
      configPath: this.configPath,
      configExists,
    };
  }

  async readCurrentState(): Promise<HarnessCurrentState> {
    const manifest = await readManifest(this.skillsDir);
    let installedSkillNames: string[] = [];
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      installedSkillNames = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      installedSkillNames = [];
    }

    let configuredMcpKeys: string[] = [];
    try {
      const text = await fs.readFile(this.configPath, 'utf8');
      configuredMcpKeys = this.parseConfiguredMcpKeys(text);
    } catch {
      configuredMcpKeys = [];
    }

    return {
      harnessId: this.id,
      installedSkillNames,
      managedSkillNames: manifest.managedSkills,
      configuredMcpKeys,
      managedMcpKeys: manifest.managedMcpKeys,
    };
  }

  async planSync(desired: HarnessDesiredState): Promise<ExtendedSyncPlan> {
    const manifest = await readManifest(this.skillsDir);
    const symlinkPlan = await planSkillSymlinks(this.skillsDir, desired.skills, manifest);

    let currentConfigText: string | undefined;
    try {
      currentConfigText = await fs.readFile(this.configPath, 'utf8');
    } catch {
      currentConfigText = undefined;
    }

    const availableEnvVars = await this.collectAvailableEnvVars();
    const configPlan = this.planConfigUpdate(
      currentConfigText,
      desired,
      manifest.managedMcpKeys,
      availableEnvVars
    );
    const actions: SyncAction[] = [
      ...symlinkPlan.operations.map((o) => o.action),
      ...configPlan.actions,
    ];

    const hasActionableChanges = actions.some((a) => a.kind !== 'symlink_skip_unmanaged');

    return {
      harnessId: this.id,
      displayName: this.displayName,
      actions,
      configPreviewBefore: configPlan.changed ? configPlan.beforeText : undefined,
      configPreviewAfter: configPlan.changed ? configPlan.afterText : undefined,
      warnings: [...symlinkPlan.warnings, ...(configPlan.warnings ?? [])],
      hasChanges: hasActionableChanges || configPlan.changed,
      _internal: {
        symlinkOps: symlinkPlan.operations,
        nextManagedSkills: symlinkPlan.nextManagedSkills,
        nextManagedMcpKeys: configPlan.nextManagedMcpKeys,
        configChanged: configPlan.changed,
        nextConfigText: configPlan.afterText,
      },
    };
  }

  async applySync(plan: ExtendedSyncPlan, backupDir: string): Promise<ApplyResult> {
    const internal = plan._internal;
    if (!internal) {
      return {
        harnessId: this.id,
        appliedCount: 0,
        skippedCount: 0,
        errors: ['Invalid SyncPlan: missing internal execution state (generate plan with planSync first).'],
      };
    }

    if (!plan.hasChanges) {
      return {
        harnessId: this.id,
        appliedCount: 0,
        skippedCount: internal.symlinkOps.filter((o) => o.action.kind === 'symlink_skip_unmanaged')
          .length,
        errors: [],
      };
    }

    const manifestPath = getManifestPath(this.skillsDir);
    const snapshot = await createBackupSnapshot({
      backupsDir: backupDir,
      reason: `Apply sync to ${this.displayName}`,
      harnesses: [this.id],
      filePaths: [this.configPath, manifestPath],
    });

    const errors: string[] = [];
    let appliedCount = 0;

    const symlinkResult = await applySkillSymlinks(internal.symlinkOps);
    appliedCount += symlinkResult.applied;
    errors.push(...symlinkResult.errors);

    if (internal.configChanged) {
      try {
        await fs.mkdir(path.dirname(this.configPath), { recursive: true });
        const tmpPath = `${this.configPath}.tmp-${process.pid}-${Date.now()}`;
        await fs.writeFile(tmpPath, internal.nextConfigText, 'utf8');
        await fs.rename(tmpPath, this.configPath);
        appliedCount++;
      } catch (err) {
        errors.push(
          `Failed writing config ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    await writeManifest(this.skillsDir, {
      version: 1,
      managedSkills: internal.nextManagedSkills,
      managedMcpKeys: internal.nextManagedMcpKeys,
      updatedAt: new Date().toISOString(),
    });

    return {
      harnessId: this.id,
      appliedCount,
      skippedCount: symlinkResult.skipped,
      backupId: snapshot.id,
      errors,
    };
  }

  async verifyLive(): Promise<VerificationResult> {
    return verifyHarnessStatic(this.id, this.displayName, this.skillsDir, this.configPath);
  }

  private async collectAvailableEnvVars(): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) keys.add(k);
    }
    if (this.id === 'hermes') {
      try {
        const envRaw = await fs.readFile(path.join(path.dirname(this.configPath), '.env'), 'utf8');
        for (const line of envRaw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const varName = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
            if (varName) keys.add(varName);
          }
        }
      } catch {
        // Optional ~/.hermes/.env may not exist
      }
    }
    return keys;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
