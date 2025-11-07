import { execa } from 'execa';
import Logger from '../utils/Logger.js';
import type { DiscoveredTarget, TargetKind } from './types.js';

interface RawIdbTarget {
  udid: string;
  name: string;
  type?: string;
  state?: string;
  os_version?: string;
  device_name?: string;
  device_type?: string;
}

interface RawSimctlDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable?: boolean;
}

interface RawSimctlResponse {
  devices?: Record<string, RawSimctlDevice[]>;
}

function getKindFromIdb(type?: string): TargetKind {
  if (!type) return 'unknown';
  if (type.toLowerCase().includes('sim')) return 'simulator';
  if (type.toLowerCase().includes('device')) return 'device';
  return 'unknown';
}

function normalizeRuntimeLabel(runtimeKey: string): string | undefined {
  const match = runtimeKey.match(/SimRuntime\.([A-Za-z]+)-(\d+-\d+)/);
  if (!match) return undefined;

  const platformGroup = match[1];
  const versionGroup = match[2];

  if (!platformGroup || !versionGroup) return undefined;

  const platform = platformGroup
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/ios/i, 'iOS')
    .replace(/ipados/i, 'iPadOS')
    .replace(/tvos/i, 'tvOS')
    .replace(/watchos/i, 'watchOS');

  const version = versionGroup.replace(/-/g, '.');
  return `${platform} ${version}`;
}

function normalizeIdbTarget(target: RawIdbTarget): DiscoveredTarget {
  const normalized: DiscoveredTarget = {
    udid: target.udid,
    name: target.device_name ?? target.name ?? 'Unknown device',
    kind: getKindFromIdb(target.type),
  };

  if (target.state) {
    normalized.state = target.state;
  }
  if (target.os_version) {
    normalized.osVersion = target.os_version;
  }

  return normalized;
}

function normalizeSimctlDevice(device: RawSimctlDevice, runtimeKey: string): DiscoveredTarget {
  const label = normalizeRuntimeLabel(runtimeKey);
  const normalized: DiscoveredTarget = {
    udid: device.udid,
    name: device.name,
    kind: 'simulator',
  };

  normalized.state = device.state;
  if (label) {
    normalized.runtime = label;
    normalized.osVersion = label;
  }

  return normalized;
}

async function listTargetsViaIdb(): Promise<DiscoveredTarget[]> {
  try {
    const { stdout } = await execa('idb', ['list-targets', '--json'], { timeout: 5000 });
    const parsed = JSON.parse(stdout);
    const targets: RawIdbTarget[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.targets)
        ? parsed.targets
        : Array.isArray(parsed?.data)
          ? parsed.data
          : [];

    return targets.map(normalizeIdbTarget);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.debug(`idb list-targets failed: ${message}`);
    return [];
  }
}

async function listTargetsViaSimctl(): Promise<DiscoveredTarget[]> {
  try {
    const { stdout } = await execa('xcrun', ['simctl', 'list', 'devices', '--json'], { timeout: 5000 });
    const parsed = JSON.parse(stdout) as RawSimctlResponse;
    const devices: DiscoveredTarget[] = [];

    for (const [runtimeKey, runtimeDevices] of Object.entries(parsed.devices ?? {})) {
      for (const device of runtimeDevices) {
        if (device.state !== 'Booted') continue;
        if (device.isAvailable === false) continue;
        devices.push(normalizeSimctlDevice(device, runtimeKey));
      }
    }

    return devices;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.debug(`simctl list devices failed: ${message}`);
    return [];
  }
}

export async function listInspectableTargets(): Promise<DiscoveredTarget[]> {
  const fromIdb = await listTargetsViaIdb();
  const fromSimctl = await listTargetsViaSimctl();

  const merged = new Map<string, DiscoveredTarget>();
  for (const target of [...fromIdb, ...fromSimctl]) {
    merged.set(target.udid, target);
  }

  return [...merged.values()].filter(target => target.state === 'Booted');
}

export async function resolveTarget(preferredUdid?: string): Promise<DiscoveredTarget> {
  const targets = await listInspectableTargets();

  if (preferredUdid) {
    const match = targets.find(target => target.udid === preferredUdid);
    if (!match) {
      throw new Error(`Target ${preferredUdid} is not booted. Boot the device or simulator before running IWDP.`);
    }
    return match;
  }

  if (!targets.length) {
    throw new Error('No booted simulator or device detected. Start a simulator or connect a device, then try again.');
  }

  const simulator = targets.find(target => target.kind === 'simulator');
  if (simulator) {
    return simulator;
  }

  return targets[0]!;
}
