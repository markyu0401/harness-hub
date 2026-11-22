#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  getServiceStatus,
  hashPasscode,
  installBackgroundService,
  listHostIpv4Addresses,
  loadSettings,
  resolveBindHost,
  resolveHostPaths,
  restartBackgroundService,
  saveSettings,
  uninstallBackgroundService,
} from '@harness-hub/core';
import { createHarnessHubApp } from './app.js';

function parseFlags(argv: string[]) {
  let host: string | undefined;
  let port: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) {
      host = argv[++i]!;
    } else if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[++i]!);
    }
  }
  return { host, port };
}

async function runServe(argv: string[]) {
  const flags = parseFlags(argv);
  const paths = resolveHostPaths({
    homeDir: process.env.HARNESS_HUB_HOME,
    hubDir: process.env.HARNESS_HUB_DIR,
  });
  const settings = await loadSettings(paths.hubDir);
  const host = flags.host ?? process.env.HARNESS_HUB_HOST ?? resolveBindHost(settings.bindMode);
  const port = flags.port ?? (process.env.HARNESS_HUB_PORT ? Number(process.env.HARNESS_HUB_PORT) : settings.port);

  const { app } = await createHarnessHubApp({
    homeDir: paths.homeDir,
    hubDir: paths.hubDir,
    host,
    port,
  });

  await app.listen({ host, port });
  console.log(`HarnessHub server listening at http://${host}:${port}`);
  console.log(`  - Local Web UI: http://127.0.0.1:${port}/`);
  if (host === '0.0.0.0') {
    const { lanIps, tailscaleIps } = listHostIpv4Addresses();
    for (const ip of [...lanIps, ...tailscaleIps]) {
      console.log(`  - Remote Web UI: http://${ip}:${port}/`);
    }
  }
  console.log(`  - MCP Gateway:  http://127.0.0.1:${port}/mcp/{codex,opencode,antigravity,hermes}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runSetupWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const paths = resolveHostPaths({
    homeDir: process.env.HARNESS_HUB_HOME,
    hubDir: process.env.HARNESS_HUB_DIR,
  });
  const current = await loadSettings(paths.hubDir);

  try {
    console.log('\n=== HarnessHub Interactive Setup ===\n');
    const modeAns = await rl.question(
      '1) Who should be able to open the Web UI?\n   [1] Local machine only (127.0.0.1 - recommended default)\n   [2] LAN / Tailscale remote browser (0.0.0.0)\n   Choice (1/2) [1]: '
    );
    const bindMode: 'local' | 'lan' = modeAns.trim() === '2' ? 'lan' : 'local';

    const portAns = await rl.question(`2) Port [${current.port}]: `);
    const portNum = portAns.trim() ? Number(portAns.trim()) : current.port;
    const port = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535 ? portNum : 4310;

    let accessPasscodeHash = current.accessPasscodeHash;
    if (bindMode === 'lan') {
      const passAns = await rl.question(
        '3) Optional access passcode for remote browser (leave blank for none): '
      );
      if (passAns.trim().length >= 4) {
        accessPasscodeHash = hashPasscode(passAns.trim());
      }
    }

    await saveSettings(paths.hubDir, {
      ...current,
      bindMode,
      port,
      accessPasscodeHash,
    });

    const svcAns = await rl.question(
      '4) Install background auto-start service (launchd / systemd)? (Y/n): '
    );
    const host = resolveBindHost(bindMode);
    if (svcAns.trim().toLowerCase() !== 'n') {
      const cliScript = fileURLToPath(import.meta.url);
      const status = await installBackgroundService({
        homeDir: paths.homeDir,
        hubDir: paths.hubDir,
        cliScript,
        host,
        port,
      });
      console.log(`\nBackground service installed (${status.label})!`);
      console.log(`Logs: ${status.logPath}`);
    }

    console.log(`\nOpen HarnessHub at: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/`);
    if (host === '0.0.0.0') {
      const { lanIps, tailscaleIps } = listHostIpv4Addresses();
      for (const ip of [...lanIps, ...tailscaleIps]) {
        console.log(`Remote URL:         http://${ip}:${port}/`);
      }
    }
  } finally {
    rl.close();
  }
}

async function runServiceCommand(subcommand: string | undefined, restArgs: string[]) {
  const flags = parseFlags(restArgs);
  const paths = resolveHostPaths({
    homeDir: process.env.HARNESS_HUB_HOME,
    hubDir: process.env.HARNESS_HUB_DIR,
  });
  const settings = await loadSettings(paths.hubDir);
  const cliScript = fileURLToPath(import.meta.url);

  if (subcommand === 'install') {
    const host = flags.host ?? resolveBindHost(settings.bindMode);
    const port = flags.port ?? settings.port;
    const bindMode = host === '0.0.0.0' ? 'lan' : 'local';
    await saveSettings(paths.hubDir, { ...settings, bindMode, port });
    const status = await installBackgroundService({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
      cliScript,
      host,
      port,
    });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (subcommand === 'uninstall') {
    const status = await uninstallBackgroundService({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
    });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (subcommand === 'restart') {
    const status = await restartBackgroundService({
      homeDir: paths.homeDir,
      hubDir: paths.hubDir,
    });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  const status = await getServiceStatus({
    homeDir: paths.homeDir,
    hubDir: paths.hubDir,
  });
  console.log(JSON.stringify(status, null, 2));
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const cmd = args[0];

  if (cmd === 'setup') {
    await runSetupWizard();
    return;
  }
  if (cmd === 'service') {
    await runServiceCommand(args[1], args.slice(2));
    return;
  }
  if (cmd === 'serve') {
    await runServe(args.slice(1));
    return;
  }

  await runServe(args);
}

main().catch((err) => {
  console.error('Failed to run HarnessHub CLI:', err);
  process.exit(1);
});
