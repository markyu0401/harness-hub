import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { RegistryFileSchema, type HostPaths, type RegistryFile } from './types.js';

export function createEmptyRegistry(paths?: HostPaths): RegistryFile {
  const harnesses: RegistryFile['harnesses'] = {};
  if (paths) {
    for (const id of ['codex', 'opencode', 'antigravity', 'hermes'] as const) {
      harnesses[id] = {
        skillsDir: paths.harnesses[id].skillsDir,
        configPath: paths.harnesses[id].configPath,
        exposeSkillsMcp: true,
      };
    }
  }
  return {
    version: 1,
    gatewayPort: 4310,
    harnesses,
    skills: [],
    conflicts: [],
    mcps: [],
    allocations: {
      skills: {},
      mcps: {},
    },
  };
}

export async function loadRegistry(registryPath: string, paths?: HostPaths): Promise<RegistryFile> {
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = YAML.parse(raw);
    return RegistryFileSchema.parse(parsed ?? {});
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return createEmptyRegistry(paths);
    }
    throw err;
  }
}

export async function saveRegistry(registryPath: string, registry: RegistryFile): Promise<void> {
  const validated = RegistryFileSchema.parse(registry);
  const dir = path.dirname(registryPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${registryPath}.tmp-${process.pid}-${Date.now()}`;
  const yamlText = YAML.stringify(validated, {
    lineWidth: 120,
    defaultStringType: 'PLAIN',
  });
  await fs.writeFile(tmpPath, yamlText, 'utf8');
  await fs.rename(tmpPath, registryPath);
}
