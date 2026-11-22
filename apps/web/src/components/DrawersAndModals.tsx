import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Code2,
  FileText,
  History,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import {
  HARNESS_META,
  type BackupSnapshot,
  type HarnessId,
  type HermesOAuthTokenStatus,
  type HubStatePayload,
  type McpServerItem,
  type OrganizeArchiveRecord,
  type OrganizePlan,
  type SkillConflict,
  type SkillItem,
} from '../types';
import { MarkdownPreview } from './MarkdownPreview';

export const SkillInspectorDrawer: React.FC<{
  skill: SkillItem;
  markdown: string;
  loading: boolean;
  assigned: Record<HarnessId, boolean>;
  verifiedInCodex?: boolean;
  dark: boolean;
  onToggleHarness: (h: HarnessId) => void;
  onClose: () => void;
}> = ({ skill, markdown, loading, assigned, verifiedInCodex, dark, onToggleHarness, onClose }) => {
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div
        className={`flex h-full w-full max-w-2xl flex-col border-l shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div>
            <h2 className="text-base font-semibold">{skill.name}</h2>
            <p className={`text-xs ${mutedText}`}>
              Category: {skill.category} · Origin: {skill.originSource} · {skill.locations.length} location(s)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1.5 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {skill.portability && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                skill.portability.status === 'portable'
                  ? dark
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : skill.portability.status === 'caution'
                    ? dark
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                    : dark
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {skill.portability.status === 'portable' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                  Cross-Agent Compatibility:{' '}
                  {skill.portability.status === 'portable'
                    ? 'Portable (Ready for other agents)'
                    : skill.portability.status === 'caution'
                      ? 'Needs Review (Harness-specific references)'
                      : 'Incomplete Frontmatter'}
                </span>
                {verifiedInCodex && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      dark ? 'bg-indigo-500/20 text-indigo-200' : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    Confirmed by Codex skills/list
                  </span>
                )}
              </div>
              {skill.portability.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[11px]">
                  {skill.portability.warnings.map((w, i) => (
                    <li key={i}>• {w.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <div className={`mb-2 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              Assigned Harnesses
            </div>
            <div className="flex flex-wrap gap-2">
              {HARNESS_META.map((h) => {
                const on = assigned[h.id];
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => onToggleHarness(h.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                      on
                        ? dark
                          ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                          : 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : dark
                          ? 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300'
                    }`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {h.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className={`mb-2 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              Native Home & Locations ({skill.locations.length})
            </div>
            <div className="space-y-1.5">
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  dark ? 'border-zinc-800 bg-zinc-900/70' : 'border-zinc-200 bg-zinc-50'
                }`}
              >
                <span className="font-semibold">
                  Native Owner:{' '}
                  {skill.originSource === 'agents'
                    ? 'Shared Pool (~/.agents/skills)'
                    : skill.originSource}
                </span>
                <div className={`mt-0.5 break-all font-mono text-[11px] ${mutedText}`}>
                  {skill.canonicalPath}
                </div>
              </div>
              {skill.locations.map((loc) => (
                <div
                  key={`${loc.source}:${loc.path}`}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-[11px] ${
                    dark ? 'border-zinc-800/70 bg-zinc-950' : 'border-zinc-200 bg-white'
                  }`}
                >
                  <span className="truncate font-mono">{loc.path}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      loc.isSymlink
                        ? dark
                          ? 'bg-indigo-500/15 text-indigo-300'
                          : 'bg-indigo-50 text-indigo-700'
                        : dark
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {loc.isSymlink ? `${loc.source} (linked)` : `${loc.source} (native)`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {skill.attachments.length > 0 && (
            <div>
              <div className={`mb-2 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
                Attached Scripts & References ({skill.attachments.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skill.attachments.map((att) => (
                  <span
                    key={att}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono ${
                      dark ? 'bg-zinc-900 text-zinc-300' : 'bg-zinc-100 text-zinc-800'
                    }`}
                  >
                    <FileText
                      className={`h-3 w-3 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`}
                    />
                    {att}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className={`mb-2 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              SKILL.md Instructions
            </div>
            {loading ? (
              <div className={`py-8 text-center text-sm ${mutedText}`}>Loading SKILL.md...</div>
            ) : (
              <div
                className={`rounded-xl border p-4 ${
                  dark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'
                }`}
              >
                <MarkdownPreview content={markdown} dark={dark} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const McpInspectorDrawer: React.FC<{
  mcp: McpServerItem;
  allocations: Record<
    string,
    { enabled: boolean; mode: 'direct' | 'gateway'; disabledTools?: string[]; enabledTools?: string[] }
  >;
  oauthStatus?: HermesOAuthTokenStatus;
  dark: boolean;
  onUpdateAllocation: (
    harnessId: HarnessId,
    patch: { enabled?: boolean; mode?: 'direct' | 'gateway'; disabledTools?: string[] }
  ) => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ mcp, allocations, oauthStatus, dark, onUpdateAllocation, onDelete, onClose }) => {
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div
        className={`flex h-full w-full max-w-xl flex-col border-l shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div>
            <h2 className="text-base font-semibold">{mcp.name}</h2>
            <p className={`text-xs ${mutedText}`}>
              Transport: {mcp.transport.toUpperCase()} · Auth: {mcp.authType}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1.5 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div
            className={`rounded-xl border p-3.5 text-xs ${
              dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
            }`}
          >
            <div className={`font-medium ${mutedText}`}>Endpoint / Command</div>
            <div className="mt-1 break-all font-mono">
              {mcp.url || [mcp.command, ...(mcp.args ?? [])].join(' ')}
            </div>
            {(mcp.headers || mcp.env) && (
              <div className="mt-3 space-y-1">
                <div className={`inline-flex items-center gap-1 font-medium ${mutedText}`}>
                  <Lock className="h-3 w-3" /> Secret References (Masked)
                </div>
                {Object.entries({ ...(mcp.headers ?? {}), ...(mcp.env ?? {}) }).map(([k, v]) => (
                  <div key={k} className={`font-mono text-[11px] ${mutedText}`}>
                    {k}:{' '}
                    <span className={dark ? 'text-amber-400' : 'text-amber-700'}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {oauthStatus?.present && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                oauthStatus.valid
                  ? dark
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : dark
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <div className="font-semibold">
                Shared OAuth Session: Hermes Default Profile ({oauthStatus.valid ? 'Active' : 'Needs Refresh'})
              </div>
              <div className="mt-1 text-[11px]">
                {oauthStatus.expiresAt
                  ? `Valid until ${new Date(oauthStatus.expiresAt).toLocaleString()}`
                  : 'Active token cached'}
                {oauthStatus.hasRefreshToken ? ' · Auto-refresh enabled' : ''}
                . Harnesses using <strong>Hub Gateway</strong> share this single login automatically.
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className={`text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              Per-Harness Allocation & Routing
            </div>
            {HARNESS_META.map((h) => {
              const alloc = allocations[h.id] ?? { enabled: false, mode: 'direct' as const };
              return (
                <div
                  key={h.id}
                  className={`rounded-xl border p-3.5 ${
                    dark ? 'border-zinc-800 bg-zinc-900/40' : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{h.name}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={alloc.mode}
                        onChange={(e) =>
                          onUpdateAllocation(h.id, { mode: e.target.value as 'direct' | 'gateway' })
                        }
                        className={`rounded-md border px-2 py-1 text-xs ${
                          dark
                            ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                            : 'border-zinc-300 bg-white text-zinc-800'
                        }`}
                      >
                        <option value="direct">Direct Config</option>
                        <option value="gateway">Hub Gateway</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => onUpdateAllocation(h.id, { enabled: !alloc.enabled })}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                          alloc.enabled
                            ? dark
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-emerald-100 text-emerald-800'
                            : dark
                              ? 'bg-zinc-800 text-zinc-400'
                              : 'bg-zinc-200 text-zinc-700'
                        }`}
                      >
                        {alloc.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <label className={`block text-[11px] ${mutedText}`}>
                      Disabled Tools (comma-separated)
                    </label>
                    <input
                      type="text"
                      defaultValue={(alloc.disabledTools ?? mcp.defaultDisabledTools ?? []).join(', ')}
                      onBlur={(e) => {
                        const vals = e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        onUpdateAllocation(h.id, { disabledTools: vals });
                      }}
                      placeholder="e.g. write_file, edit_file"
                      className={`mt-1 w-full rounded-md border px-2.5 py-1 text-xs ${
                        dark
                          ? 'border-zinc-800 bg-zinc-950 text-zinc-200'
                          : 'border-zinc-300 bg-white text-zinc-900'
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`flex items-center justify-between border-t px-5 py-3 ${borderClass}`}>
          <button
            type="button"
            onClick={onDelete}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
              dark ? 'text-rose-400 hover:bg-rose-500/10' : 'text-rose-700 hover:bg-rose-50'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove from Catalog
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export const HarnessDetailDrawer: React.FC<{
  harnessId: HarnessId;
  state: HubStatePayload;
  dark: boolean;
  onRemoveSkill: (skillId: string) => void;
  onRemoveMcp: (mcpId: string) => void;
  onClose: () => void;
}> = ({ harnessId, state, dark, onRemoveSkill, onRemoveMcp, onClose }) => {
  const [showDiff, setShowDiff] = useState(false);
  const meta = HARNESS_META.find((h) => h.id === harnessId)!;
  const plan = state.plans[harnessId];
  const verif = state.verifications.find((v) => v.harnessId === harnessId);
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';

  const assignedSkills = state.registry.skills.filter(
    (s) => state.registry.allocations.skills[s.id]?.[harnessId]
  );
  const assignedMcps = state.registry.mcps.filter(
    (m) => state.registry.allocations.mcps[m.id]?.[harnessId]?.enabled
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div
        className={`flex h-full w-full max-w-2xl flex-col border-l shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div>
            <h2 className="text-base font-semibold">{meta.name} Capabilities</h2>
            <p className={`text-xs ${mutedText}`}>{meta.tagline}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1.5 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {verif && (
            <div
              className={`rounded-xl border p-3.5 text-xs ${
                dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="font-semibold">Live Verification: {verif.status}</div>
              <div className={`mt-1 ${mutedText}`}>{verif.summary}</div>
              {verif.mcpProbes.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {verif.mcpProbes.map((p) => (
                    <div
                      key={p.id}
                      className={`rounded-md border px-2.5 py-1.5 ${
                        dark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'
                      }`}
                    >
                      <div className="font-medium">{p.id}</div>
                      <div className={`text-[11px] ${mutedText}`}>{p.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <div className={`mb-2 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              Assigned MCP Servers ({assignedMcps.length})
            </div>
            {assignedMcps.length === 0 ? (
              <p className={`text-xs ${mutedText}`}>No MCP servers assigned yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignedMcps.map((m) => (
                  <span
                    key={m.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                      dark
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    }`}
                  >
                    {m.name}
                    <button
                      type="button"
                      onClick={() => onRemoveMcp(m.id)}
                      className="rounded hover:bg-black/15"
                      title={`Disable ${m.name} on ${meta.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className={`mb-2 text-xs font-medium uppercase tracking-wider ${mutedText}`}>
              Assigned Skills ({assignedSkills.length})
            </div>
            {assignedSkills.length === 0 ? (
              <p className={`text-xs ${mutedText}`}>
                No skills pinned directly. (All {state.registry.skills.length} skills remain searchable via Hub Gateway!)
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignedSkills.map((s) => (
                  <span
                    key={s.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                      dark
                        ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                        : 'border-zinc-200 bg-zinc-100 text-zinc-800'
                    }`}
                  >
                    {s.name}
                    <button
                      type="button"
                      onClick={() => onRemoveSkill(s.id)}
                      className="rounded hover:bg-black/15"
                      title={`Unassign ${s.name} from ${meta.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {plan && plan.configPreviewAfter && (
            <div className={`border-t pt-4 ${borderClass}`}>
              <button
                type="button"
                onClick={() => setShowDiff((v) => !v)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                  dark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                {showDiff ? 'Hide Advanced Config Preview' : 'Advanced: Preview Config Changes'}
              </button>
              {showDiff && (
                <pre
                  className={`mt-2 max-h-72 overflow-auto rounded-xl border p-3 text-[11px] font-mono ${
                    dark
                      ? 'border-zinc-800 bg-zinc-900 text-zinc-300'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-800'
                  }`}
                >
                  {plan.configPreviewAfter}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ApplyConfirmModal: React.FC<{
  state: HubStatePayload;
  applying: boolean;
  dark: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ state, applying, dark, onConfirm, onClose }) => {
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <h2 className="text-base font-semibold">Review & Apply Changes</h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-96 space-y-3 overflow-y-auto p-5 text-xs">
          <p className={mutedText}>
            A timestamped backup snapshot will be saved automatically before updating any harness configuration.
          </p>
          {HARNESS_META.map((h) => {
            const plan = state.plans[h.id];
            if (!plan || plan.actions.length === 0) return null;
            return (
              <div
                key={h.id}
                className={`rounded-xl border p-3 ${
                  dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
                }`}
              >
                <div className="font-semibold">{h.name}</div>
                <ul className={`mt-1.5 space-y-1 ${mutedText}`}>
                  {plan.actions.map((a, idx) => (
                    <li key={idx}>• {a.summary}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <div className={`flex justify-end gap-2 border-t px-5 py-3 ${borderClass}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              dark ? 'border-zinc-700 text-zinc-300' : 'border-zinc-300 text-zinc-700'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={applying}
            onClick={onConfirm}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {applying ? 'Applying...' : `Apply ${state.pendingChangesCount} Change(s)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export const BackupHistoryDrawer: React.FC<{
  backups: BackupSnapshot[];
  dark: boolean;
  onRollback: (id: string) => void;
  onClose: () => void;
}> = ({ backups, dark, onRollback, onClose }) => {
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div
        className={`flex h-full w-full max-w-md flex-col border-l shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div className="flex items-center gap-2">
            <History className={`h-4 w-4 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
            <h2 className="text-base font-semibold">Backup Snapshots</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1.5 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {backups.length === 0 ? (
            <p className={`text-xs ${mutedText}`}>
              No backup snapshots yet. Snapshots are created automatically on Apply.
            </p>
          ) : (
            backups.map((b) => (
              <div
                key={b.id}
                className={`rounded-xl border p-3.5 text-xs ${
                  dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{b.reason}</span>
                  <button
                    type="button"
                    onClick={() => onRollback(b.id)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                      dark
                        ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                        : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    }`}
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                </div>
                <div className={`mt-1 text-[11px] ${mutedText}`}>
                  {new Date(b.createdAt).toLocaleString()} · {b.files.length} file(s)
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export const AddMcpModal: React.FC<{
  dark: boolean;
  onAdd: (payload: {
    id: string;
    transport: 'stdio' | 'http' | 'sse';
    url?: string;
    command?: string;
    args?: string[];
    headers?: Record<string, string>;
  }) => Promise<void>;
  onClose: () => void;
}> = ({ dark, onAdd, onClose }) => {
  const [id, setId] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio' | 'sse'>('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [authHeader, setAuthHeader] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const labelClass = dark ? 'text-zinc-300' : 'text-zinc-700';
  const inputClass = dark
    ? 'border-zinc-800 bg-zinc-900 text-zinc-100'
    : 'border-zinc-300 bg-white text-zinc-900';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onAdd({
        id: id.trim(),
        transport,
        url: transport !== 'stdio' ? url.trim() : undefined,
        command: transport === 'stdio' ? command.trim() : undefined,
        args:
          transport === 'stdio' && argsText.trim()
            ? argsText.trim().split(/\s+/)
            : undefined,
        headers: authHeader.trim() ? { Authorization: authHeader.trim() } : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-md rounded-2xl border shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div className="flex items-center gap-2">
            <Plus className={`h-4 w-4 ${dark ? 'text-emerald-400' : 'text-emerald-600'}`} />
            <h2 className="text-base font-semibold">Add MCP Server</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5 text-xs">
          {error && (
            <div
              className={`rounded-lg px-3 py-2 ${
                dark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {error}
            </div>
          )}
          <div>
            <label className={`block font-medium ${labelClass}`}>Server ID</label>
            <input
              required
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. github-mcp"
              className={`mt-1 w-full rounded-lg border px-3 py-2 ${inputClass}`}
            />
          </div>
          <div>
            <label className={`block font-medium ${labelClass}`}>Transport</label>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as 'http' | 'stdio' | 'sse')}
              className={`mt-1 w-full rounded-lg border px-3 py-2 ${inputClass}`}
            >
              <option value="http">Streamable HTTP</option>
              <option value="stdio">Local Command (stdio)</option>
              <option value="sse">SSE</option>
            </select>
          </div>
          {transport !== 'stdio' ? (
            <>
              <div>
                <label className={`block font-medium ${labelClass}`}>Server URL</label>
                <input
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8000/mcp"
                  className={`mt-1 w-full rounded-lg border px-3 py-2 ${inputClass}`}
                />
              </div>
              <div>
                <label className={`block font-medium ${labelClass}`}>
                  Authorization Secret Reference (optional)
                </label>
                <input
                  value={authHeader}
                  onChange={(e) => setAuthHeader(e.target.value)}
                  placeholder="op://Hermes/Item/token or ${MY_API_KEY}"
                  className={`mt-1 w-full rounded-lg border px-3 py-2 font-mono ${inputClass}`}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={`block font-medium ${labelClass}`}>Executable Command</label>
                <input
                  required
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="/Users/you/.local/bin/my-mcp"
                  className={`mt-1 w-full rounded-lg border px-3 py-2 font-mono ${inputClass}`}
                />
              </div>
              <div>
                <label className={`block font-medium ${labelClass}`}>Arguments</label>
                <input
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="mcp --stdio"
                  className={`mt-1 w-full rounded-lg border px-3 py-2 font-mono ${inputClass}`}
                />
              </div>
            </>
          )}
        </div>
        <div className={`flex justify-end gap-2 border-t px-5 py-3 ${borderClass}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              dark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Add Server'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const ConflictResolverModal: React.FC<{
  conflicts: SkillConflict[];
  dark: boolean;
  onResolve: (skillId: string, realPath: string) => void;
  onClose: () => void;
}> = ({ conflicts, dark, onResolve, onClose }) => {
  const [showResolved, setShowResolved] = useState(false);
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';

  const unresolved = conflicts.filter((c) => !c.resolvedPath);
  const resolved = conflicts.filter((c) => Boolean(c.resolvedPath));
  const displayed = showResolved ? conflicts : unresolved;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`w-full max-w-2xl rounded-2xl border shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${dark ? 'text-amber-400' : 'text-amber-600'}`} />
            <h2 className="text-base font-semibold">Choose Which Duplicate Version to Keep</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={mutedText}>
              Found multiple copies of the same skill with different contents. Pick the main version you want HarnessHub to sync.
            </p>
            {resolved.length > 0 && (
              <button
                type="button"
                onClick={() => setShowResolved((v) => !v)}
                className={`text-[11px] font-medium underline ${
                  dark ? 'text-indigo-300' : 'text-indigo-700'
                }`}
              >
                {showResolved ? 'Show pending only' : `Show already chosen (${resolved.length})`}
              </button>
            )}
          </div>

          {displayed.length === 0 ? (
            <div
              className={`rounded-xl border p-6 text-center ${
                dark
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              <CheckCircle2 className="mx-auto mb-2 h-6 w-6" />
              <div className="font-semibold">All duplicate skills have a chosen main version.</div>
            </div>
          ) : (
            displayed.map((conflict) => (
              <div
                key={conflict.id}
                className={`rounded-xl border p-4 ${
                  dark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{conflict.name}</span>
                  {conflict.resolvedPath && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        dark
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      Resolved
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  {conflict.variants.map((v) => {
                    const selected = conflict.resolvedPath === v.realPath;
                    return (
                      <div
                        key={v.realPath}
                        className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 ${
                          selected
                            ? dark
                              ? 'border-indigo-500 bg-indigo-500/15'
                              : 'border-indigo-400 bg-indigo-50'
                            : dark
                              ? 'border-zinc-800 bg-zinc-950'
                              : 'border-zinc-200 bg-white'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            From {v.source} · {v.fileCount} file(s)
                          </div>
                          <div className={`truncate font-mono text-[11px] ${mutedText}`}>
                            {v.realPath}
                          </div>
                          {v.description && (
                            <div className={`mt-0.5 line-clamp-2 ${mutedText}`}>
                              {v.description}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onResolve(conflict.id, v.realPath)}
                          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                            selected
                              ? 'bg-indigo-600 text-white'
                              : dark
                                ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                                : 'bg-zinc-200 text-zinc-800 hover:bg-zinc-300'
                          }`}
                        >
                          {selected ? 'Main Version ✓' : 'Keep This One'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
        <div className={`flex justify-end border-t px-5 py-3 ${borderClass}`}>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export const OrganizeModal: React.FC<{
  plan?: OrganizePlan;
  archives: OrganizeArchiveRecord[];
  busy: boolean;
  dark: boolean;
  onOrganize: () => void;
  onUndo: (archiveId: string) => void;
  onClose: () => void;
}> = ({ plan, archives, busy, dark, onOrganize, onUndo, onClose }) => {
  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';
  const counts = plan?.counts ?? {
    duplicateCopies: 0,
    chainedSymlinks: 0,
    brokenSymlinks: 0,
    adoptableSymlinks: 0,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div>
            <h2 className="text-base font-semibold">Clean Up & Organize Skills</h2>
            <p className={`text-xs ${mutedText}`}>
              One source of truth per skill, clean 1-hop links for every agent.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-1 ${dark ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5 text-xs">
          <div className="grid grid-cols-2 gap-2.5">
            <div
              className={`rounded-xl border p-3 ${
                dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="text-lg font-bold">{counts.duplicateCopies}</div>
              <div className="font-medium">Duplicate physical copies</div>
              <div className={`mt-0.5 text-[11px] ${mutedText}`}>
                Archive extra copies & replace with 1-hop links
              </div>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="text-lg font-bold">{counts.chainedSymlinks}</div>
              <div className="font-medium">Indirect / chained links</div>
              <div className={`mt-0.5 text-[11px] ${mutedText}`}>
                Point straight to the single main folder
              </div>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="text-lg font-bold">{counts.adoptableSymlinks}</div>
              <div className="font-medium">Existing manual links</div>
              <div className={`mt-0.5 text-[11px] ${mutedText}`}>
                Bring under Hub control so toggles work cleanly
              </div>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                dark ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="text-lg font-bold">{counts.brokenSymlinks}</div>
              <div className="font-medium">Broken links</div>
              <div className={`mt-0.5 text-[11px] ${mutedText}`}>
                Remove dangling symlinks with missing targets
              </div>
            </div>
          </div>

          {!plan?.hasChanges ? (
            <div
              className={`rounded-xl border p-4 text-center ${
                dark
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              <CheckCircle2 className="mx-auto mb-1.5 h-5 w-5" />
              <div className="font-semibold">Everything is already clean & organized!</div>
              <div className="mt-0.5 text-[11px]">
                Every skill has one single source of truth and direct 1-hop links.
              </div>
            </div>
          ) : (
            <div
              className={`rounded-xl border p-3 ${
                dark ? 'border-zinc-800 bg-zinc-900/40' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="mb-1.5 font-semibold">
                Planned actions ({plan.actions.length}) — old copies archived safely first:
              </div>
              <ul className={`max-h-40 space-y-1 overflow-y-auto text-[11px] ${mutedText}`}>
                {plan.actions.slice(0, 40).map((a, idx) => (
                  <li key={idx}>• {a.summary}</li>
                ))}
                {plan.actions.length > 40 && (
                  <li>...and {plan.actions.length - 40} more item(s)</li>
                )}
              </ul>
            </div>
          )}

          {archives.length > 0 && (
            <div className={`border-t pt-3 ${borderClass}`}>
              <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wider ${mutedText}`}>
                Previous Cleanups (Undo Anytime)
              </div>
              <div className="space-y-1.5">
                {archives.slice(0, 3).map((arch) => (
                  <div
                    key={arch.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                      dark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{arch.summary}</div>
                      <div className={`text-[10px] ${mutedText}`}>
                        {new Date(arch.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onUndo(arch.id)}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
                        dark
                          ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                      }`}
                    >
                      <RotateCcw className="h-3 w-3" /> Undo
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`flex justify-end gap-2 border-t px-5 py-3 ${borderClass}`}>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              dark ? 'border-zinc-700 text-zinc-300' : 'border-zinc-300 text-zinc-700'
            }`}
          >
            Close
          </button>
          {plan?.hasChanges && (
            <button
              type="button"
              disabled={busy}
              onClick={onOrganize}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'Organizing...' : 'Clean Up & Organize Now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
