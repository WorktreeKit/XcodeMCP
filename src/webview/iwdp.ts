import os from 'os';
import path from 'path';
import { mkdir, readFile, rm, writeFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { execa } from 'execa';
import treeKill from 'tree-kill';
import getPort, { portNumbers } from 'get-port';
import net from 'net';
import { fetch } from 'undici';
import Logger from '../utils/Logger.js';
import type {
  ProxyState,
  StartProxyOptions,
  StartProxyResult,
  StopProxyResult,
} from './types.js';

const STATE_DIR = path.join(os.homedir(), '.xcodemcp', 'iwdp');
const DEFAULT_BASE_PORT = 9222;
const FALLBACK_BASE_PORT_RANGE = portNumbers(27753, 27853);

let cachedBinaryPath: string | null = null;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function getStateFilePath(udid: string): string {
  return path.join(STATE_DIR, `${udid}.json`);
}

export function getDeviceListUrl(basePort: number): string {
  return `http://127.0.0.1:${basePort - 1}/json`;
}

export function getTabsUrl(basePort: number): string {
  return `http://127.0.0.1:${basePort}/json`;
}

async function ensureStateDir(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
}

async function readState(udid: string): Promise<ProxyState | null> {
  try {
    const contents = await readFile(getStateFilePath(udid), 'utf8');
    const parsed = JSON.parse(contents) as ProxyState;
    return parsed;
  } catch (error) {
    return null;
  }
}

async function writeState(udid: string, state: ProxyState): Promise<void> {
  await ensureStateDir();
  await writeFile(getStateFilePath(udid), JSON.stringify(state, null, 2), 'utf8');
}

async function cleanupState(udid: string): Promise<void> {
  try {
    await rm(getStateFilePath(udid), { force: true });
  } catch (error) {
    Logger.debug(`Failed to remove IWDP state for ${udid}`, error);
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getExistingProxyState(udid: string): Promise<ProxyState | null> {
  const state = await readState(udid);
  if (!state) {
    return null;
  }

  if (!isPidRunning(state.pid)) {
    await cleanupState(udid);
    return null;
  }

  return state;
}

async function findIwdpBinary(): Promise<string> {
  if (cachedBinaryPath) {
    return cachedBinaryPath;
  }

  try {
    const { stdout } = await execa('which', ['ios_webkit_debug_proxy']);
    cachedBinaryPath = stdout.trim();
    return cachedBinaryPath;
  } catch (error) {
    const guidance = [
      'ios_webkit_debug_proxy is not installed or not available in PATH.',
      '',
      'Install via Homebrew:',
      '  brew install ios-webkit-debug-proxy',
      '',
      'Or download from: https://github.com/google/ios-webkit-debug-proxy',
    ].join('\n');
    throw new Error(guidance);
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickBasePort(requestedPort?: number): Promise<number> {
  if (requestedPort) {
    const available = await isPortAvailable(requestedPort);
    const deviceListAvailable = await isPortAvailable(requestedPort - 1);
    if (!available || !deviceListAvailable) {
      throw new Error(`Requested port ${requestedPort} (and ${requestedPort - 1}) is not available. Choose another --port value.`);
    }
    return requestedPort;
  }

  const defaultAvailable = await isPortAvailable(DEFAULT_BASE_PORT);
  const defaultDeviceList = await isPortAvailable(DEFAULT_BASE_PORT - 1);
  if (defaultAvailable && defaultDeviceList) {
    return DEFAULT_BASE_PORT;
  }

  const fallbackPort = await getPort({ port: FALLBACK_BASE_PORT_RANGE });
  const fallbackDeviceList = await isPortAvailable(fallbackPort - 1);
  if (!fallbackDeviceList) {
    // Attempt to find another port pair in the fallback range
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const candidate = await getPort({ port: FALLBACK_BASE_PORT_RANGE });
      if (candidate === fallbackPort) {
        continue;
      }
      const deviceListFree = await isPortAvailable(candidate - 1);
      if (deviceListFree) {
        return candidate;
      }
    }
    throw new Error('Unable to find a suitable port pair for ios_webkit_debug_proxy.');
  }

  return fallbackPort;
}

async function waitForProxy(basePort: number, retries = 10): Promise<void> {
  const deviceListUrl = getDeviceListUrl(basePort);
  const tabsUrl = getTabsUrl(basePort);

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(deviceListUrl, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // ignore, try tabs endpoint next
    }

    try {
      const res = await fetch(tabsUrl, { method: 'GET' });
      if (res.ok) return;
    } catch {
      // ignore
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for ios_webkit_debug_proxy to listen on ports ${basePort - 1}/${basePort}`);
}

/**
 * Start ios_webkit_debug_proxy for a specific UDID and base port.
 */
export async function startProxy(options: StartProxyOptions): Promise<StartProxyResult> {
  const { udid, basePort: requestedPort, foreground = false, autoSelectPort = true } = options;
  if (!udid) {
    throw new Error('A device or simulator UDID is required.');
  }

  const existing = await getExistingProxyState(udid);
  if (existing) {
    Logger.info(`Reusing existing IWDP proxy for ${udid} on port ${existing.basePort}`);
    return {
      pid: existing.pid,
      basePort: existing.basePort,
      deviceListUrl: getDeviceListUrl(existing.basePort),
      tabsUrl: getTabsUrl(existing.basePort),
    };
  }

  const basePort = await pickBasePort(autoSelectPort ? requestedPort : requestedPort ?? DEFAULT_BASE_PORT);
  const binary = await findIwdpBinary();
  const deviceListPort = basePort - 1;
  const configEntries: string[] = [];
  if (deviceListPort > 0) {
    configEntries.push(`null:${deviceListPort}`);
  }
  configEntries.push(`${udid}:${basePort}`);
  const args = ['-c', configEntries.join(','), '--no-frontend'];

  Logger.info(`Starting ios_webkit_debug_proxy for ${udid} on port ${basePort}`);

  try {
    if (foreground) {
      const child = execa(binary, args, { stdio: 'inherit' });
      const pid = child.pid;
      if (!pid) {
        throw new Error('Failed to spawn ios_webkit_debug_proxy (no PID assigned)');
      }

      await writeState(udid, {
        pid,
        basePort,
        foreground: true,
        startedAt: Date.now(),
      });

      await waitForProxy(basePort);

      child.once('exit', () => {
        cleanupState(udid).catch(() => {});
      });
      child.once('error', () => {
        cleanupState(udid).catch(() => {});
      });
      child.catch(error => {
        Logger.error('ios_webkit_debug_proxy exited unexpectedly (foreground)', error);
      });

      return {
        pid,
        basePort,
        deviceListUrl: getDeviceListUrl(basePort),
        tabsUrl: getTabsUrl(basePort),
        process: child,
      };
    }

    const child = execa(binary, args, {
      stdio: 'ignore',
      detached: true,
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error('Failed to spawn ios_webkit_debug_proxy');
    }

    child.once('exit', () => {
      cleanupState(udid).catch(() => {});
    });
    child.once('error', () => {
      cleanupState(udid).catch(() => {});
    });
    child.catch(error => {
      Logger.error('ios_webkit_debug_proxy exited unexpectedly', error);
    });

    child.unref();

    await writeState(udid, {
      pid,
      basePort,
      foreground: false,
      startedAt: Date.now(),
    });

    await waitForProxy(basePort);

    return {
      pid,
      basePort,
      deviceListUrl: getDeviceListUrl(basePort),
      tabsUrl: getTabsUrl(basePort),
    };
  } catch (error) {
    await cleanupState(udid);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start ios_webkit_debug_proxy: ${message}`);
  }
}

/**
 * Stop ios_webkit_debug_proxy for the provided UDID.
 */
export async function stopProxy(udid: string): Promise<StopProxyResult> {
  if (!udid) {
    throw new Error('UDID is required to stop ios_webkit_debug_proxy.');
  }

  const state = await readState(udid);
  if (!state) {
    return { stopped: false, message: `No IWDP proxy state found for ${udid}` };
  }

  if (!isPidRunning(state.pid)) {
    await cleanupState(udid);
    return { stopped: false, message: `IWDP process for ${udid} is not running.` };
  }

  await new Promise<void>((resolve, reject) => {
    treeKill(state.pid, 'SIGTERM', (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  await cleanupState(udid);

  return { stopped: true, message: `Stopped IWDP proxy for ${udid}` };
}

/**
 * Determine if ios_webkit_debug_proxy is installed.
 */
export async function isIwdpAvailable(): Promise<boolean> {
  try {
    const binary = await findIwdpBinary();
    await access(binary, fsConstants.X_OK);
    return true;
  } catch (error) {
    Logger.debug('ios_webkit_debug_proxy availability check failed', error);
    return false;
  }
}
