import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostPaths } from './types.js';

function findAntigravityProfileDir(homeDir: string): { skillsDir: string; configPath: string } {
  const t3AgyRoot = path.join(homeDir, '.t3', 'userdata', 'providers', 'antigravity');
  if (fs.existsSync(t3AgyRoot)) {
    try {
      const entries = fs.readdirSync(t3AgyRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const cfgDir = path.join(t3AgyRoot, entry.name, 'config');
        if (fs.existsSync(cfgDir)) {
          return {
            skillsDir: path.join(cfgDir, 'skills'),
            configPath: path.join(cfgDir, 'mcp_config.json'),
          };
        }
      }
    } catch {
      // Ignore unreadable directory and fall back to default path.
    }
  }

  return {
    skillsDir: path.join(homeDir, '.gemini', 'config', 'skills'),
    configPath: path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json'),
  };
}

/**
 * Resolve all host paths for HarnessHub.
 * Supports passing a custom `homeDir` so tests run cleanly in isolated temp sandboxes.
 */
export function resolveHostPaths(options?: {
  homeDir?: string;
  hubDir?: string;
}): HostPaths {
  const homeDir = path.resolve(options?.homeDir ?? os.homedir());
  const hubDir = path.resolve(options?.hubDir ?? path.join(homeDir, '.harness-hub'));
  const agy = findAntigravityProfileDir(homeDir);
  const geminiSkillsDir = path.join(homeDir, '.gemini', 'config', 'skills');

  const skillScanDirs: HostPaths['skillScanDirs'] = [
    { source: 'agents', dir: path.join(homeDir, '.agents', 'skills') },
    { source: 'hermes', dir: path.join(homeDir, '.hermes', 'skills') },
    { source: 'opencode', dir: path.join(homeDir, '.config', 'opencode', 'skills') },
    { source: 'codex', dir: path.join(homeDir, '.codex', 'skills') },
    { source: 'claude', dir: path.join(homeDir, '.claude', 'skills') },
    { source: 'antigravity', dir: agy.skillsDir },
  ];

  if (agy.skillsDir !== geminiSkillsDir) {
    skillScanDirs.push({ source: 'gemini', dir: geminiSkillsDir });
  }

  return {
    homeDir,
    hubDir,
    registryPath: path.join(hubDir, 'registry.yaml'),
    backupsDir: path.join(hubDir, 'backups'),
    canonicalSkillsDir: path.join(hubDir, 'skills'),
    skillScanDirs,
    harnesses: {
      codex: {
        skillsDir: path.join(homeDir, '.codex', 'skills'),
        configPath: path.join(homeDir, '.codex', 'config.toml'),
      },
      opencode: {
        skillsDir: path.join(homeDir, '.config', 'opencode', 'skills'),
        configPath: path.join(homeDir, '.config', 'opencode', 'opencode.json'),
      },
      antigravity: agy,
      hermes: {
        skillsDir: path.join(homeDir, '.hermes', 'skills'),
        configPath: path.join(homeDir, '.hermes', 'config.yaml'),
      },
    },
  };
}
