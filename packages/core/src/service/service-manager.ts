import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LAUNCHD_LABEL = 'dev.harness-hub.server';
export const SYSTEMD_SERVICE_NAME = 'harness-hub.service';

export interface ServiceStatusInfo {
  supported: boolean;
  platform: string;
  installed: boolean;
  running: boolean;
  unitPath: string;
  logPath: string;
  label: string;
}

export interface ServiceInstallOptions {
  homeDir?: string;
  hubDir?: string;
  platform?: NodeJS.Platform;
  nodeBin?: string;
  cliScript: string;
  host: string;
  port: number;
  skipDaemonControl?: boolean;
}

function escapeXml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function getServicePaths(options?: {
  homeDir?: string;
  hubDir?: string;
  platform?: NodeJS.Platform;
}) {
  const homeDir = path.resolve(options?.homeDir ?? os.homedir());
  const hubDir = path.resolve(options?.hubDir ?? path.join(homeDir, '.harness-hub'));
  const platform = options?.platform ?? process.platform;
  const logPath = path.join(hubDir, 'logs', 'server.log');
  const unitPath =
    platform === 'darwin'
      ? path.join(homeDir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
      : path.join(homeDir, '.config', 'systemd', 'user', SYSTEMD_SERVICE_NAME);

  return { homeDir, hubDir, platform, logPath, unitPath };
}

export function renderLaunchdPlist(options: {
  nodeBin: string;
  cliScript: string;
  host: string;
  port: number;
  homeDir: string;
  hubDir: string;
  logPath: string;
}): string {
  const pathEnv = process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(LAUNCHD_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.nodeBin)}</string>
    <string>${escapeXml(options.cliScript)}</string>
    <string>serve</string>
    <string>--host</string>
    <string>${escapeXml(options.host)}</string>
    <string>--port</string>
    <string>${options.port}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(options.homeDir)}</string>
    <key>HARNESS_HUB_HOME</key>
    <string>${escapeXml(options.homeDir)}</string>
    <key>HARNESS_HUB_DIR</key>
    <string>${escapeXml(options.hubDir)}</string>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.logPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdUnit(options: {
  nodeBin: string;
  cliScript: string;
  host: string;
  port: number;
  homeDir: string;
  hubDir: string;
}): string {
  return `[Unit]
Description=HarnessHub Multi-Agent Skill & MCP Control Plane
After=network-online.target

[Service]
Type=simple
ExecStart=${options.nodeBin} ${options.cliScript} serve --host ${options.host} --port ${options.port}
Environment=HOME=${options.homeDir}
Environment=HARNESS_HUB_HOME=${options.homeDir}
Environment=HARNESS_HUB_DIR=${options.hubDir}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}

export async function getServiceStatus(options?: {
  homeDir?: string;
  hubDir?: string;
  platform?: NodeJS.Platform;
  skipDaemonControl?: boolean;
}): Promise<ServiceStatusInfo> {
  const { platform, unitPath, logPath } = getServicePaths(options);
  const supported = platform === 'darwin' || platform === 'linux';
  let installed = false;
  try {
    await fs.access(unitPath);
    installed = true;
  } catch {
    installed = false;
  }

  let running = false;
  if (installed && !options?.skipDaemonControl) {
    try {
      if (platform === 'darwin') {
        const uid = process.getuid ? process.getuid() : 501;
        const { stdout } = await execFileAsync('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`], {
          timeout: 4000,
        });
        running = stdout.includes('state = running');
      } else if (platform === 'linux') {
        const { stdout } = await execFileAsync(
          'systemctl',
          ['--user', 'is-active', SYSTEMD_SERVICE_NAME],
          { timeout: 4000 }
        );
        running = stdout.trim() === 'active';
      }
    } catch {
      running = false;
    }
  }

  return {
    supported,
    platform,
    installed,
    running,
    unitPath,
    logPath,
    label: platform === 'darwin' ? LAUNCHD_LABEL : SYSTEMD_SERVICE_NAME,
  };
}

export async function installBackgroundService(
  options: ServiceInstallOptions
): Promise<ServiceStatusInfo> {
  const { homeDir, hubDir, platform, unitPath, logPath } = getServicePaths(options);
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new Error(`Background service installer is not supported on platform '${platform}'.`);
  }

  const nodeBin = options.nodeBin ?? process.execPath;
  await fs.mkdir(path.dirname(unitPath), { recursive: true });
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const content =
    platform === 'darwin'
      ? renderLaunchdPlist({
          nodeBin,
          cliScript: options.cliScript,
          host: options.host,
          port: options.port,
          homeDir,
          hubDir,
          logPath,
        })
      : renderSystemdUnit({
          nodeBin,
          cliScript: options.cliScript,
          host: options.host,
          port: options.port,
          homeDir,
          hubDir,
        });

  await fs.writeFile(unitPath, content, 'utf8');

  if (!options.skipDaemonControl) {
    if (platform === 'darwin') {
      const uid = process.getuid ? process.getuid() : 501;
      await execFileAsync('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`]).catch(() => {});
      await execFileAsync('launchctl', ['bootstrap', `gui/${uid}`, unitPath]);
    } else {
      await execFileAsync('systemctl', ['--user', 'daemon-reload']);
      await execFileAsync('systemctl', ['--user', 'enable', '--now', SYSTEMD_SERVICE_NAME]);
    }
  }

  return getServiceStatus({
    homeDir,
    hubDir,
    platform,
    skipDaemonControl: options.skipDaemonControl,
  });
}

export async function uninstallBackgroundService(options?: {
  homeDir?: string;
  hubDir?: string;
  platform?: NodeJS.Platform;
  skipDaemonControl?: boolean;
}): Promise<ServiceStatusInfo> {
  const { homeDir, hubDir, platform, unitPath } = getServicePaths(options);
  if (!options?.skipDaemonControl) {
    if (platform === 'darwin') {
      const uid = process.getuid ? process.getuid() : 501;
      await execFileAsync('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`]).catch(() => {});
    } else if (platform === 'linux') {
      await execFileAsync('systemctl', ['--user', 'disable', '--now', SYSTEMD_SERVICE_NAME]).catch(
        () => {}
      );
    }
  }

  await fs.unlink(unitPath).catch(() => {});
  return getServiceStatus({
    homeDir,
    hubDir,
    platform,
    skipDaemonControl: options?.skipDaemonControl,
  });
}

export async function restartBackgroundService(options?: {
  homeDir?: string;
  hubDir?: string;
  platform?: NodeJS.Platform;
}): Promise<ServiceStatusInfo> {
  const { homeDir, hubDir, platform, unitPath } = getServicePaths(options);
  if (platform === 'darwin') {
    const uid = process.getuid ? process.getuid() : 501;
    await execFileAsync('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCHD_LABEL}`]).catch(
      async () => {
        await execFileAsync('launchctl', ['bootstrap', `gui/${uid}`, unitPath]);
      }
    );
  } else if (platform === 'linux') {
    await execFileAsync('systemctl', ['--user', 'restart', SYSTEMD_SERVICE_NAME]);
  }
  return getServiceStatus({ homeDir, hubDir, platform });
}
