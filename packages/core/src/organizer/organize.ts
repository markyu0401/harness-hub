import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest, writeManifest } from '../adapters/manifest.js';
import { HARNESS_IDS, type HarnessId, type HostPaths, type RegistryFile } from '../types.js';

export type OrganizeActionKind =
  | 'dedup_physical'
  | 'flatten_symlink'
  | 'remove_broken_symlink'
  | 'adopt_symlink';

export interface OrganizeAction {
  kind: OrganizeActionKind;
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
  entries: Array<{
    kind: 'dir' | 'symlink';
    originalPath: string;
    archivePath?: string;
    originalTarget?: string;
  }>;
}

export interface OrganizeApplyResult {
  archiveId?: string;
  appliedCount: number;
  errors: string[];
}

function getArchivesDir(paths: HostPaths): string {
  return path.join(paths.hubDir, 'archive');
}

async function moveDirSafe(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw err;
    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });
  }
}

async function scanBrokenSymlinksInDir(
  dir: string,
  source: string,
  depth = 0,
  out: OrganizeAction[] = []
): Promise<OrganizeAction[]> {
  if (depth > 2) return out;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    try {
      const lstat = await fs.lstat(full);
      if (lstat.isSymbolicLink()) {
        try {
          await fs.realpath(full);
        } catch {
          const rawTarget = await fs.readlink(full).catch(() => '');
          out.push({
            kind: 'remove_broken_symlink',
            skillId: entry.name,
            source,
            path: full,
            targetPath: rawTarget,
            summary: `Remove broken symlink '${entry.name}' in ${source}`,
          });
        }
      } else if (lstat.isDirectory()) {
        // Recurse only into non-skill category directories
        try {
          await fs.access(path.join(full, 'SKILL.md'));
        } catch {
          await scanBrokenSymlinksInDir(full, source, depth + 1, out);
        }
      }
    } catch {
      // Ignore unreadable entries
    }
  }

  return out;
}

/**
 * Inspect all skill directories and produce an OrganizePlan that:
 * 1. Collapses duplicate physical copies of the same skill into 1 canonical copy + 1-hop symlinks
 * 2. Flattens chained or indirect symlinks into direct 1-hop links to canonicalPath
 * 3. Cleans broken/dangling symlinks
 * 4. Adopts unmanaged symlinks in harness directories into HarnessHub manifests
 */
export async function planLibraryOrganization(
  paths: HostPaths,
  registry: RegistryFile
): Promise<OrganizePlan> {
  const actions: OrganizeAction[] = [];
  const skippedConflicts: string[] = [];

  const unresolvedConflictIds = new Set(
    registry.conflicts.filter((c) => !c.resolvedPath).map((c) => c.id)
  );

  // Load manifests for the 4 managed harnesses to detect unmanaged symlinks
  const harnessManifests = new Map<HarnessId, Set<string>>();
  for (const h of HARNESS_IDS) {
    const manifest = await readManifest(paths.harnesses[h].skillsDir);
    harnessManifests.set(h, new Set(manifest.managedSkills));
  }

  for (const skill of registry.skills) {
    if (unresolvedConflictIds.has(skill.id)) {
      skippedConflicts.push(skill.id);
      continue;
    }

    let canonicalReal: string;
    try {
      canonicalReal = await fs.realpath(skill.canonicalPath);
    } catch {
      canonicalReal = path.resolve(skill.canonicalPath);
    }

    for (const loc of skill.locations) {
      let locReal = loc.realPath;
      try {
        locReal = await fs.realpath(loc.path);
      } catch {
        // Keep discovered realPath
      }

      if (!loc.isSymlink) {
        // Skip the canonical physical home itself
        if (locReal === canonicalReal) continue;

        actions.push({
          kind: 'dedup_physical',
          skillId: skill.id,
          source: loc.source,
          path: loc.path,
          targetPath: canonicalReal,
          summary: `Archive duplicate copy of '${skill.name}' in ${loc.source} and replace with a direct link`,
        });
        continue;
      }

      // It is a symlink — check if it is chained (direct link target !== canonicalReal) or broken
      try {
        const rawTarget = await fs.readlink(loc.path);
        const resolvedDirect = path.resolve(path.dirname(loc.path), rawTarget);
        let needsFlatten = resolvedDirect !== canonicalReal;
        if (needsFlatten) {
          // Check if direct target is itself a symlink (chained A -> B -> C)
          try {
            const directLstat = await fs.lstat(resolvedDirect);
            if (directLstat.isSymbolicLink() || locReal !== canonicalReal) {
              needsFlatten = true;
            } else {
              // e.g. /var vs /private/var on macOS
              const directReal = await fs.realpath(resolvedDirect);
              needsFlatten = directReal !== canonicalReal || directLstat.isSymbolicLink();
            }
          } catch {
            needsFlatten = true;
          }
        }

        if (needsFlatten) {
          actions.push({
            kind: 'flatten_symlink',
            skillId: skill.id,
            source: loc.source,
            path: loc.path,
            targetPath: canonicalReal,
            summary: `Point '${skill.name}' in ${loc.source} directly to its main copy`,
          });
        }
      } catch {
        // Ignore
      }

      // Check if this symlink in a managed harness dir is not yet adopted in manifest
      if ((HARNESS_IDS as readonly string[]).includes(loc.source)) {
        const h = loc.source as HarnessId;
        const managedSet = harnessManifests.get(h);
        const expectedTopLevel = path.join(paths.harnesses[h].skillsDir, skill.id);
        if (loc.path === expectedTopLevel && managedSet && !managedSet.has(skill.id)) {
          actions.push({
            kind: 'adopt_symlink',
            skillId: skill.id,
            source: loc.source,
            path: loc.path,
            summary: `Manage existing link for '${skill.name}' in ${loc.source}`,
          });
        }
      }
    }
  }

  // Scan for broken symlinks across all scan dirs
  for (const { source, dir } of paths.skillScanDirs) {
    await scanBrokenSymlinksInDir(dir, source, 0, actions);
  }

  const counts = {
    duplicateCopies: actions.filter((a) => a.kind === 'dedup_physical').length,
    chainedSymlinks: actions.filter((a) => a.kind === 'flatten_symlink').length,
    brokenSymlinks: actions.filter((a) => a.kind === 'remove_broken_symlink').length,
    adoptableSymlinks: actions.filter((a) => a.kind === 'adopt_symlink').length,
  };

  return {
    actions,
    skippedConflicts,
    counts,
    hasChanges: actions.length > 0,
  };
}

/**
 * Safely execute an OrganizePlan:
 * - Archives replaced physical directories under ~/.harness-hub/archive/<id>/ before symlinking
 * - Flattens multi-hop symlinks to 1-hop direct symlinks
 * - Cleans broken symlinks
 * - Adopts existing symlinks into HarnessHub manifests
 */
export async function applyLibraryOrganization(
  paths: HostPaths,
  plan: OrganizePlan
): Promise<OrganizeApplyResult> {
  if (!plan.hasChanges) {
    return { appliedCount: 0, errors: [] };
  }

  const now = new Date();
  const archiveId = `${now.toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const archiveDir = path.join(getArchivesDir(paths), archiveId);
  const archiveEntries: OrganizeArchiveRecord['entries'] = [];
  const errors: string[] = [];
  let appliedCount = 0;

  const needsArchive = plan.actions.some(
    (a) =>
      a.kind === 'dedup_physical' ||
      a.kind === 'flatten_symlink' ||
      a.kind === 'remove_broken_symlink'
  );
  if (needsArchive) {
    await fs.mkdir(archiveDir, { recursive: true });
  }

  // Group manifest adoptions per harness
  const adoptByHarness = new Map<HarnessId, Set<string>>();

  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]!;
    try {
      if (action.kind === 'dedup_physical' && action.targetPath) {
        const dest = path.join(archiveDir, `${i}-${action.source}-${action.skillId}`);
        await moveDirSafe(action.path, dest);
        await fs.symlink(action.targetPath, action.path, 'dir');
        archiveEntries.push({
          kind: 'dir',
          originalPath: action.path,
          archivePath: dest,
        });
        if ((HARNESS_IDS as readonly string[]).includes(action.source)) {
          const h = action.source as HarnessId;
          if (action.path === path.join(paths.harnesses[h].skillsDir, action.skillId)) {
            const set = adoptByHarness.get(h) ?? new Set<string>();
            set.add(action.skillId);
            adoptByHarness.set(h, set);
          }
        }
        appliedCount++;
      } else if (action.kind === 'flatten_symlink' && action.targetPath) {
        const oldTarget = await fs.readlink(action.path).catch(() => undefined);
        await fs.unlink(action.path);
        await fs.symlink(action.targetPath, action.path, 'dir');
        archiveEntries.push({
          kind: 'symlink',
          originalPath: action.path,
          originalTarget: oldTarget,
        });
        appliedCount++;
      } else if (action.kind === 'remove_broken_symlink') {
        const oldTarget = await fs.readlink(action.path).catch(() => undefined);
        await fs.unlink(action.path);
        archiveEntries.push({
          kind: 'symlink',
          originalPath: action.path,
          originalTarget: oldTarget,
        });
        appliedCount++;
      } else if (action.kind === 'adopt_symlink') {
        if ((HARNESS_IDS as readonly string[]).includes(action.source)) {
          const h = action.source as HarnessId;
          const set = adoptByHarness.get(h) ?? new Set<string>();
          set.add(action.skillId);
          adoptByHarness.set(h, set);
          appliedCount++;
        }
      }
    } catch (err) {
      errors.push(
        `Failed ${action.kind} at ${action.path}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  for (const [harnessId, newIds] of adoptByHarness) {
    const skillsDir = paths.harnesses[harnessId].skillsDir;
    const manifest = await readManifest(skillsDir);
    await writeManifest(skillsDir, {
      ...manifest,
      managedSkills: Array.from(new Set([...manifest.managedSkills, ...newIds])),
    });
  }

  if (needsArchive) {
    const record: OrganizeArchiveRecord = {
      id: archiveId,
      createdAt: now.toISOString(),
      summary: `Consolidated ${plan.counts.duplicateCopies} duplicates, flattened ${plan.counts.chainedSymlinks} links, cleaned ${plan.counts.brokenSymlinks} broken links`,
      entries: archiveEntries,
    };
    await fs.writeFile(
      path.join(archiveDir, 'metadata.json'),
      JSON.stringify(record, null, 2) + '\n',
      'utf8'
    );
  }

  return {
    archiveId: needsArchive ? archiveId : undefined,
    appliedCount,
    errors,
  };
}

export async function listOrganizeArchives(paths: HostPaths): Promise<OrganizeArchiveRecord[]> {
  const dir = getArchivesDir(paths);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const records: OrganizeArchiveRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry.name, 'metadata.json'), 'utf8');
        records.push(JSON.parse(raw) as OrganizeArchiveRecord);
      } catch {
        // Ignore incomplete archive dirs
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function undoLibraryOrganization(
  paths: HostPaths,
  archiveId: string
): Promise<{ restoredCount: number }> {
  const metaPath = path.join(getArchivesDir(paths), archiveId, 'metadata.json');
  const raw = await fs.readFile(metaPath, 'utf8');
  const record = JSON.parse(raw) as OrganizeArchiveRecord;

  let restoredCount = 0;
  for (const entry of [...record.entries].reverse()) {
    try {
      await fs.unlink(entry.originalPath).catch(() => {});
      if (entry.kind === 'dir' && entry.archivePath) {
        await moveDirSafe(entry.archivePath, entry.originalPath);
        restoredCount++;
      } else if (entry.kind === 'symlink' && entry.originalTarget) {
        await fs.mkdir(path.dirname(entry.originalPath), { recursive: true });
        await fs.symlink(entry.originalTarget, entry.originalPath, 'dir');
        restoredCount++;
      }
    } catch {
      // Continue restoring remaining entries
    }
  }

  return { restoredCount };
}
