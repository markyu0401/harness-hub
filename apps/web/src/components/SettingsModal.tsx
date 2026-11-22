import {
  CheckCircle2,
  Download,
  Globe,
  Laptop,
  Lock,
  Power,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { SettingsPayload } from '../types';

export const SettingsModal: React.FC<{
  dark: boolean;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
  onNotice: (kind: 'ok' | 'err', text: string) => void;
  onClose: () => void;
}> = ({ dark, canInstallPwa, onInstallPwa, onNotice, onClose }) => {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [bindMode, setBindMode] = useState<'local' | 'lan'>('local');
  const [port, setPort] = useState<number>(4310);
  const [passcode, setPasscode] = useState('');
  const [exposeSkillsMcp, setExposeSkillsMcp] = useState(true);
  const [verifyAfterApply, setVerifyAfterApply] = useState(false);
  const [busy, setBusy] = useState(false);

  const borderClass = dark ? 'border-zinc-800' : 'border-zinc-200';
  const mutedText = dark ? 'text-zinc-400' : 'text-zinc-600';
  const inputClass = dark
    ? 'border-zinc-800 bg-zinc-900 text-zinc-100'
    : 'border-zinc-300 bg-white text-zinc-900';

  const load = async () => {
    try {
      const payload = await api.getSettings();
      setData(payload);
      setBindMode(payload.settings.bindMode);
      setPort(payload.settings.port);
      setExposeSkillsMcp(payload.settings.exposeSkillsMcp);
      setVerifyAfterApply(payload.settings.verifyAfterApply);
    } catch (err) {
      onNotice('err', err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    setBusy(true);
    try {
      const updated = await api.updateSettings({
        bindMode,
        port,
        exposeSkillsMcp,
        verifyAfterApply,
        ...(passcode.trim().length >= 4 ? { passcode: passcode.trim() } : {}),
      });
      setData(updated);
      setPasscode('');
      onNotice(
        'ok',
        updated.runtime.restartRequired
          ? 'Settings saved. Restart the background service to apply the new network binding/port.'
          : 'Settings saved.'
      );
    } catch (err) {
      onNotice('err', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div
        className={`w-full max-w-2xl rounded-2xl border shadow-2xl ${
          dark ? 'border-zinc-800 bg-zinc-950 text-zinc-100' : 'border-zinc-200 bg-white text-zinc-900'
        }`}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${borderClass}`}>
          <div>
            <h2 className="text-base font-semibold">Settings & Background Service</h2>
            <p className={`text-xs ${mutedText}`}>
              Network safety defaults, auto-start daemon, and desktop app installation.
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

        {!data ? (
          <div className={`p-8 text-center text-xs ${mutedText}`}>Loading settings...</div>
        ) : (
          <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5 text-xs">
            {/* Network & Security */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldCheck className={`h-4 w-4 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                Network Access & Security
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setBindMode('local')}
                  className={`rounded-xl border p-3 text-left transition ${
                    bindMode === 'local'
                      ? dark
                        ? 'border-indigo-500 bg-indigo-500/15'
                        : 'border-indigo-400 bg-indigo-50'
                      : dark
                        ? 'border-zinc-800 bg-zinc-900/50'
                        : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Laptop className="h-3.5 w-3.5" /> Local Only (127.0.0.1)
                  </div>
                  <p className={`mt-1 text-[11px] ${mutedText}`}>
                    Recommended default. Only accessible from this machine.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setBindMode('lan')}
                  className={`rounded-xl border p-3 text-left transition ${
                    bindMode === 'lan'
                      ? dark
                        ? 'border-indigo-500 bg-indigo-500/15'
                        : 'border-indigo-400 bg-indigo-50'
                      : dark
                        ? 'border-zinc-800 bg-zinc-900/50'
                        : 'border-zinc-200 bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Globe className="h-3.5 w-3.5" /> LAN & Tailscale (0.0.0.0)
                  </div>
                  <p className={`mt-1 text-[11px] ${mutedText}`}>
                    Operate headless server from your laptop or phone browser.
                  </p>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={`block font-medium ${mutedText}`}>Port</label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className={`mt-1 w-full rounded-lg border px-3 py-1.5 ${inputClass}`}
                  />
                </div>
                <div>
                  <label className={`block font-medium ${mutedText}`}>
                    {data.settings.hasPasscode
                      ? 'Change Web Passcode (currently protected)'
                      : 'Optional Remote Web Passcode (min 4 chars)'}
                  </label>
                  <div className="mt-1 flex gap-1.5">
                    <input
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      placeholder={data.settings.hasPasscode ? '••••••' : 'Leave empty for none'}
                      className={`w-full rounded-lg border px-3 py-1.5 ${inputClass}`}
                    />
                    {data.settings.hasPasscode && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const updated = await api.updateSettings({ clearPasscode: true });
                            setData(updated);
                            onNotice('ok', 'Passcode removed.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] ${
                          dark ? 'border-zinc-700 text-rose-300' : 'border-zinc-300 text-rose-700'
                        }`}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div
                className={`rounded-xl border p-3 text-[11px] ${
                  dark ? 'border-zinc-800 bg-zinc-900/40' : 'border-zinc-200 bg-zinc-50'
                }`}
              >
                <div className="font-semibold">
                  Listening Now: <code>{data.runtime.listeningHost}:{data.runtime.listeningPort}</code>
                </div>
                <div className={`mt-1 space-y-0.5 font-mono ${mutedText}`}>
                  <div>Local: {data.runtime.localUrl}</div>
                  {data.runtime.lanUrls.map((u) => (
                    <div key={u}>LAN: {u}</div>
                  ))}
                  {data.runtime.tailscaleUrls.map((u) => (
                    <div key={u}>Tailscale: {u}</div>
                  ))}
                </div>
              </div>
            </div>

            {/* Background Service */}
            <div className={`space-y-2.5 border-t pt-4 ${borderClass}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Server className={`h-4 w-4 ${dark ? 'text-emerald-400' : 'text-emerald-600'}`} />
                  Background Auto-Start Service ({data.runtime.serviceStatus.platform})
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    data.runtime.serviceStatus.running
                      ? dark
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-emerald-100 text-emerald-800'
                      : data.runtime.serviceStatus.installed
                        ? dark
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-amber-100 text-amber-800'
                        : dark
                          ? 'bg-zinc-800 text-zinc-400'
                          : 'bg-zinc-200 text-zinc-700'
                  }`}
                >
                  {data.runtime.serviceStatus.running
                    ? 'Running (Auto-Start)'
                    : data.runtime.serviceStatus.installed
                      ? 'Installed (Stopped)'
                      : 'Not Installed'}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const updated = await api.installService();
                      setData(updated);
                      onNotice('ok', `Background service installed (${updated.runtime.serviceStatus.label})`);
                    } catch (err) {
                      onNotice('err', err instanceof Error ? err.message : String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Power className="h-3.5 w-3.5" />
                  {data.runtime.serviceStatus.installed
                    ? 'Update Auto-Start Service'
                    : 'Install Auto-Start Service'}
                </button>

                {data.runtime.serviceStatus.installed && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const updated = await api.restartService();
                          setData(updated);
                          onNotice('ok', 'Service restarted.');
                        } catch (err) {
                          onNotice('err', err instanceof Error ? err.message : String(err));
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        dark ? 'border-zinc-700 text-zinc-200' : 'border-zinc-300 text-zinc-800'
                      }`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Restart Service
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const updated = await api.uninstallService();
                          setData(updated);
                          onNotice('ok', 'Background service uninstalled.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        dark ? 'border-zinc-800 text-rose-400' : 'border-zinc-300 text-rose-700'
                      }`}
                    >
                      Uninstall
                    </button>
                  </>
                )}
              </div>
              <p className={`font-mono text-[10px] ${mutedText}`}>
                CLI alternative: <code>harness-hub setup</code> or <code>harness-hub service install</code>
              </p>
            </div>

            {/* Desktop App (PWA) */}
            <div className={`space-y-2 border-t pt-4 ${borderClass}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Download className={`h-4 w-4 ${dark ? 'text-indigo-400' : 'text-indigo-600'}`} />
                  Install as Desktop App (PWA)
                </div>
                {canInstallPwa && (
                  <button
                    type="button"
                    onClick={onInstallPwa}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                  >
                    Install HarnessHub App
                  </button>
                )}
              </div>
              {typeof window !== 'undefined' && !window.isSecureContext && (
                <div
                  className={`rounded-lg border px-3 py-2 text-[11px] ${
                    dark
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-amber-300 bg-amber-50 text-amber-900'
                  }`}
                >
                  You are viewing over plain HTTP ({window.location.origin}). Chrome requires HTTPS
                  (e.g. <code>tailscale serve --bg --https=9446 http://127.0.0.1:{data.runtime.listeningPort}</code>) or{' '}
                  <code>http://127.0.0.1</code> for the 1-click Install button.
                </div>
              )}
              <p className={`text-[11px] ${mutedText}`}>
                Launch HarnessHub from your Dock or Spotlight without typing ports:
                open via HTTPS / <code>127.0.0.1</code> and click <strong>Install App</strong> (or Chrome menu{' '}
                <strong>⋮ → Cast, save, and share → Install page as app</strong>).
              </p>
            </div>

            {/* Gateway & Sync Behavior */}
            <div className={`space-y-2 border-t pt-4 ${borderClass}`}>
              <div className="font-semibold">Gateway & Verification Defaults</div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={exposeSkillsMcp}
                  onChange={(e) => setExposeSkillsMcp(e.target.checked)}
                />
                <span>Expose on-demand skill search (`search_skills`, `read_skill`) via Hub Gateway</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={verifyAfterApply}
                  onChange={(e) => setVerifyAfterApply(e.target.checked)}
                />
                <span>Automatically run Verify Live after clicking Apply Changes</span>
              </label>
            </div>
          </div>
        )}

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
          <button
            type="button"
            disabled={busy || !data}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export const PasscodeLockScreen: React.FC<{
  dark: boolean;
  onUnlocked: () => void;
}> = ({ dark, onUnlocked }) => {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.login(passcode);
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-4 ${
        dark ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-100 text-zinc-900'
      }`}
    >
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-sm rounded-2xl border p-6 shadow-xl ${
          dark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'
        }`}
      >
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-indigo-500" />
          <h1 className="text-base font-bold">Unlock HarnessHub</h1>
        </div>
        <p className={`mb-4 text-xs ${dark ? 'text-zinc-400' : 'text-zinc-600'}`}>
          Enter your remote access passcode to manage host harnesses and MCP servers.
        </p>
        {error && (
          <div className="mb-3 rounded-lg bg-rose-500/15 px-3 py-2 text-xs text-rose-400">
            {error}
          </div>
        )}
        <input
          type="password"
          required
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Access passcode"
          className={`mb-4 w-full rounded-xl border px-3 py-2 text-sm outline-none ${
            dark
              ? 'border-zinc-700 bg-zinc-950 text-zinc-100 focus:border-indigo-500'
              : 'border-zinc-300 bg-zinc-50 text-zinc-900 focus:border-indigo-500'
          }`}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Checking...' : 'Unlock'}
        </button>
      </form>
    </div>
  );
};
