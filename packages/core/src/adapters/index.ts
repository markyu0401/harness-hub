import type { HarnessId, HostPaths } from '../types.js';
import { AntigravityAdapter } from './antigravity.js';
import { CodexAdapter } from './codex.js';
import { HermesAdapter } from './hermes.js';
import { OpenCodeAdapter } from './opencode.js';
import type { HarnessAdapter } from './types.js';

export * from './types.js';
export * from './manifest.js';
export * from './symlink-sync.js';
export { BaseHarnessAdapter } from './base-adapter.js';
export { CodexAdapter } from './codex.js';
export { OpenCodeAdapter } from './opencode.js';
export { HermesAdapter } from './hermes.js';
export { AntigravityAdapter } from './antigravity.js';

export function createAdapters(paths: HostPaths): Record<HarnessId, HarnessAdapter> {
  return {
    codex: new CodexAdapter(paths.harnesses.codex.skillsDir, paths.harnesses.codex.configPath),
    opencode: new OpenCodeAdapter(
      paths.harnesses.opencode.skillsDir,
      paths.harnesses.opencode.configPath
    ),
    antigravity: new AntigravityAdapter(
      paths.harnesses.antigravity.skillsDir,
      paths.harnesses.antigravity.configPath
    ),
    hermes: new HermesAdapter(paths.harnesses.hermes.skillsDir, paths.harnesses.hermes.configPath),
  };
}
