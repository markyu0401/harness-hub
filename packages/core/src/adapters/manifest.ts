import fs from 'node:fs/promises';
import path from 'node:path';
import type { BackupSnapshot, HarnessId } from '../types.js';

export const MANIFEST_FILENAME = '.harness-hub-manifest.json';

export interface HarnessManifest {
  version: 1;
  managedSkills: string[];
  managedMcpKeys: string[];
  updatedAt: string;
}

export function getManifestPath(skillsDir: string): string {
  return path.join(skillsDir, MANIFEST_FILENAME);
}

export async function readManifest(skillsDir: string): Promise<HarnessManifest> {
  const manifestPath = getManifestPath(skillsDir);
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HarnessManifest>;
    return {
      version: 1,
      managedSkills: Array.isArray(parsed.managedSkills)
        ? parsed.managedSkills.filter((v): v is string => typeof v === 'string')
        : [],
      managedMcpKeys: Array.isArray(parsed.managedMcpKeys)
        ? parsed.managedMcpKeys.filter((v): v is string => typeof v === 'string')
        : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return {
      version: 1,
      managedSkills: [],
      managedMcpKeys: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function writeManifest(skillsDir: string, manifest: HarnessManifest): Promise<void> {
  await fs.mkdir(skillsDir, { recursive: true });
  const manifestPath = getManifestPath(skillsDir);
  const tmpPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  const payload: HarnessManifest = {
    version: 1,
    managedSkills: Array.from(new Set(manifest.managedSkills)).sort(),
    managedMcpKeys: Array.from(new Set(manifest.managedMcpKeys)).sort(),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, manifestPath);
}

export async function createBackupSnapshot(options: {
  backupsDir: string;
  reason: string;
  harnesses: HarnessId[];
  filePaths: string[];
}): Promise<BackupSnapshot> {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const id = `${stamp}-${Math.random().toString(36).slice(2, 7)}`;
  const snapshotDir = path.join(options.backupsDir, id);
  await fs.mkdir(snapshotDir, { recursive: true });

  const files: BackupSnapshot['files'] = [];
  const uniquePaths = Array.from(new Set(options.filePaths));

  for (let i = 0; i < uniquePaths.length; i++) {
    const originalPath = uniquePaths[i]!;
    const safeName = `${i}-${path.basename(originalPath)}`;
    const backupPath = path.join(snapshotDir, safeName);
    let existed = false;
    try {
      const content = await fs.readFile(originalPath);
      await fs.writeFile(backupPath, content);
      existed = true;
    } catch {
      existed = false;
    }
    files.push({ originalPath, backupPath, existed });
  }

  const snapshot: BackupSnapshot = {
    id,
    createdAt: now.toISOString(),
    reason: options.reason,
    harnesses: options.harnesses,
    files,
  };

  await fs.writeFile(
    path.join(snapshotDir, 'metadata.json'),
    JSON.stringify(snapshot, null, 2) + '\n',
    'utf8'
  );

  return snapshot;
}

export async function listBackupSnapshots(backupsDir: string): Promise<BackupSnapshot[]> {
  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const snapshots: BackupSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await fs.readFile(path.join(backupsDir, entry.name, 'metadata.json'), 'utf8');
        snapshots.push(JSON.parse(raw) as BackupSnapshot);
      } catch {
        // Ignore incomplete backup directories.
      }
    }
    return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function restoreBackupSnapshot(
  backupsDir: string,
  snapshotId: string
): Promise<{ restoredFiles: string[]; removedFiles: string[] }> {
  const metaPath = path.join(backupsDir, snapshotId, 'metadata.json');
  const raw = await fs.readFile(metaPath, 'utf8');
  const snapshot = JSON.parse(raw) as BackupSnapshot;

  const restoredFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const file of snapshot.files) {
    if (file.existed) {
      await fs.mkdir(path.dirname(file.originalPath), { recursive: true });
      const content = await fs.readFile(file.backupPath);
      await fs.writeFile(file.originalPath, content);
      restoredFiles.push(file.originalPath);
    } else {
      try {
        await fs.unlink(file.originalPath);
        removedFiles.push(file.originalPath);
      } catch {
        // Already absent.
      }
    }
  }

  return { restoredFiles, removedFiles };
}
