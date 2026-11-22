import { useDroppable } from '@dnd-kit/core';
import { AlertTriangle, CheckCircle2, ChevronRight, Plug, Sparkles, XCircle } from 'lucide-react';
import React from 'react';
import type {
  HarnessDetectionResult,
  HarnessId,
  SyncPlan,
  VerificationResult,
} from '../types';

interface HarnessDropCardProps {
  harnessId: HarnessId;
  name: string;
  tagline: string;
  detection?: HarnessDetectionResult;
  plan?: SyncPlan;
  verification?: VerificationResult;
  assignedSkills: string[];
  assignedMcps: string[];
  dark: boolean;
  onOpenDetail: () => void;
}

export const HarnessDropCard: React.FC<HarnessDropCardProps> = ({
  harnessId,
  name,
  tagline,
  detection,
  plan,
  verification,
  assignedSkills,
  assignedMcps,
  dark,
  onOpenDetail,
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `harness:${harnessId}`,
    data: { harnessId },
  });

  const pendingCount =
    plan?.actions.filter((a) => a.kind !== 'symlink_skip_unmanaged').length ?? 0;

  const renderHealthBadge = () => {
    if (!verification) {
      return (
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            detection?.installed
              ? dark
                ? 'border-zinc-700 bg-zinc-800 text-zinc-200'
                : 'border-zinc-200 bg-zinc-100 text-zinc-700'
              : dark
                ? 'border-zinc-800 bg-zinc-900 text-zinc-500'
                : 'border-zinc-200 bg-zinc-50 text-zinc-500'
          }`}
        >
          {detection?.installed ? 'Detected' : 'Not detected'}
        </span>
      );
    }

    if (verification.status === 'healthy') {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            dark
              ? 'border-emerald-500/25 bg-emerald-500/15 text-emerald-400'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <CheckCircle2 className="h-3 w-3" /> Healthy
        </span>
      );
    }
    if (verification.status === 'auth_required') {
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            dark
              ? 'border-amber-500/25 bg-amber-500/15 text-amber-400'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          <AlertTriangle className="h-3 w-3" /> Auth Required
        </span>
      );
    }
    if (verification.status === 'not_installed') {
      return (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            dark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-100 text-zinc-600'
          }`}
        >
          Not Installed
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          dark
            ? 'border-rose-500/25 bg-rose-500/15 text-rose-400'
            : 'border-rose-200 bg-rose-50 text-rose-700'
        }`}
      >
        <XCircle className="h-3 w-3" /> Error
      </span>
    );
  };

  return (
    <div
      ref={setNodeRef}
      onClick={onOpenDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className={`cursor-pointer rounded-2xl border p-4 transition-all ${
        isOver
          ? dark
            ? 'scale-[1.01] border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/40'
            : 'scale-[1.01] border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/30'
          : dark
            ? 'border-zinc-800 bg-zinc-900/75 hover:border-zinc-700 hover:bg-zinc-900'
            : 'border-zinc-200 bg-white hover:border-zinc-300 shadow-xs'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-base font-semibold ${dark ? 'text-zinc-100' : 'text-zinc-900'}`}>
              {name}
            </h3>
            {renderHealthBadge()}
            {pendingCount > 0 && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  dark
                    ? 'border-amber-500/25 bg-amber-500/15 text-amber-300'
                    : 'border-amber-300 bg-amber-50 text-amber-800'
                }`}
              >
                {pendingCount} pending
              </span>
            )}
          </div>
          <p className={`mt-0.5 text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>{tagline}</p>
        </div>

        <ChevronRight className={`h-4 w-4 ${dark ? 'text-zinc-500' : 'text-zinc-400'}`} />
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <Sparkles className={`h-3.5 w-3.5 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
          <span className="font-semibold">{assignedSkills.length}</span>
          <span className={dark ? 'text-zinc-400' : 'text-zinc-600'}>Skills</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Plug className={`h-3.5 w-3.5 ${dark ? 'text-emerald-400' : 'text-emerald-600'}`} />
          <span className="font-semibold">{assignedMcps.length}</span>
          <span className={dark ? 'text-zinc-400' : 'text-zinc-600'}>MCPs</span>
        </div>
      </div>

      {isOver ? (
        <div
          className={`mt-3 rounded-lg border border-dashed py-2 text-center text-xs font-medium ${
            dark
              ? 'border-indigo-400/70 text-indigo-300'
              : 'border-indigo-400 bg-indigo-50 text-indigo-700'
          }`}
        >
          Drop here to assign to {name}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {assignedMcps.slice(0, 4).map((m) => (
            <span
              key={`mcp-${m}`}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {m}
            </span>
          ))}
          {assignedSkills.slice(0, 4).map((s) => (
            <span
              key={`skill-${s}`}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                dark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-100 text-zinc-700'
              }`}
            >
              {s}
            </span>
          ))}
          {assignedSkills.length + assignedMcps.length > 8 && (
            <span className={`px-1 py-0.5 text-[11px] ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
              +{assignedSkills.length + assignedMcps.length - 8} more
            </span>
          )}
          {assignedSkills.length === 0 && assignedMcps.length === 0 && (
            <span className={`text-[11px] italic ${dark ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Drag capabilities here or click pills on the left
            </span>
          )}
        </div>
      )}

      {verification && (
        <p className={`mt-2.5 truncate text-[11px] ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          {verification.summary}
        </p>
      )}
    </div>
  );
};
