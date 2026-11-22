import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyncAction } from '../types.js';
import type { HarnessManifest } from './manifest.js';

export interface SymlinkOperation {
  action: SyncAction;
  skillId: string;
  linkPath: string;
  targetPath?: string;
}

export interface SymlinkPlanResult {
  operations: SymlinkOperation[];
  warnings: string[];
  nextManagedSkills: string[];
}

function isInsideDirectory(parentDir: string, childPath: string): boolean {
  const rel = path.relative(parentDir, childPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function resolveSafePath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Compute safe, manifest-scoped symlink operations for a harness skills directory.
 * Never overwrites or removes unmanaged user directories or builtin skills.
 */
export async function planSkillSymlinks(
  skillsDir: string,
  desiredSkills: Array<{ id: string; canonicalPath: string }>,
  manifest: HarnessManifest
): Promise<SymlinkPlanResult> {
  const operations: SymlinkOperation[] = [];
  const warnings: string[] = [];
  const managedSet = new Set(manifest.managedSkills);
  const nextManagedSet = new Set(manifest.managedSkills);
  const desiredMap = new Map(desiredSkills.map((s) => [s.id, s.canonicalPath]));

  const resolvedSkillsDir = await resolveSafePath(skillsDir);

  for (const { id, canonicalPath } of desiredSkills) {
    const resolvedCanonical = await resolveSafePath(canonicalPath);

    // If the canonical skill already physically lives inside this harness's skillsDir
    // (e.g., nested ~/.hermes/skills/devops/foo), leave it in place untouched.
    if (isInsideDirectory(resolvedSkillsDir, resolvedCanonical)) {
      continue;
    }

    const linkPath = path.join(skillsDir, id);
    let lstat;
    try {
      lstat = await fs.lstat(linkPath);
    } catch {
      lstat = null;
    }

    if (!lstat) {
      operations.push({
        skillId: id,
        linkPath,
        targetPath: resolvedCanonical,
        action: {
          kind: 'symlink_create',
          target: linkPath,
          summary: `Link skill '${id}'`,
          details: `${linkPath} -> ${resolvedCanonical}`,
        },
      });
      nextManagedSet.add(id);
      continue;
    }

    if (lstat.isSymbolicLink()) {
      const currentReal = await resolveSafePath(linkPath);
      if (currentReal === resolvedCanonical) {
        // Already linked to the canonical target.
        continue;
      }
      operations.push({
        skillId: id,
        linkPath,
        targetPath: resolvedCanonical,
        action: {
          kind: 'symlink_update',
          target: linkPath,
          summary: `Update symlink for skill '${id}'`,
          details: `${linkPath} -> ${resolvedCanonical}`,
        },
      });
      nextManagedSet.add(id);
      continue;
    }

    // Real unmanaged directory/file already exists at linkPath: preserve user content!
    warnings.push(
      `Skipped '${id}' in ${skillsDir}: an unmanaged directory or file already exists at ${linkPath}`
    );
    operations.push({
      skillId: id,
      linkPath,
      action: {
        kind: 'symlink_skip_unmanaged',
        target: linkPath,
        summary: `Preserve unmanaged '${id}'`,
        details: `Unmanaged folder exists at ${linkPath}`,
      },
    });
  }

  // Remove only symlinks that HarnessHub itself previously created and are no longer desired
  for (const managedId of managedSet) {
    if (desiredMap.has(managedId)) continue;
    const linkPath = path.join(skillsDir, managedId);
    try {
      const lstat = await fs.lstat(linkPath);
      if (lstat.isSymbolicLink()) {
        operations.push({
          skillId: managedId,
          linkPath,
          action: {
            kind: 'symlink_remove',
            target: linkPath,
            summary: `Unlink skill '${managedId}'`,
            details: `Remove managed symlink ${linkPath}`,
          },
        });
      }
    } catch {
      // Already absent.
    }
    nextManagedSet.delete(managedId);
  }

  return {
    operations,
    warnings,
    nextManagedSkills: Array.from(nextManagedSet).sort(),
  };
}

export async function applySkillSymlinks(operations: SymlinkOperation[]): Promise<{
  applied: number;
  skipped: number;
  errors: string[];
}> {
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const op of operations) {
    try {
      if (op.action.kind === 'symlink_skip_unmanaged') {
        skipped++;
        continue;
      }
      if (op.action.kind === 'symlink_create' && op.targetPath) {
        await fs.mkdir(path.dirname(op.linkPath), { recursive: true });
        await fs.symlink(op.targetPath, op.linkPath, 'dir');
        applied++;
      } else if (op.action.kind === 'symlink_update' && op.targetPath) {
        await fs.unlink(op.linkPath);
        await fs.symlink(op.targetPath, op.linkPath, 'dir');
        applied++;
      } else if (op.action.kind === 'symlink_remove') {
        await fs.unlink(op.linkPath);
        applied++;
      }
    } catch (err) {
      errors.push(
        `Failed ${op.action.kind} for ${op.skillId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { applied, skipped, errors };
}
