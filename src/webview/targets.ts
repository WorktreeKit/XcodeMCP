import { fetch } from 'undici';
import Logger from '../utils/Logger.js';
import { getDeviceListUrl, getTabsUrl } from './iwdp.js';
import type { DiscoveredTarget, InspectorDevice, InspectorPage } from './types.js';

interface RawDeviceEntry {
  deviceId?: string;
  deviceName?: string;
  name?: string;
  osVersion?: string;
  version?: string;
  url?: string;
}

interface RawPageEntry {
  id?: string;
  title?: string;
  url?: string;
  type?: string;
  webSocketDebuggerUrl?: string;
  devtoolsFrontendUrl?: string;
  frontendUrl?: string;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${message}`);
  }
}

function normalizePage(entry: RawPageEntry): InspectorPage | null {
  const id = entry.id ?? '';
  const url = entry.url ?? '';
  const wsUrl = entry.webSocketDebuggerUrl ?? '';

  if (!id && !url && !wsUrl) {
    return null;
  }

  const page: InspectorPage = {
    id: id || url || wsUrl,
    title: entry.title ?? '(no title)',
    url,
    type: entry.type ?? 'unknown',
    wsUrl,
  };

  const frontend = entry.devtoolsFrontendUrl ?? entry.frontendUrl;
  if (frontend) {
    page.devtoolsFrontendUrl = frontend;
  }

  return page;
}

async function fetchPages(tabsUrl: string): Promise<InspectorPage[]> {
  try {
    const pageJson = await fetchJson(tabsUrl);
    const entries: RawPageEntry[] = Array.isArray(pageJson) ? pageJson : [pageJson];
    return entries
      .map(normalizePage)
      .filter((page): page is InspectorPage => Boolean(page));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.debug(`Failed to fetch IWDP tabs from ${tabsUrl}: ${message}`);
    return [];
  }
}

function buildDeviceEntry(
  tabsUrl: string,
  basePort: number,
  override?: DiscoveredTarget,
  deviceMeta?: RawDeviceEntry,
): InspectorDevice {
  const deviceName = override?.name ?? deviceMeta?.deviceName ?? deviceMeta?.name;
  const device: InspectorDevice = {
    basePort,
    tabsUrl,
    pages: [],
  };

  if (override?.udid) {
    device.udid = override.udid;
  }
  if (deviceMeta?.deviceId) {
    device.deviceId = deviceMeta.deviceId;
  }
  if (deviceName) {
    device.name = deviceName;
  }
  const osVersion = override?.osVersion ?? deviceMeta?.osVersion ?? deviceMeta?.version;
  if (osVersion) {
    device.osVersion = osVersion;
  }

  return device;
}

export async function listInspectorTargets(
  basePort: number,
  targetInfo?: DiscoveredTarget,
): Promise<InspectorDevice[]> {
  const deviceListUrl = getDeviceListUrl(basePort);
  const tabsUrl = getTabsUrl(basePort);

  try {
    const deviceList = await fetchJson(deviceListUrl);

    if (Array.isArray(deviceList) && deviceList.length) {
      const devices: InspectorDevice[] = [];

      for (const entry of deviceList as RawDeviceEntry[]) {
        if (!entry.url) continue;
        const normalized = buildDeviceEntry(entry.url, basePort, targetInfo, entry);
        normalized.pages = await fetchPages(entry.url);
        devices.push(normalized);
      }

      if (devices.length) {
        return devices;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.debug(`Device list fetch from ${deviceListUrl} failed: ${message}`);
  }

  // Fallback: direct tabs URL
  const fallbackDevice = buildDeviceEntry(tabsUrl, basePort, targetInfo, {});
  fallbackDevice.pages = await fetchPages(tabsUrl);
  return [fallbackDevice];
}

export function findMatchingPage(
  devices: InspectorDevice[],
  predicate: (page: InspectorPage) => boolean,
): { device: InspectorDevice; page: InspectorPage } | null {
  for (const device of devices) {
    for (const page of device.pages) {
      if (predicate(page)) {
        return { device, page };
      }
    }
  }
  return null;
}
