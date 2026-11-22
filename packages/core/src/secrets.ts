import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SECRET_KEY_PATTERN = /(token|secret|key|password|passwd|auth|bearer|cookie|credential)/i;
const SECRET_VALUE_PATTERN = /^(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|ops_[A-Za-z0-9]{20,}|xox[baprs]-|Bearer\s+\S{12,})/i;
const ENV_REF_EXACT_PATTERN = /^\$\{([A-Z0-9_]+)\}$/;
const ENV_REF_TEST_PATTERN = /\$\{([A-Z0-9_]+)\}/;
const ENV_REF_GLOBAL_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const OPENCODE_ENV_TEST_PATTERN = /\{env:([A-Z0-9_]+)\}/;
const OPENCODE_ENV_GLOBAL_PATTERN = /\{env:([A-Z0-9_]+)\}/g;
const OP_REF_TEST_PATTERN = /op:\/\/[^\s"']+/;
const OP_REF_GLOBAL_PATTERN = /op:\/\/[^\s"']+/g;

/**
 * Normalize OpenCode `{env:VAR}` syntax into canonical `${VAR}` references.
 */
export function normalizeSecretReference(value: string): string {
  return value.replace(OPENCODE_ENV_GLOBAL_PATTERN, (_, varName: string) => `\${${varName}}`);
}

/**
 * Convert canonical `${VAR}` references into OpenCode `{env:VAR}` syntax.
 */
export function formatValueForOpenCode(value: string): string {
  return value.replace(ENV_REF_GLOBAL_PATTERN, (_, varName: string) => `{env:${varName}}`);
}

/**
 * Convert all string entries in a record to OpenCode `{env:VAR}` syntax.
 */
export function formatRecordForOpenCode(
  record: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = formatValueForOpenCode(value);
  }
  return out;
}

/**
 * Extract an exact `${VAR}` or `{env:VAR}` variable name if the entire string is a single env ref.
 */
export function extractExactEnvVarName(value: string): string | undefined {
  const normalized = normalizeSecretReference(value.trim());
  const match = ENV_REF_EXACT_PATTERN.exec(normalized);
  return match?.[1];
}

/**
 * Extract all `${VAR}` / `{env:VAR}` environment variable names referenced across a record.
 */
export function extractEnvVarReferences(record: Record<string, string> | undefined): string[] {
  if (!record) return [];
  const vars = new Set<string>();
  for (const value of Object.values(record)) {
    const normalized = normalizeSecretReference(value);
    for (const match of normalized.matchAll(ENV_REF_GLOBAL_PATTERN)) {
      if (match[1]) vars.add(match[1]);
    }
  }
  return Array.from(vars).sort();
}

/**
 * Check whether any entry in a record contains a 1Password `op://` reference.
 */
export function hasOpReferences(record: Record<string, string> | undefined): boolean {
  if (!record) return false;
  return Object.values(record).some((value) => OP_REF_TEST_PATTERN.test(value));
}

/**
 * Determine if an MCP server item relies on secret references or OAuth credentials.
 */
export function hasSecretBackedAuth(item: {
  authType?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}): boolean {
  if (item.authType && item.authType !== 'none') return true;
  if (hasOpReferences(item.headers) || hasOpReferences(item.env)) return true;
  if (
    extractEnvVarReferences(item.headers).length > 0 ||
    extractEnvVarReferences(item.env).length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Determine if a reference string is a safe secret reference rather than a raw literal.
 */
export function isSecretReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    OP_REF_TEST_PATTERN.test(trimmed) ||
    ENV_REF_TEST_PATTERN.test(trimmed) ||
    OPENCODE_ENV_TEST_PATTERN.test(trimmed)
  );
}

/**
 * Check whether a key name or value looks like sensitive credential material.
 */
export function isSensitiveEntry(key: string, value: string): boolean {
  if (isSecretReference(value)) return false;
  if (SECRET_KEY_PATTERN.test(key) && value.trim().length > 0) return true;
  if (SECRET_VALUE_PATTERN.test(value.trim())) return true;
  return false;
}

/**
 * Check whether a plain config record contains any unredacted inline secret literal.
 */
export function recordHasInlineSecret(record: Record<string, string> | undefined): boolean {
  if (!record) return false;
  return Object.entries(record).some(([key, value]) => isSensitiveEntry(key, value));
}

/**
 * Redact inline secret values when importing or returning configs to the UI/logs.
 * Preserves `op://Vault/Item/Field` and `${ENV_VAR}` (including embedded & `{env:VAR}`) references.
 */
export function sanitizeRecordForStorage(
  record: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSecretReference(value)) {
      out[key] = normalizeSecretReference(value);
    } else if (isSensitiveEntry(key, value)) {
      const envCandidate = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      out[key] = `\${${envCandidate}}`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Mask any secret references or sensitive values for safe UI display.
 */
export function maskRecordForUi(
  record: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSecretReference(value)) {
      out[key] = value;
    } else if (isSensitiveEntry(key, value)) {
      out[key] = '<redacted>';
    } else {
      out[key] = value;
    }
  }
  return out;
}

export type OpSecretReader = (opRef: string) => Promise<string>;

async function defaultOpReader(opRef: string): Promise<string> {
  const opBin = process.env.HARNESS_HUB_OP_BIN || '/opt/homebrew/bin/op-hermes';
  const { stdout } = await execFileAsync(opBin, ['read', opRef], {
    timeout: 10_000,
    maxBuffer: 1024 * 64,
  });
  return stdout.trim();
}

/**
 * Resolve secret references (`op://...` or `${ENV_VAR}`) at runtime ONLY.
 * Never write the returned object to disk, logs, or API responses.
 */
export async function resolveRuntimeSecrets(
  record: Record<string, string> | undefined,
  options?: {
    env?: NodeJS.ProcessEnv;
    opReader?: OpSecretReader;
  }
): Promise<Record<string, string>> {
  if (!record) return {};
  const env = options?.env ?? process.env;
  const opReader = options?.opReader ?? defaultOpReader;
  const resolved: Record<string, string> = {};
  const opCache = new Map<string, string>();

  for (const [key, rawValue] of Object.entries(record)) {
    let nextValue = normalizeSecretReference(rawValue);

    const opMatches = Array.from(nextValue.matchAll(OP_REF_GLOBAL_PATTERN)).map((m) => m[0]);
    for (const opRef of opMatches) {
      let secretVal = opCache.get(opRef);
      if (secretVal === undefined) {
        secretVal = await opReader(opRef);
        opCache.set(opRef, secretVal);
      }
      nextValue = nextValue.replace(opRef, secretVal);
    }

    const envMatches = Array.from(nextValue.matchAll(ENV_REF_GLOBAL_PATTERN));
    for (const envMatch of envMatches) {
      const varName = envMatch[1];
      if (!varName) continue;
      const envVal = env[varName];
      if (envVal === undefined) {
        throw new Error(`Missing environment variable: ${varName}`);
      }
      nextValue = nextValue.replace(envMatch[0], envVal);
    }

    resolved[key] = nextValue;
  }

  return resolved;
}

interface HermesOAuthTokenFile {
  access_token?: string;
  token_type?: string;
  expires_at?: number;
  expires_in?: number;
  refresh_token?: string;
}

interface HermesOAuthMetaFile {
  token_endpoint?: string;
}

interface HermesOAuthClientFile {
  client_id?: string;
  client_secret?: string;
}

export interface HermesOAuthTokenStatus {
  present: boolean;
  valid: boolean;
  expiresAt?: string;
  hasRefreshToken: boolean;
}

function getHermesTokenPaths(mcpId: string, homeDir?: string) {
  const safeId = mcpId.replace(/[^a-zA-Z0-9._-]/g, '');
  const baseDir = path.join(homeDir ?? os.homedir(), '.hermes', 'mcp-tokens');
  return {
    tokenPath: path.join(baseDir, `${safeId}.json`),
    metaPath: path.join(baseDir, `${safeId}.meta.json`),
    clientPath: path.join(baseDir, `${safeId}.client.json`),
  };
}

/**
 * Inspect Hermes default-profile OAuth token metadata without reading or returning raw secret values.
 */
export async function getHermesOAuthStatus(
  mcpId: string,
  homeDir?: string
): Promise<HermesOAuthTokenStatus> {
  const { tokenPath } = getHermesTokenPaths(mcpId, homeDir);
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    const parsed = JSON.parse(raw) as HermesOAuthTokenFile;
    const nowSec = Date.now() / 1000;
    const hasAccess = typeof parsed.access_token === 'string' && parsed.access_token.length > 0;
    const expiresAtMs = typeof parsed.expires_at === 'number' ? parsed.expires_at * 1000 : undefined;
    const notExpired =
      typeof parsed.expires_at !== 'number' || parsed.expires_at > nowSec + 60;
    return {
      present: true,
      valid: hasAccess && notExpired,
      expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : undefined,
      hasRefreshToken:
        typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0,
    };
  } catch {
    return { present: false, valid: false, hasRefreshToken: false };
  }
}

/**
 * Resolve an Authorization header from Hermes default profile's OAuth cache
 * (`~/.hermes/mcp-tokens/<mcpId>.json`) at runtime ONLY.
 * Automatically refreshes using `refresh_token` if nearing expiry.
 */
export async function resolveHermesOAuthHeader(
  mcpId: string,
  options?: {
    homeDir?: string;
    fetchImpl?: typeof fetch;
  }
): Promise<Record<string, string> | undefined> {
  const { tokenPath, metaPath, clientPath } = getHermesTokenPaths(mcpId, options?.homeDir);
  let tokenData: HermesOAuthTokenFile;
  try {
    tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf8')) as HermesOAuthTokenFile;
  } catch {
    return undefined;
  }

  const nowSec = Date.now() / 1000;
  const needsRefresh =
    typeof tokenData.expires_at === 'number' && tokenData.expires_at <= nowSec + 60;

  if (needsRefresh && tokenData.refresh_token) {
    try {
      const [metaRaw, clientRaw] = await Promise.all([
        fs.readFile(metaPath, 'utf8'),
        fs.readFile(clientPath, 'utf8'),
      ]);
      const meta = JSON.parse(metaRaw) as HermesOAuthMetaFile;
      const client = JSON.parse(clientRaw) as HermesOAuthClientFile;

      if (meta.token_endpoint && client.client_id) {
        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
          client_id: client.client_id,
        });
        if (client.client_secret) {
          params.set('client_secret', client.client_secret);
        }

        const doFetch = options?.fetchImpl ?? fetch;
        const resp = await doFetch(meta.token_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (resp.ok) {
          const refreshed = (await resp.json()) as HermesOAuthTokenFile;
          if (refreshed.access_token) {
            const updated: HermesOAuthTokenFile = {
              ...tokenData,
              ...refreshed,
              refresh_token: refreshed.refresh_token ?? tokenData.refresh_token,
              expires_at:
                typeof refreshed.expires_in === 'number'
                  ? Math.floor(Date.now() / 1000) + refreshed.expires_in
                  : tokenData.expires_at,
            };
            const tmpPath = `${tokenPath}.tmp-${process.pid}-${Date.now()}`;
            await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2) + '\n', {
              mode: 0o600,
            });
            await fs.rename(tmpPath, tokenPath);
            tokenData = updated;
          }
        }
      }
    } catch {
      // Fall back to existing access_token if refresh attempt fails
    }
  }

  if (!tokenData.access_token) return undefined;
  const scheme =
    tokenData.token_type && tokenData.token_type.toLowerCase() === 'bearer'
      ? 'Bearer'
      : tokenData.token_type || 'Bearer';
  return {
    Authorization: `${scheme} ${tokenData.access_token}`,
  };
}
