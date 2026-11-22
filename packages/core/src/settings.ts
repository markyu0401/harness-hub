import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export const HubSettingsSchema = z.object({
  version: z.literal(1).default(1),
  bindMode: z.enum(['local', 'lan']).default('local'),
  port: z.number().int().min(1024).max(65535).default(4310),
  accessPasscodeHash: z.string().optional(),
  exposeSkillsMcp: z.boolean().default(true),
  verifyAfterApply: z.boolean().default(false),
});

export type HubSettings = z.infer<typeof HubSettingsSchema>;

export interface SanitizedHubSettings {
  version: 1;
  bindMode: 'local' | 'lan';
  bindHost: '127.0.0.1' | '0.0.0.0';
  port: number;
  hasPasscode: boolean;
  exposeSkillsMcp: boolean;
  verifyAfterApply: boolean;
}

export function getSettingsPath(hubDir: string): string {
  return path.join(hubDir, 'settings.json');
}

export function resolveBindHost(bindMode: 'local' | 'lan'): '127.0.0.1' | '0.0.0.0' {
  return bindMode === 'lan' ? '0.0.0.0' : '127.0.0.1';
}

export function sanitizeSettingsForApi(settings: HubSettings): SanitizedHubSettings {
  return {
    version: 1,
    bindMode: settings.bindMode,
    bindHost: resolveBindHost(settings.bindMode),
    port: settings.port,
    hasPasscode: Boolean(settings.accessPasscodeHash),
    exposeSkillsMcp: settings.exposeSkillsMcp,
    verifyAfterApply: settings.verifyAfterApply,
  };
}

export async function loadSettings(hubDir: string): Promise<HubSettings> {
  const filePath = getSettingsPath(hubDir);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return HubSettingsSchema.parse(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return HubSettingsSchema.parse({});
    }
    throw err;
  }
}

export async function saveSettings(hubDir: string, settings: HubSettings): Promise<HubSettings> {
  const validated = HubSettingsSchema.parse(settings);
  await fs.mkdir(hubDir, { recursive: true });
  const filePath = getSettingsPath(hubDir);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(validated, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(tmpPath, filePath);
  return validated;
}

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPasscode(passcode: string, storedHash: string | undefined): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  if (!salt || !hexDigest) return false;
  const derived = crypto.scryptSync(passcode, salt, 32);
  const expected = Buffer.from(hexDigest, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function listHostIpv4Addresses(): {
  lanIps: string[];
  tailscaleIps: string[];
} {
  const ifaces = os.networkInterfaces();
  const lanIps: string[] = [];
  const tailscaleIps: string[] = [];

  for (const entries of Object.values(ifaces)) {
    for (const info of entries ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('100.')) {
        tailscaleIps.push(info.address);
      } else if (
        info.address.startsWith('192.168.') ||
        info.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(info.address)
      ) {
        lanIps.push(info.address);
      }
    }
  }

  return {
    lanIps: Array.from(new Set(lanIps)),
    tailscaleIps: Array.from(new Set(tailscaleIps)),
  };
}
