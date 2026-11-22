import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  HARNESS_IDS,
  HarnessIdSchema,
  applyLibraryOrganization,
  buildDesiredStateForHarness,
  createAdapters,
  discoverAndMergeRegistry,
  getHermesOAuthStatus,
  getServiceStatus,
  hasOpReferences,
  hasSecretBackedAuth,
  hashPasscode,
  installBackgroundService,
  listBackupSnapshots,
  listHostIpv4Addresses,
  listOrganizeArchives,
  loadRegistry,
  loadSettings,
  maskRecordForUi,
  planLibraryOrganization,
  probeHttpMcpServer,
  resolveBindHost,
  resolveHostPaths,
  restartBackgroundService,
  restoreBackupSnapshot,
  sanitizeRecordForStorage,
  sanitizeSettingsForApi,
  saveRegistry,
  saveSettings,
  undoLibraryOrganization,
  uninstallBackgroundService,
  verifyPasscode,
  type BackupSnapshot,
  type HarnessDetectionResult,
  type HarnessId,
  type HermesOAuthTokenStatus,
  type HostPaths,
  type McpProbeResult,
  type McpServerItem,
  type RegistryFile,
  type SyncPlan,
  type VerificationResult,
} from '@harness-hub/core';
import { readSkillContent } from '@harness-hub/skills-mcp';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { McpGatewayManager } from './gateway.js';

export interface CreateAppOptions {
  homeDir?: string;
  hubDir?: string;
  host?: string;
  port?: number;
  webDistDir?: string;
  autoScanOnStart?: boolean;
  skipServiceControl?: boolean;
}

const SkillAllocationPatchSchema = z.object({
  skillId: z.string().min(1),
  harnessId: HarnessIdSchema.optional(),
  assigned: z.boolean().optional(),
  harnesses: z.record(z.string(), z.boolean()).optional(),
});

const McpAllocationPatchSchema = z.object({
  mcpId: z.string().min(1),
  harnessId: HarnessIdSchema,
  enabled: z.boolean().optional(),
  mode: z.enum(['direct', 'gateway']).optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

const SettingsPatchSchema = z.object({
  bindMode: z.enum(['local', 'lan']).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  passcode: z.string().min(4).max(128).optional(),
  clearPasscode: z.boolean().optional(),
  exposeSkillsMcp: z.boolean().optional(),
  verifyAfterApply: z.boolean().optional(),
});

const McpServerInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, 'MCP id must be alphanumeric with . _ -'),
  name: z.string().optional(),
  transport: z.enum(['stdio', 'http', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  env: z.record(z.string()).optional(),
  timeoutSec: z.number().positive().optional(),
  authType: z.enum(['none', 'oauth', 'bearer', 'header']).default('none'),
  defaultEnabledTools: z.array(z.string()).optional(),
  defaultDisabledTools: z.array(z.string()).optional(),
});

function sanitizeRegistryForApi(registry: RegistryFile): RegistryFile {
  return {
    ...registry,
    mcps: registry.mcps.map((m) => ({
      ...m,
      headers: maskRecordForUi(m.headers),
      env: maskRecordForUi(m.env),
    })),
  };
}

function sanitizePlansForApi(plans: Record<HarnessId, SyncPlan>): Record<HarnessId, SyncPlan> {
  const out = {} as Record<HarnessId, SyncPlan>;
  for (const h of HARNESS_IDS) {
    const p = plans[h];
    out[h] = {
      harnessId: p.harnessId,
      displayName: p.displayName,
      actions: p.actions,
      configPreviewBefore: p.configPreviewBefore,
      configPreviewAfter: p.configPreviewAfter,
      warnings: p.warnings,
      hasChanges: p.hasChanges,
    };
  }
  return out;
}

export async function createHarnessHubApp(options: CreateAppOptions = {}): Promise<{
  app: FastifyInstance;
  paths: HostPaths;
  gateway: McpGatewayManager;
}> {
  const paths = resolveHostPaths({
    homeDir: options.homeDir,
    hubDir: options.hubDir,
  });
  const adapters = createAdapters(paths);
  const gateway = new McpGatewayManager(paths.homeDir);

  let settings = await loadSettings(paths.hubDir);
  let registry = await loadRegistry(paths.registryPath, paths);
  const effectivePort = options.port ?? settings.port;
  const effectiveHost = options.host ?? resolveBindHost(settings.bindMode);
  registry.gatewayPort = effectivePort;
  const validSessionTokens = new Set<string>();
  const cliScriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'cli.js'
  );

  if (options.autoScanOnStart !== false && (!registry.lastScanAt || registry.skills.length === 0)) {
    registry = await discoverAndMergeRegistry(paths, registry);
    await saveRegistry(paths.registryPath, registry);
  }

  let lastVerifications: VerificationResult[] = [];
  let lastMcpProbes: McpProbeResult[] = [];

  async function computeAllPlans(): Promise<Record<HarnessId, SyncPlan>> {
    const entries = await Promise.all(
      HARNESS_IDS.map(async (h) => {
        const desired = buildDesiredStateForHarness(registry, h);
        const plan = await adapters[h].planSync(desired);
        return [h, plan] as const;
      })
    );
    return Object.fromEntries(entries) as Record<HarnessId, SyncPlan>;
  }

  async function computeDetections(): Promise<Record<HarnessId, HarnessDetectionResult>> {
    const entries = await Promise.all(
      HARNESS_IDS.map(async (h) => [h, await adapters[h].detect()] as const)
    );
    return Object.fromEntries(entries) as Record<HarnessId, HarnessDetectionResult>;
  }

  async function buildStatePayload() {
    const [detections, rawPlans, backups, organizePlan, organizeArchives, oauthEntries] =
      await Promise.all([
        computeDetections(),
        computeAllPlans(),
        listBackupSnapshots(paths.backupsDir),
        planLibraryOrganization(paths, registry),
        listOrganizeArchives(paths),
        Promise.all(
          registry.mcps.map(
            async (m) => [m.id, await getHermesOAuthStatus(m.id, paths.homeDir)] as const
          )
        ),
      ]);
    const oauthStatuses: Record<string, HermesOAuthTokenStatus> = Object.fromEntries(
      oauthEntries.filter(([, s]) => s.present)
    );
    const plans = sanitizePlansForApi(rawPlans);
    const pendingChangesCount = HARNESS_IDS.reduce(
      (sum, h) => sum + plans[h].actions.filter((a) => a.kind !== 'symlink_skip_unmanaged').length,
      0
    );

    return {
      registry: sanitizeRegistryForApi(registry),
      detections,
      plans,
      pendingChangesCount,
      backups: backups.slice(0, 20),
      organizePlan,
      organizeArchives: organizeArchives.slice(0, 10),
      oauthStatuses,
      verifications: lastVerifications,
      mcpProbes: lastMcpProbes,
    };
  }

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.addHook('onClose', async () => {
    await gateway.closeAll();
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!settings.accessPasscodeHash) return;
    if (!request.url.startsWith('/api/')) return;
    if (
      request.url === '/api/health' ||
      request.url === '/api/auth/status' ||
      request.url === '/api/auth/login'
    ) {
      return;
    }

    const tokenHeader = request.headers['x-harness-token'];
    const authHeader = request.headers.authorization;
    const token =
      typeof tokenHeader === 'string'
        ? tokenHeader
        : typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : '';

    if (!token || !validSessionTokens.has(token)) {
      reply.code(401).send({ error: 'Authentication required', requiresAuth: true });
    }
  });

  async function buildSettingsPayload() {
    const serviceStatus = await getServiceStatus({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
      skipDaemonControl: options.skipServiceControl,
    });
    const { lanIps, tailscaleIps } = listHostIpv4Addresses();
    const sanitized = sanitizeSettingsForApi(settings);
    const port = effectivePort || sanitized.port;
    const restartRequired =
      sanitized.bindHost !== effectiveHost || sanitized.port !== effectivePort;

    return {
      settings: sanitized,
      runtime: {
        listeningHost: effectiveHost,
        listeningPort: effectivePort,
        restartRequired,
        localUrl: `http://127.0.0.1:${port}/`,
        lanUrls: lanIps.map((ip) => `http://${ip}:${port}/`),
        tailscaleUrls: tailscaleIps.map((ip) => `http://${ip}:${port}/`),
        serviceStatus,
      },
    };
  }

  app.get('/api/health', async () => ({
    ok: true,
    version: '0.1.0',
    skillsCount: registry.skills.length,
    mcpsCount: registry.mcps.length,
  }));

  app.get('/api/auth/status', async (request) => {
    const requiresAuth = Boolean(settings.accessPasscodeHash);
    if (!requiresAuth) {
      return { requiresAuth: false, authenticated: true };
    }
    const tokenHeader = request.headers['x-harness-token'];
    const token = typeof tokenHeader === 'string' ? tokenHeader : '';
    return {
      requiresAuth: true,
      authenticated: Boolean(token && validSessionTokens.has(token)),
    };
  });

  app.post<{ Body: { passcode?: string } }>('/api/auth/login', async (request, reply) => {
    if (!settings.accessPasscodeHash) {
      return { ok: true, token: '' };
    }
    const passcode = request.body?.passcode ?? '';
    if (!verifyPasscode(passcode, settings.accessPasscodeHash)) {
      reply.code(401);
      return { error: 'Invalid passcode' };
    }
    const token = crypto.randomBytes(24).toString('hex');
    validSessionTokens.add(token);
    return { ok: true, token };
  });

  app.get('/api/settings', async () => buildSettingsPayload());

  app.patch('/api/settings', async (request, reply) => {
    const parsed = SettingsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const patch = parsed.data;
    const next = { ...settings };
    if (patch.bindMode !== undefined) next.bindMode = patch.bindMode;
    if (patch.port !== undefined) next.port = patch.port;
    if (patch.exposeSkillsMcp !== undefined) {
      next.exposeSkillsMcp = patch.exposeSkillsMcp;
      for (const h of HARNESS_IDS) {
        const currentHarness = registry.harnesses[h];
        if (currentHarness) {
          currentHarness.exposeSkillsMcp = patch.exposeSkillsMcp;
        }
      }
      await saveRegistry(paths.registryPath, registry);
    }
    if (patch.verifyAfterApply !== undefined) next.verifyAfterApply = patch.verifyAfterApply;
    if (patch.clearPasscode) {
      delete next.accessPasscodeHash;
      validSessionTokens.clear();
    } else if (patch.passcode) {
      next.accessPasscodeHash = hashPasscode(patch.passcode);
      validSessionTokens.clear();
    }

    settings = await saveSettings(paths.hubDir, next);
    const serviceStatus = await getServiceStatus({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
      skipDaemonControl: options.skipServiceControl,
    });
    if (serviceStatus.installed) {
      await installBackgroundService({
        homeDir: paths.homeDir,
        hubDir: paths.hubDir,
        cliScript: cliScriptPath,
        host: resolveBindHost(settings.bindMode),
        port: settings.port,
        skipDaemonControl: options.skipServiceControl,
      });
    }
    return buildSettingsPayload();
  });

  app.post('/api/service/install', async () => {
    await installBackgroundService({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
      cliScript: cliScriptPath,
      host: resolveBindHost(settings.bindMode),
      port: settings.port,
      skipDaemonControl: options.skipServiceControl,
    });
    return buildSettingsPayload();
  });

  app.post('/api/service/uninstall', async () => {
    await uninstallBackgroundService({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
      skipDaemonControl: options.skipServiceControl,
    });
    return buildSettingsPayload();
  });

  app.post('/api/service/restart', async () => {
    if (!options.skipServiceControl) {
      await restartBackgroundService({
        homeDir: paths.homeDir,
        hubDir: paths.hubDir,
      });
    }
    return buildSettingsPayload();
  });

  app.get('/api/state', async () => buildStatePayload());

  app.post('/api/scan', async () => {
    registry = await discoverAndMergeRegistry(paths, registry);
    await saveRegistry(paths.registryPath, registry);
    return buildStatePayload();
  });

  app.get<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    try {
      const content = await readSkillContent(registry.skills, request.params.id);
      return {
        skill: content.skill,
        markdown: content.markdown,
        attachmentPaths: content.attachmentPaths,
      };
    } catch (err) {
      reply.code(404);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.patch('/api/allocations/skill', async (request, reply) => {
    const parsed = SkillAllocationPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const { skillId, harnessId, assigned, harnesses } = parsed.data;
    const skillExists = registry.skills.some((s) => s.id === skillId);
    if (!skillExists) {
      reply.code(404);
      return { error: `Skill '${skillId}' not found` };
    }

    const row = { ...(registry.allocations.skills[skillId] ?? {}) };
    if (harnessId !== undefined && assigned !== undefined) {
      row[harnessId] = assigned;
    }
    if (harnesses) {
      for (const h of HARNESS_IDS) {
        if (typeof harnesses[h] === 'boolean') {
          row[h] = harnesses[h];
        }
      }
    }
    registry.allocations.skills[skillId] = row;
    await saveRegistry(paths.registryPath, registry);
    return buildStatePayload();
  });

  app.patch('/api/allocations/mcp', async (request, reply) => {
    const parsed = McpAllocationPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const { mcpId, harnessId, enabled, mode, enabledTools, disabledTools } = parsed.data;
    const mcpItem = registry.mcps.find((m) => m.id === mcpId);
    if (!mcpItem) {
      reply.code(404);
      return { error: `MCP server '${mcpId}' not found` };
    }

    const row = { ...(registry.allocations.mcps[mcpId] ?? {}) };
    const prev = row[harnessId] ?? { enabled: false, mode: 'direct' as const };
    // Auto-route secret-backed MCPs (OAuth, op://, Antigravity headers, or cross-harness bearer/header MCPs) via Hub Gateway
    let nextMode = mode ?? prev.mode;
    if (mode === undefined && !prev.enabled && enabled === true) {
      const usesOpRef = hasOpReferences(mcpItem.headers) || hasOpReferences(mcpItem.env);
      const needsGatewayForHarness =
        usesOpRef ||
        (harnessId === 'antigravity' && hasSecretBackedAuth(mcpItem)) ||
        ((mcpItem.authType === 'bearer' || mcpItem.authType === 'header') &&
          !mcpItem.discoveredIn.includes(harnessId));

      if (needsGatewayForHarness) {
        nextMode = 'gateway';
      } else if (harnessId !== 'hermes') {
        const hermesOAuth = await getHermesOAuthStatus(mcpId, paths.homeDir);
        if (mcpItem.authType === 'oauth' || hermesOAuth.present) {
          nextMode = 'gateway';
        }
      }
    }
    row[harnessId] = {
      enabled: enabled ?? prev.enabled,
      mode: nextMode,
      enabledTools: enabledTools !== undefined ? enabledTools : prev.enabledTools,
      disabledTools: disabledTools !== undefined ? disabledTools : prev.disabledTools,
    };
    registry.allocations.mcps[mcpId] = row;
    await saveRegistry(paths.registryPath, registry);
    return buildStatePayload();
  });

  app.post('/api/mcps', async (request, reply) => {
    const parsed = McpServerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const input = parsed.data;
    if (registry.mcps.some((m) => m.id === input.id)) {
      reply.code(409);
      return { error: `MCP server '${input.id}' already exists` };
    }

    const item: McpServerItem = {
      id: input.id,
      name: input.name ?? input.id,
      transport: input.transport,
      command: input.command,
      args: input.args,
      url: input.url,
      headers: sanitizeRecordForStorage(input.headers),
      env: sanitizeRecordForStorage(input.env),
      timeoutSec: input.timeoutSec,
      authType: input.authType,
      discoveredIn: [],
      defaultEnabledTools: input.defaultEnabledTools,
      defaultDisabledTools: input.defaultDisabledTools,
    };

    registry.mcps.push(item);
    registry.mcps.sort((a, b) => a.id.localeCompare(b.id));
    registry.allocations.mcps[item.id] = Object.fromEntries(
      HARNESS_IDS.map((h) => [h, { enabled: false, mode: 'gateway' as const }])
    );

    await saveRegistry(paths.registryPath, registry);
    return buildStatePayload();
  });

  app.patch<{ Params: { id: string } }>('/api/mcps/:id', async (request, reply) => {
    const idx = registry.mcps.findIndex((m) => m.id === request.params.id);
    if (idx === -1) {
      reply.code(404);
      return { error: `MCP server '${request.params.id}' not found` };
    }
    const parsed = McpServerInputSchema.partial().safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: parsed.error.message };
    }
    const current = registry.mcps[idx]!;
    const patch = parsed.data;
    const nextHeaders = patch.headers ? sanitizeRecordForStorage(patch.headers) : current.headers;
    const nextEnv = patch.env ? sanitizeRecordForStorage(patch.env) : current.env;
    registry.mcps[idx] = {
      ...current,
      ...patch,
      id: current.id,
      headers: nextHeaders && Object.keys(nextHeaders).length > 0 ? nextHeaders : undefined,
      env: nextEnv && Object.keys(nextEnv).length > 0 ? nextEnv : undefined,
    };
    await saveRegistry(paths.registryPath, registry);
    return buildStatePayload();
  });

  app.delete<{ Params: { id: string } }>('/api/mcps/:id', async (request, reply) => {
    const id = request.params.id;
    const beforeLen = registry.mcps.length;
    registry.mcps = registry.mcps.filter((m) => m.id !== id);
    if (registry.mcps.length === beforeLen) {
      reply.code(404);
      return { error: `MCP server '${id}' not found` };
    }
    delete registry.allocations.mcps[id];
    await saveRegistry(paths.registryPath, registry);
    return buildStatePayload();
  });

  app.post<{ Params: { id: string }; Body: { resolvedPath: string } }>(
    '/api/conflicts/:id/resolve',
    async (request, reply) => {
      const id = request.params.id;
      const resolvedPath = request.body?.resolvedPath;
      const conflict = registry.conflicts.find((c) => c.id === id);
      if (!conflict || typeof resolvedPath !== 'string') {
        reply.code(400);
        return { error: 'Invalid conflict id or resolvedPath' };
      }
      const variant = conflict.variants.find((v) => v.realPath === resolvedPath);
      if (!variant) {
        reply.code(404);
        return { error: 'Selected variant path not found in conflict' };
      }
      conflict.resolvedPath = resolvedPath;
      registry = await discoverAndMergeRegistry(paths, registry);
      await saveRegistry(paths.registryPath, registry);
      return buildStatePayload();
    }
  );

  app.get('/api/plan', async () => {
    const plans = sanitizePlansForApi(await computeAllPlans());
    return { plans };
  });

  app.post('/api/apply', async () => {
    const rawPlans = await computeAllPlans();
    const results = [];
    for (const h of HARNESS_IDS) {
      const plan = rawPlans[h];
      if (plan.hasChanges) {
        results.push(await adapters[h].applySync(plan, paths.backupsDir));
      }
    }
    registry.lastApplyAt = new Date().toISOString();
    await saveRegistry(paths.registryPath, registry);
    const state = await buildStatePayload();
    return { results, ...state };
  });

  app.get('/api/backups', async () => {
    const backups: BackupSnapshot[] = await listBackupSnapshots(paths.backupsDir);
    return { backups };
  });

  app.post<{ Params: { id: string } }>('/api/rollback/:id', async (request, reply) => {
    try {
      const restored = await restoreBackupSnapshot(paths.backupsDir, request.params.id);
      registry = await discoverAndMergeRegistry(paths, registry);
      await saveRegistry(paths.registryPath, registry);
      const state = await buildStatePayload();
      return { restored, ...state };
    } catch (err) {
      reply.code(404);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/verify', async () => {
    const [verifications, mcpProbes] = await Promise.all([
      Promise.all(HARNESS_IDS.map((h) => adapters[h].verifyLive())),
      Promise.all(
        registry.mcps
          .filter((m) => Boolean(m.url))
          .map((m) => probeHttpMcpServer(m, { homeDir: paths.homeDir }))
      ),
    ]);
    lastVerifications = verifications;
    lastMcpProbes = mcpProbes;
    return {
      verifications,
      mcpProbes,
    };
  });

  app.get('/api/organize/plan', async () => {
    const [plan, archives] = await Promise.all([
      planLibraryOrganization(paths, registry),
      listOrganizeArchives(paths),
    ]);
    return { plan, archives };
  });

  app.post('/api/organize/apply', async () => {
    const plan = await planLibraryOrganization(paths, registry);
    const result = await applyLibraryOrganization(paths, plan);
    registry = await discoverAndMergeRegistry(paths, registry);
    await saveRegistry(paths.registryPath, registry);
    const state = await buildStatePayload();
    return { result, ...state };
  });

  app.post<{ Params: { id: string } }>('/api/organize/undo/:id', async (request, reply) => {
    try {
      const restored = await undoLibraryOrganization(paths, request.params.id);
      registry = await discoverAndMergeRegistry(paths, registry);
      await saveRegistry(paths.registryPath, registry);
      const state = await buildStatePayload();
      return { restored, ...state };
    } catch (err) {
      reply.code(404);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Built-in Streamable HTTP MCP Gateway per harness: /mcp/:harness
  app.all<{ Params: { harness: string } }>('/mcp/:harness', async (request, reply) => {
    const parsedHarness = HarnessIdSchema.safeParse(request.params.harness);
    if (!parsedHarness.success) {
      reply.code(404);
      return { error: `Unknown harness '${request.params.harness}'` };
    }

    reply.hijack();
    await gateway.handleHttpRequest(
      () => registry,
      parsedHarness.data,
      request.raw,
      reply.raw,
      request.body
    );
  });

  // Serve built Web UI if present
  const defaultWebDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../web/dist'
  );
  const webDist = options.webDistDir ?? defaultWebDist;
  if (fsSync.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mcp/')) {
        reply.code(404);
        return { error: 'Not found' };
      }
      const indexHtml = await fs.readFile(path.join(webDist, 'index.html'), 'utf8');
      reply.type('text/html').send(indexHtml);
    });
  }

  return { app, paths, gateway };
}
