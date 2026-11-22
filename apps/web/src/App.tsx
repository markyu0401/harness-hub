import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  LayoutGrid,
  List,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Wand2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, AuthRequiredError } from './api';
import { CapabilityCard, type DragCapabilityPayload } from './components/CapabilityCard';
import {
  AddMcpModal,
  ApplyConfirmModal,
  BackupHistoryDrawer,
  ConflictResolverModal,
  HarnessDetailDrawer,
  McpInspectorDrawer,
  OrganizeModal,
  SkillInspectorDrawer,
} from './components/DrawersAndModals';
import { HarnessDropCard } from './components/HarnessDropCard';
import { PasscodeLockScreen, SettingsModal } from './components/SettingsModal';
import { HARNESS_META, type HarnessId, type HubStatePayload, type SkillItem } from './types';

export function App() {
  const [state, setState] = useState<HubStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(true);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'skills' | 'mcps' | 'review'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [originFilter, setOriginFilter] = useState<string>('all');
  const [harnessFilter, setHarnessFilter] = useState<'all' | HarnessId | 'unassigned'>('all');
  const [compactView, setCompactView] = useState(true);
  const [pageSize, setPageSize] = useState<number>(24);
  const [page, setPage] = useState<number>(1);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [activeDrag, setActiveDrag] = useState<DragCapabilityPayload | null>(null);
  const [inspectedSkill, setInspectedSkill] = useState<{
    skill: SkillItem;
    markdown: string;
    loading: boolean;
  } | null>(null);
  const [inspectedMcpId, setInspectedMcpId] = useState<string | null>(null);
  const [inspectedHarness, setInspectedHarness] = useState<HarnessId | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showOrganize, setShowOrganize] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [authLocked, setAuthLocked] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt: () => Promise<void> } | null>(
    null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const showNotice = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getState();
      setAuthLocked(false);
      setState(next);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        setAuthLocked(true);
      } else {
        showNotice('err', err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [showNotice]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as Event & { prompt: () => Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
  }, [dark]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, kindFilter, categoryFilter, originFilter, harnessFilter, pageSize]);

  const handleToggleSkill = async (skillId: string, harnessId: HarnessId) => {
    if (!state) return;
    const current = Boolean(state.registry.allocations.skills[skillId]?.[harnessId]);
    try {
      const next = await api.toggleSkill(skillId, harnessId, !current);
      setState(next);
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : String(err));
    }
  };

  const handleToggleMcp = async (mcpId: string, harnessId: HarnessId) => {
    if (!state) return;
    const current = Boolean(state.registry.allocations.mcps[mcpId]?.[harnessId]?.enabled);
    try {
      const next = await api.updateMcpAllocation({ mcpId, harnessId, enabled: !current });
      setState(next);
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : String(err));
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragCapabilityPayload | undefined;
    if (data) setActiveDrag(data);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null);
    const overHarness = event.over?.data?.current?.harnessId as HarnessId | undefined;
    const item = event.active.data.current as DragCapabilityPayload | undefined;
    if (!overHarness || !item || !state) return;

    try {
      if (item.kind === 'skill') {
        const next = await api.toggleSkill(item.id, overHarness, true);
        setState(next);
        showNotice('ok', `Assigned '${item.title}' to ${overHarness}`);
      } else {
        const next = await api.updateMcpAllocation({
          mcpId: item.id,
          harnessId: overHarness,
          enabled: true,
        });
        setState(next);
        showNotice('ok', `Enabled MCP '${item.title}' on ${overHarness}`);
      }
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : String(err));
    }
  };

  const handleInspectSkill = async (skill: SkillItem) => {
    setInspectedSkill({ skill, markdown: '', loading: true });
    try {
      const res = await api.getSkillDetail(skill.id);
      setInspectedSkill({ skill: res.skill, markdown: res.markdown, loading: false });
    } catch (err) {
      setInspectedSkill({
        skill,
        markdown: `Failed loading SKILL.md: ${err instanceof Error ? err.message : String(err)}`,
        loading: false,
      });
    }
  };

  const handleApply = async () => {
    setBusy(true);
    try {
      const next = await api.apply();
      setState(next);
      setShowApplyModal(false);
      showNotice('ok', 'Applied changes with automatic backup!');
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRescan = async () => {
    setBusy(true);
    try {
      const next = await api.rescan();
      setState(next);
      showNotice('ok', `Scanned ${next.registry.skills.length} skills & ${next.registry.mcps.length} MCPs`);
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    try {
      const res = await api.verify();
      setState((prev) =>
        prev ? { ...prev, verifications: res.verifications, mcpProbes: res.mcpProbes } : prev
      );
      showNotice('ok', 'Live verification completed');
    } catch (err) {
      showNotice('err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const codexLoadedSkills = useMemo(() => {
    const codexVerif = state?.verifications.find((v) => v.harnessId === 'codex');
    return new Set(codexVerif?.loadedSkillNames ?? []);
  }, [state]);

  const reviewCount = useMemo(
    () =>
      state?.registry.skills.filter(
        (s) => s.portability && s.portability.status !== 'portable'
      ).length ?? 0,
    [state]
  );

  const unresolvedConflicts = useMemo(
    () => state?.registry.conflicts.filter((c) => !c.resolvedPath) ?? [],
    [state]
  );

  const categoryEntries = useMemo(() => {
    if (!state) return [];
    const counts = new Map<string, number>();
    for (const s of state.registry.skills) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [state]);

  const originEntries = useMemo(() => {
    if (!state) return [];
    const counts = new Map<string, number>();
    for (const s of state.registry.skills) {
      counts.set(s.originSource, (counts.get(s.originSource) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [state]);

  const filteredItems = useMemo(() => {
    if (!state) return [];
    const q = search.trim().toLowerCase();
    const out: Array<
      | { kind: 'mcp'; id: string; item: HubStatePayload['registry']['mcps'][number] }
      | { kind: 'skill'; id: string; item: SkillItem }
    > = [];

    if ((kindFilter === 'all' || kindFilter === 'mcps') && categoryFilter === 'all' && originFilter === 'all') {
      for (const m of state.registry.mcps) {
        const alloc = state.registry.allocations.mcps[m.id] ?? {};
        if (harnessFilter === 'unassigned') {
          if (HARNESS_META.some((h) => alloc[h.id]?.enabled)) continue;
        } else if (harnessFilter !== 'all') {
          if (!alloc[harnessFilter]?.enabled) continue;
        }
        if (
          q &&
          !m.name.toLowerCase().includes(q) &&
          !(m.url ?? '').toLowerCase().includes(q) &&
          !(m.command ?? '').toLowerCase().includes(q)
        ) {
          continue;
        }
        out.push({ kind: 'mcp', id: m.id, item: m });
      }
    }

    if (kindFilter !== 'mcps') {
      for (const s of state.registry.skills) {
        if (kindFilter === 'review' && (!s.portability || s.portability.status === 'portable')) {
          continue;
        }
        if (categoryFilter !== 'all' && s.category !== categoryFilter) continue;
        if (originFilter !== 'all' && s.originSource !== originFilter) continue;
        const alloc = state.registry.allocations.skills[s.id] ?? {};
        if (harnessFilter === 'unassigned') {
          if (HARNESS_META.some((h) => alloc[h.id])) continue;
        } else if (harnessFilter !== 'all') {
          if (!alloc[harnessFilter]) continue;
        }
        if (
          q &&
          !s.name.toLowerCase().includes(q) &&
          !s.description.toLowerCase().includes(q) &&
          !s.category.toLowerCase().includes(q) &&
          !s.tags.some((t) => t.toLowerCase().includes(q))
        ) {
          continue;
        }
        out.push({ kind: 'skill', id: s.id, item: s });
      }
    }

    return out;
  }, [state, kindFilter, categoryFilter, originFilter, harnessFilter, search]);

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    if (pageSize === 0) return filteredItems;
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, pageSize, safePage]);

  const inspectedMcp = useMemo(
    () => state?.registry.mcps.find((m) => m.id === inspectedMcpId) ?? null,
    [state, inspectedMcpId]
  );

  const btnSecondary = dark
    ? 'border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
    : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100';

  const selectClass = dark
    ? 'border-zinc-800 bg-zinc-900 text-zinc-200'
    : 'border-zinc-300 bg-white text-zinc-800';

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  if (authLocked) {
    return <PasscodeLockScreen dark={dark} onUnlocked={() => void loadInitial()} />;
  }

  return (
    <div
      className={`min-h-screen transition-colors ${
        dark ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-100/70 text-zinc-900'
      }`}
    >
      {/* Top Navbar */}
      <header
        className={`sticky top-0 z-30 border-b backdrop-blur-md ${
          dark ? 'border-zinc-800/80 bg-zinc-950/90' : 'border-zinc-200 bg-white/95'
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">HarnessHub</h1>
              <p className={`text-[11px] ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                Multi-Agent Skill & MCP Relay
              </p>
            </div>
          </div>

          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search
              className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
                dark ? 'text-zinc-500' : 'text-zinc-400'
              }`}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills, MCP servers, tags..."
              className={`w-full rounded-xl border py-1.5 pl-9 pr-3 text-xs outline-none transition ${
                dark
                  ? 'border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500'
                  : 'border-zinc-300 bg-zinc-50 text-zinc-900 placeholder:text-zinc-500 focus:border-indigo-500 focus:bg-white'
              }`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleRescan}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${btnSecondary}`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              Rescan
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleVerify}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${btnSecondary}`}
            >
              <Activity
                className={`h-3.5 w-3.5 ${dark ? 'text-emerald-400' : 'text-emerald-600'}`}
              />
              Verify Live
            </button>

            <button
              type="button"
              onClick={() => setShowAddMcp(true)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${btnSecondary}`}
            >
              <Plus className={`h-3.5 w-3.5 ${dark ? 'text-emerald-400' : 'text-emerald-600'}`} />
              Add MCP
            </button>

            <button
              type="button"
              onClick={() => setShowOrganize(true)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${btnSecondary}`}
            >
              <Wand2 className={`h-3.5 w-3.5 ${dark ? 'text-amber-400' : 'text-amber-600'}`} />
              Organize
              {state && (state.organizePlan?.actions.length ?? 0) > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                    dark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {state.organizePlan!.actions.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowBackups(true)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${btnSecondary}`}
            >
              <History className="h-3.5 w-3.5" />
              History
            </button>

            <button
              type="button"
              disabled={!state || state.pendingChangesCount === 0 || busy}
              onClick={() => setShowApplyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Apply Changes ({state?.pendingChangesCount ?? 0})
            </button>

            <button
              type="button"
              onClick={() => setShowSettings(true)}
              aria-label="Open settings"
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${btnSecondary}`}
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </button>

            {installPrompt && (
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                <Download className="h-3.5 w-3.5" /> Install App
              </button>
            )}

            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              aria-label="Toggle theme"
              className={`rounded-lg border p-1.5 transition ${btnSecondary}`}
            >
              {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        {toast && (
          <div
            className={`mb-4 flex items-center justify-between rounded-xl border px-4 py-2.5 text-xs font-medium ${
              toast.kind === 'ok'
                ? dark
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : dark
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-rose-300 bg-rose-50 text-rose-800'
            }`}
          >
            <span>{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} className="opacity-70 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {unresolvedConflicts.length > 0 && (
          <div
            className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
              dark
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                : 'border-amber-300 bg-amber-50 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Detected <strong>{unresolvedConflicts.length}</strong> duplicate skill(s) with different contents across folders.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowConflicts(true)}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                dark
                  ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                  : 'bg-amber-200/80 text-amber-950 hover:bg-amber-300'
              }`}
            >
              Resolve Duplicates
            </button>
          </div>
        )}

        {loading || !state ? (
          <div className={`py-24 text-center text-sm ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            Scanning host skills and MCP configurations...
          </div>
        ) : (
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left Pane: Capability Library */}
              <section className="space-y-3 lg:col-span-7">
                {/* Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        ['all', `All (${state.registry.skills.length + state.registry.mcps.length})`],
                        ['mcps', `MCPs (${state.registry.mcps.length})`],
                        ['skills', `Skills (${state.registry.skills.length})`],
                        ...(reviewCount > 0
                          ? ([['review', `Needs Review (${reviewCount})`]] as const)
                          : []),
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKindFilter(k)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          kindFilter === k
                            ? 'bg-indigo-600 text-white'
                            : dark
                              ? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                              : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={harnessFilter}
                      onChange={(e) =>
                        setHarnessFilter(e.target.value as 'all' | HarnessId | 'unassigned')
                      }
                      aria-label="Filter by harness"
                      className={`rounded-lg border px-2 py-1.5 text-xs ${selectClass}`}
                    >
                      <option value="all">All Harnesses</option>
                      {HARNESS_META.map((h) => (
                        <option key={h.id} value={h.id}>
                          On {h.name}
                        </option>
                      ))}
                      <option value="unassigned">Unassigned</option>
                    </select>

                    {kindFilter !== 'mcps' && (
                      <>
                        <select
                          value={originFilter}
                          onChange={(e) => setOriginFilter(e.target.value)}
                          aria-label="Filter by native owner"
                          className={`rounded-lg border px-2 py-1.5 text-xs ${selectClass}`}
                        >
                          <option value="all">All Origins</option>
                          {originEntries.map(([orig, count]) => (
                            <option key={orig} value={orig}>
                              {orig === 'agents' ? 'Shared Pool' : `Native: ${orig}`} ({count})
                            </option>
                          ))}
                        </select>

                        <select
                          value={categoryFilter}
                          onChange={(e) => setCategoryFilter(e.target.value)}
                          aria-label="Filter by category"
                          className={`rounded-lg border px-2 py-1.5 text-xs ${selectClass}`}
                        >
                          <option value="all">
                            All Categories ({state.registry.skills.length})
                          </option>
                          {categoryEntries.map(([cat, count]) => (
                            <option key={cat} value={cat}>
                              {cat} ({count})
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => setCompactView((v) => !v)}
                      title={compactView ? 'Switch to detailed cards' : 'Switch to compact grid'}
                      className={`rounded-lg border p-1.5 ${btnSecondary}`}
                    >
                      {compactView ? (
                        <LayoutGrid className="h-3.5 w-3.5" />
                      ) : (
                        <List className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Pagination & Count Bar */}
                <div
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                    dark
                      ? 'border-zinc-800/80 bg-zinc-900/40 text-zinc-400'
                      : 'border-zinc-200 bg-white text-zinc-600'
                  }`}
                >
                  <span>
                    Showing{' '}
                    <strong>
                      {filteredItems.length === 0
                        ? 0
                        : (safePage - 1) * (pageSize || filteredItems.length) + 1}
                    </strong>
                    –
                    <strong>
                      {pageSize === 0
                        ? filteredItems.length
                        : Math.min(safePage * pageSize, filteredItems.length)}
                    </strong>{' '}
                    of <strong>{filteredItems.length}</strong>
                  </span>

                  <div className="flex items-center gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      aria-label="Items per page"
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] ${selectClass}`}
                    >
                      <option value={24}>24 / page</option>
                      <option value={48}>48 / page</option>
                      <option value={0}>Show all</option>
                    </select>

                    {totalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={safePage <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className={`rounded-md border p-1 disabled:opacity-40 ${btnSecondary}`}
                          aria-label="Previous page"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <span className="px-1.5 text-[11px] font-medium">
                          {safePage}/{totalPages}
                        </span>
                        <button
                          type="button"
                          disabled={safePage >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          className={`rounded-md border p-1 disabled:opacity-40 ${btnSecondary}`}
                          aria-label="Next page"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Capability Grid */}
                <div
                  className={
                    compactView ? 'grid grid-cols-1 gap-2.5 md:grid-cols-2' : 'space-y-2.5'
                  }
                >
                  {pagedItems.map((entry) => {
                    if (entry.kind === 'mcp') {
                      const mcp = entry.item;
                      const assigned = Object.fromEntries(
                        HARNESS_META.map((h) => [
                          h.id,
                          Boolean(state.registry.allocations.mcps[mcp.id]?.[h.id]?.enabled),
                        ])
                      ) as Record<HarnessId, boolean>;
                      const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  if (authLocked) {
    return <PasscodeLockScreen dark={dark} onUnlocked={() => void loadInitial()} />;
  }

  return (
                        <CapabilityCard
                          key={`mcp-${mcp.id}`}
                          kind="mcp"
                          mcp={mcp}
                          assignedHarnesses={assigned}
                          oauthStatus={state.oauthStatuses?.[mcp.id]}
                          compact={compactView}
                          dark={dark}
                          onToggleHarness={(h) => handleToggleMcp(mcp.id, h)}
                          onInspect={() => setInspectedMcpId(mcp.id)}
                        />
                      );
                    }

                    const skill = entry.item;
                    const assigned = Object.fromEntries(
                      HARNESS_META.map((h) => [
                        h.id,
                        Boolean(state.registry.allocations.skills[skill.id]?.[h.id]),
                      ])
                    ) as Record<HarnessId, boolean>;
                    const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  if (authLocked) {
    return <PasscodeLockScreen dark={dark} onUnlocked={() => void loadInitial()} />;
  }

  return (
                      <CapabilityCard
                        key={`skill-${skill.id}`}
                        kind="skill"
                        skill={skill}
                        assignedHarnesses={assigned}
                        verifiedInCodex={
                          codexLoadedSkills.has(skill.id) || codexLoadedSkills.has(skill.name)
                        }
                        compact={compactView}
                        dark={dark}
                        onToggleHarness={(h) => handleToggleSkill(skill.id, h)}
                        onInspect={() => handleInspectSkill(skill)}
                      />
                    );
                  })}
                </div>

                {pagedItems.length === 0 && (
                  <div
                    className={`rounded-xl border border-dashed py-12 text-center text-xs ${
                      dark ? 'border-zinc-800 text-zinc-400' : 'border-zinc-300 text-zinc-600'
                    }`}
                  >
                    No matching capabilities found. Try clearing your search or filters.
                  </div>
                )}

                {totalPages > 1 && (
                  <div className="flex items-center justify-end gap-1 pt-1">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40 ${btnSecondary}`}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </button>
                    <span className={`px-2 text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      Page {safePage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40 ${btnSecondary}`}
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </section>

              {/* Right Pane: 4 Harness Dropzones */}
              <aside className="space-y-3 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <h2
                    className={`text-xs font-semibold uppercase tracking-wider ${
                      dark ? 'text-zinc-400' : 'text-zinc-600'
                    }`}
                  >
                    Target Harnesses (Drop or Click)
                  </h2>
                  <span className={`text-[11px] ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Gateway: :{state.registry.gatewayPort}/mcp/:harness
                  </span>
                </div>

                <div className="sticky top-20 space-y-3">
                  {HARNESS_META.map((h) => {
                    const assignedSkills = state.registry.skills
                      .filter((s) => state.registry.allocations.skills[s.id]?.[h.id])
                      .map((s) => s.name);
                    const assignedMcps = state.registry.mcps
                      .filter((m) => state.registry.allocations.mcps[m.id]?.[h.id]?.enabled)
                      .map((m) => m.name);

                    const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  if (authLocked) {
    return <PasscodeLockScreen dark={dark} onUnlocked={() => void loadInitial()} />;
  }

  return (
                      <HarnessDropCard
                        key={h.id}
                        harnessId={h.id}
                        name={h.name}
                        tagline={h.tagline}
                        detection={state.detections[h.id]}
                        plan={state.plans[h.id]}
                        verification={state.verifications.find((v) => v.harnessId === h.id)}
                        assignedSkills={assignedSkills}
                        assignedMcps={assignedMcps}
                        dark={dark}
                        onOpenDetail={() => setInspectedHarness(h.id)}
                      />
                    );
                  })}
                </div>
              </aside>
            </div>

            <DragOverlay>
              {activeDrag && (
                <div className="rounded-xl border border-indigo-500 bg-zinc-900/95 px-3.5 py-2 text-xs font-semibold text-white shadow-xl">
                  Assigning {activeDrag.title}...
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {/* Drawers & Modals */}
      {inspectedSkill && state && (
        <SkillInspectorDrawer
          skill={inspectedSkill.skill}
          markdown={inspectedSkill.markdown}
          loading={inspectedSkill.loading}
          assigned={
            Object.fromEntries(
              HARNESS_META.map((h) => [
                h.id,
                Boolean(state.registry.allocations.skills[inspectedSkill.skill.id]?.[h.id]),
              ])
            ) as Record<HarnessId, boolean>
          }
          verifiedInCodex={
            codexLoadedSkills.has(inspectedSkill.skill.id) ||
            codexLoadedSkills.has(inspectedSkill.skill.name)
          }
          dark={dark}
          onToggleHarness={(h) => handleToggleSkill(inspectedSkill.skill.id, h)}
          onClose={() => setInspectedSkill(null)}
        />
      )}

      {inspectedMcp && state && (
        <McpInspectorDrawer
          mcp={inspectedMcp}
          allocations={state.registry.allocations.mcps[inspectedMcp.id] ?? {}}
          oauthStatus={state.oauthStatuses?.[inspectedMcp.id]}
          dark={dark}
          onUpdateAllocation={async (harnessId, patch) => {
            const next = await api.updateMcpAllocation({
              mcpId: inspectedMcp.id,
              harnessId,
              ...patch,
            });
            setState(next);
          }}
          onDelete={async () => {
            const next = await api.deleteMcp(inspectedMcp.id);
            setState(next);
            setInspectedMcpId(null);
            showNotice('ok', `Removed '${inspectedMcp.id}' from catalog`);
          }}
          onClose={() => setInspectedMcpId(null)}
        />
      )}

      {inspectedHarness && state && (
        <HarnessDetailDrawer
          harnessId={inspectedHarness}
          state={state}
          dark={dark}
          onRemoveSkill={(skillId) => void handleToggleSkill(skillId, inspectedHarness)}
          onRemoveMcp={(mcpId) => void handleToggleMcp(mcpId, inspectedHarness)}
          onClose={() => setInspectedHarness(null)}
        />
      )}

      {showApplyModal && state && (
        <ApplyConfirmModal
          state={state}
          applying={busy}
          dark={dark}
          onConfirm={handleApply}
          onClose={() => setShowApplyModal(false)}
        />
      )}

      {showBackups && state && (
        <BackupHistoryDrawer
          backups={state.backups}
          dark={dark}
          onRollback={async (id) => {
            const next = await api.rollback(id);
            setState(next);
            setShowBackups(false);
            showNotice('ok', `Restored backup snapshot ${id}`);
          }}
          onClose={() => setShowBackups(false)}
        />
      )}

      {showAddMcp && (
        <AddMcpModal
          dark={dark}
          onAdd={async (payload) => {
            const next = await api.createMcp(payload);
            setState(next);
            showNotice('ok', `Added MCP server '${payload.id}'`);
          }}
          onClose={() => setShowAddMcp(false)}
        />
      )}

      {showConflicts && state && (
        <ConflictResolverModal
          conflicts={state.registry.conflicts}
          dark={dark}
          onResolve={async (skillId, resolvedPath) => {
            const next = await api.resolveConflict(skillId, resolvedPath);
            setState(next);
            const remaining = next.registry.conflicts.filter((c) => !c.resolvedPath).length;
            if (remaining === 0) {
              setShowConflicts(false);
              showNotice('ok', 'All duplicate skills resolved');
            } else {
              showNotice('ok', `Saved main version for '${skillId}' (${remaining} left)`);
            }
          }}
          onClose={() => setShowConflicts(false)}
        />
      )}

      {showOrganize && state && (
        <OrganizeModal
          plan={state.organizePlan}
          archives={state.organizeArchives ?? []}
          busy={busy}
          dark={dark}
          onOrganize={async () => {
            setBusy(true);
            try {
              const res = await api.organizeApply();
              setState(res);
              showNotice(
                'ok',
                `Organized ${res.result.appliedCount} item(s) — old copies safely archived!`
              );
            } catch (err) {
              showNotice('err', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          onUndo={async (archiveId) => {
            setBusy(true);
            try {
              const res = await api.organizeUndo(archiveId);
              setState(res);
              showNotice('ok', `Restored layout from archive ${archiveId}`);
            } catch (err) {
              showNotice('err', err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
          onClose={() => setShowOrganize(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          dark={dark}
          canInstallPwa={Boolean(installPrompt)}
          onInstallPwa={() => void handleInstallPwa()}
          onNotice={showNotice}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
