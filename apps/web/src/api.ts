import type {
  HarnessId,
  HubStatePayload,
  McpProbeResult,
  SettingsPayload,
  SkillItem,
  VerificationResult,
} from './types';

const TOKEN_STORAGE_KEY = 'harness_hub_session_token';

export function getStoredSessionToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredSessionToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthRequiredError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredSessionToken();
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Harness-Token': token } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const data = await res.json();
  if (res.status === 401 && data?.requiresAuth) {
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getState: () => request<HubStatePayload>('/api/state'),
  rescan: () => request<HubStatePayload>('/api/scan', { method: 'POST', body: '{}' }),
  getSkillDetail: (id: string) =>
    request<{ skill: SkillItem; markdown: string; attachmentPaths: string[] }>(
      `/api/skills/${encodeURIComponent(id)}`
    ),
  toggleSkill: (skillId: string, harnessId: HarnessId, assigned: boolean) =>
    request<HubStatePayload>('/api/allocations/skill', {
      method: 'PATCH',
      body: JSON.stringify({ skillId, harnessId, assigned }),
    }),
  updateMcpAllocation: (payload: {
    mcpId: string;
    harnessId: HarnessId;
    enabled?: boolean;
    mode?: 'direct' | 'gateway';
    enabledTools?: string[];
    disabledTools?: string[];
  }) =>
    request<HubStatePayload>('/api/allocations/mcp', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  createMcp: (payload: {
    id: string;
    transport: 'stdio' | 'http' | 'sse';
    url?: string;
    command?: string;
    args?: string[];
    headers?: Record<string, string>;
    env?: Record<string, string>;
    authType?: 'none' | 'oauth' | 'bearer' | 'header';
  }) =>
    request<HubStatePayload>('/api/mcps', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMcp: (
    id: string,
    patch: {
      url?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
      authType?: 'none' | 'oauth' | 'bearer' | 'header';
    }
  ) =>
    request<HubStatePayload>(`/api/mcps/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteMcp: (id: string) =>
    request<HubStatePayload>(`/api/mcps/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  resolveConflict: (id: string, resolvedPath: string) =>
    request<HubStatePayload>(`/api/conflicts/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolvedPath }),
    }),
  apply: () => request<HubStatePayload>('/api/apply', { method: 'POST', body: '{}' }),
  rollback: (snapshotId: string) =>
    request<HubStatePayload>(`/api/rollback/${encodeURIComponent(snapshotId)}`, {
      method: 'POST',
      body: '{}',
    }),
  verify: () =>
    request<{ verifications: VerificationResult[]; mcpProbes: McpProbeResult[] }>('/api/verify', {
      method: 'POST',
      body: '{}',
    }),
  organizeApply: () =>
    request<HubStatePayload & { result: { archiveId?: string; appliedCount: number; errors: string[] } }>(
      '/api/organize/apply',
      { method: 'POST', body: '{}' }
    ),
  organizeUndo: (archiveId: string) =>
    request<HubStatePayload>(`/api/organize/undo/${encodeURIComponent(archiveId)}`, {
      method: 'POST',
      body: '{}',
    }),
  getAuthStatus: () =>
    request<{ requiresAuth: boolean; authenticated: boolean }>('/api/auth/status'),
  login: async (passcode: string) => {
    const res = await request<{ ok: boolean; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    });
    if (res.token) setStoredSessionToken(res.token);
    return res;
  },
  getSettings: () => request<SettingsPayload>('/api/settings'),
  updateSettings: (payload: {
    bindMode?: 'local' | 'lan';
    port?: number;
    passcode?: string;
    clearPasscode?: boolean;
    exposeSkillsMcp?: boolean;
    verifyAfterApply?: boolean;
  }) =>
    request<SettingsPayload>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  installService: () =>
    request<SettingsPayload>('/api/service/install', { method: 'POST', body: '{}' }),
  restartService: () =>
    request<SettingsPayload>('/api/service/restart', { method: 'POST', body: '{}' }),
  uninstallService: () =>
    request<SettingsPayload>('/api/service/uninstall', { method: 'POST', body: '{}' }),
};
