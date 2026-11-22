import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  GripVertical,
  KeyRound,
  Plug,
  Sparkles,
} from 'lucide-react';
import React from 'react';
import {
  HARNESS_META,
  type HarnessId,
  type HermesOAuthTokenStatus,
  type McpServerItem,
  type SkillItem,
} from '../types';

export type DragCapabilityPayload =
  | { kind: 'skill'; id: string; title: string }
  | { kind: 'mcp'; id: string; title: string };

interface CapabilityCardProps {
  kind: 'skill' | 'mcp';
  skill?: SkillItem;
  mcp?: McpServerItem;
  assignedHarnesses: Record<HarnessId, boolean>;
  verifiedInCodex?: boolean;
  oauthStatus?: HermesOAuthTokenStatus;
  compact?: boolean;
  dark: boolean;
  onToggleHarness: (harnessId: HarnessId) => void;
  onInspect: () => void;
}

const ORIGIN_DISPLAY: Record<
  string,
  { label: string; darkClass: string; lightClass: string; hint: string }
> = {
  agents: {
    label: 'Shared Pool',
    darkClass: 'border-zinc-700 bg-zinc-800/80 text-zinc-300',
    lightClass: 'border-zinc-300 bg-zinc-100 text-zinc-700',
    hint: 'Stored in shared ~/.agents/skills pool',
  },
  hermes: {
    label: 'Native: Hermes',
    darkClass: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
    lightClass: 'border-amber-300 bg-amber-50 text-amber-800',
    hint: 'Natively belongs to Hermes (~/.hermes/skills) with full native Hermes capability',
  },
  codex: {
    label: 'Native: Codex',
    darkClass: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    lightClass: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    hint: 'Natively belongs to Codex (~/.codex/skills)',
  },
  opencode: {
    label: 'Native: OpenCode',
    darkClass: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
    lightClass: 'border-sky-300 bg-sky-50 text-sky-800',
    hint: 'Natively belongs to OpenCode (~/.config/opencode/skills)',
  },
  antigravity: {
    label: 'Native: AGY',
    darkClass: 'border-violet-500/30 bg-violet-500/15 text-violet-300',
    lightClass: 'border-violet-300 bg-violet-50 text-violet-800',
    hint: 'Natively belongs to Antigravity',
  },
  claude: {
    label: 'Native: Claude',
    darkClass: 'border-orange-500/30 bg-orange-500/15 text-orange-300',
    lightClass: 'border-orange-300 bg-orange-50 text-orange-800',
    hint: 'Natively belongs to Claude Code (~/.claude/skills)',
  },
  gemini: {
    label: 'Native: Gemini',
    darkClass: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300',
    lightClass: 'border-cyan-300 bg-cyan-50 text-cyan-800',
    hint: 'Natively belongs to Gemini CLI',
  },
};

export const CapabilityCard: React.FC<CapabilityCardProps> = ({
  kind,
  skill,
  mcp,
  assignedHarnesses,
  verifiedInCodex,
  oauthStatus,
  compact = true,
  dark,
  onToggleHarness,
  onInspect,
}) => {
  const id = kind === 'skill' ? skill!.id : mcp!.id;
  const title = kind === 'skill' ? skill!.name : mcp!.name;
  const dragId = `${kind}:${id}`;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: {
      kind,
      id,
      title,
    } satisfies DragCapabilityPayload,
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  const activeCount = HARNESS_META.filter((h) => assignedHarnesses[h.id]).length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-xl border transition-all ${compact ? 'p-2.5' : 'p-3.5'} ${
        isDragging ? 'opacity-50 ring-2 ring-indigo-500' : ''
      } ${
        dark
          ? 'border-zinc-800 bg-zinc-900/75 hover:border-zinc-700 hover:bg-zinc-900'
          : 'border-zinc-200 bg-white hover:border-zinc-300 shadow-xs'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${title}`}
          className={`mt-0.5 cursor-grab rounded p-1 active:cursor-grabbing ${
            dark
              ? 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
          }`}
          title="Drag onto a Harness card on the right"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {kind === 'skill' ? (
                <Sparkles
                  className={`h-3.5 w-3.5 shrink-0 ${
                    dark ? 'text-indigo-400' : 'text-indigo-600'
                  }`}
                />
              ) : (
                <Plug
                  className={`h-3.5 w-3.5 shrink-0 ${
                    dark ? 'text-emerald-400' : 'text-emerald-600'
                  }`}
                />
              )}
              <button
                type="button"
                onClick={onInspect}
                className={`truncate text-left text-xs font-semibold hover:underline ${
                  dark ? 'text-zinc-100' : 'text-zinc-900'
                }`}
                title={title}
              >
                {title}
              </button>
            </div>

            <button
              type="button"
              onClick={onInspect}
              className={`shrink-0 rounded-md p-1 text-xs transition ${
                dark
                  ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
              title="Inspect details"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                dark ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
              }`}
            >
              {kind === 'skill' ? skill!.category : mcp!.transport.toUpperCase()}
            </span>
            {kind === 'skill' && (() => {
              const origin = ORIGIN_DISPLAY[skill!.originSource] ?? {
                label: `Native: ${skill!.originSource}`,
                darkClass: 'border-zinc-700 bg-zinc-800 text-zinc-300',
                lightClass: 'border-zinc-300 bg-zinc-100 text-zinc-700',
                hint: `Natively belongs to ${skill!.originSource}`,
              };
              return (
                <span
                  title={`${origin.hint} (${skill!.canonicalPath})`}
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                    dark ? origin.darkClass : origin.lightClass
                  }`}
                >
                  {origin.label}
                </span>
              );
            })()}
            {kind === 'mcp' && (
              <span
                title={
                  mcp!.discoveredIn.length > 0
                    ? `Natively configured in: ${mcp!.discoveredIn.join(', ')}`
                    : 'Added in HarnessHub'
                }
                className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                  dark
                    ? 'border-zinc-700 bg-zinc-800/80 text-zinc-300'
                    : 'border-zinc-300 bg-zinc-100 text-zinc-700'
                }`}
              >
                {mcp!.discoveredIn.length > 0
                  ? `Native: ${mcp!.discoveredIn.join(', ')}`
                  : 'Hub Added'}
              </span>
            )}
            {kind === 'mcp' && oauthStatus?.present && (
              <span
                title={
                  oauthStatus.valid
                    ? `Sharing Hermes default OAuth login${oauthStatus.expiresAt ? ` (valid until ${new Date(oauthStatus.expiresAt).toLocaleDateString()})` : ''}`
                    : 'Hermes default OAuth token expired — re-auth once in Hermes'
                }
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                  oauthStatus.valid
                    ? dark
                      ? 'border-emerald-500/25 bg-emerald-500/15 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : dark
                      ? 'border-amber-500/25 bg-amber-500/15 text-amber-300'
                      : 'border-amber-300 bg-amber-50 text-amber-800'
                }`}
              >
                <KeyRound className="h-2.5 w-2.5" />
                {oauthStatus.valid ? 'Hermes OAuth' : 'Re-auth in Hermes'}
              </span>
            )}
            {kind === 'skill' && skill!.portability && (
              <span
                title={
                  skill!.portability.warnings.map((w) => w.message).join(' | ') ||
                  'Standard SKILL.md format (portable across harnesses)'
                }
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                  skill!.portability.status === 'portable'
                    ? dark
                      ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-400'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : skill!.portability.status === 'caution'
                      ? dark
                        ? 'border-amber-500/20 bg-amber-500/15 text-amber-400'
                        : 'border-amber-300 bg-amber-50 text-amber-800'
                      : dark
                        ? 'border-rose-500/20 bg-rose-500/15 text-rose-400'
                        : 'border-rose-300 bg-rose-50 text-rose-700'
                }`}
              >
                {skill!.portability.status === 'portable' ? (
                  <CheckCircle2 className="h-2.5 w-2.5" />
                ) : (
                  <AlertTriangle className="h-2.5 w-2.5" />
                )}
                {skill!.portability.status === 'portable'
                  ? 'Portable'
                  : skill!.portability.status === 'caution'
                    ? 'Review'
                    : 'Incomplete'}
              </span>
            )}
            {kind === 'skill' && verifiedInCodex && (
              <span
                title="Confirmed loaded in Codex runtime via codex app-server skills/list"
                className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                  dark
                    ? 'border-indigo-500/25 bg-indigo-500/15 text-indigo-300'
                    : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                }`}
              >
                <CheckCircle2 className="h-2.5 w-2.5" /> Live
              </span>
            )}
          </div>

          <p
            className={`mt-1 text-[11px] leading-snug ${
              compact ? 'line-clamp-1' : 'line-clamp-2'
            } ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}
          >
            {kind === 'skill'
              ? skill!.description || 'No description provided in SKILL.md'
              : mcp!.url || [mcp!.command, ...(mcp!.args ?? [])].join(' ')}
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap gap-1">
              {HARNESS_META.map((h) => {
                const active = assignedHarnesses[h.id];
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => onToggleHarness(h.id)}
                    aria-pressed={active}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? dark
                          ? 'border-indigo-500/60 bg-indigo-500/20 text-indigo-200'
                          : 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : dark
                          ? 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                    }`}
                  >
                    {h.shortName}
                  </button>
                );
              })}
            </div>
            <span className={`text-[10px] font-medium ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>
              {activeCount}/4
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
