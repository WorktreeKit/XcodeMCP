import { execa } from 'execa';
import {
  getExistingProxyState,
  startProxy,
  stopProxy,
  getDeviceListUrl,
  getTabsUrl,
} from './iwdp.js';
import { resolveTarget, listInspectableTargets } from './discovery.js';
import { listInspectorTargets, findMatchingPage } from './targets.js';
import WebKitWsClient from './wsClient.js';
import type {
  DiscoveredTarget,
  EvaluateResult,
  InspectorDevice,
  InspectorPage,
  StartProxyOptions,
  StartProxyResult,
  StopProxyResult,
} from './types.js';

export interface EnsureProxyOptions {
  udid?: string;
  basePort?: number;
  autoStart?: boolean;
}

export interface EvaluatedPage {
  device: InspectorDevice;
  result: EvaluateResult;
}

const EMPTY_STATE_TIPS = [
  'Enable Settings → Safari → Advanced → Web Inspector on the device or simulator.',
  'On iOS 16.4+, set WKWebView.isInspectable = true in your app before loading content.',
  'Ensure a WKWebView or Safari tab is open with an active page.',
  'If you are on a simulator, verify that 127.0.0.1 resolves correctly (check /etc/hosts).',
];

function proxyStateToResult(state: { pid: number; basePort: number }): StartProxyResult {
  return {
    pid: state.pid,
    basePort: state.basePort,
    deviceListUrl: getDeviceListUrl(state.basePort),
    tabsUrl: getTabsUrl(state.basePort),
  };
}

export async function ensureProxy(
  options: EnsureProxyOptions,
): Promise<{ target: DiscoveredTarget; proxy: StartProxyResult }> {
  const { udid, basePort, autoStart = true } = options;
  const target = await resolveTarget(udid);

  const existing = await getExistingProxyState(target.udid);
  if (existing) {
    if (basePort && existing.basePort !== basePort) {
      throw new Error(
        `An IWDP proxy is already running for ${target.udid} on port ${existing.basePort}. ` +
          `Stop it first or reuse the existing port.`,
      );
    }
    return { target, proxy: proxyStateToResult(existing) };
  }

  if (!autoStart) {
    throw new Error(
      'ios_webkit_debug_proxy is not running. Start it first with `xcodecontrol webview:proxy --udid <UDID>`.',
    );
  }

  const startOptions: StartProxyOptions = { udid: target.udid };
  if (typeof basePort === 'number') {
    startOptions.basePort = basePort;
  }

  const proxy = await startProxy(startOptions);

  return { target, proxy };
}

export async function startWebviewProxy(options: {
  udid?: string;
  basePort?: number;
  foreground?: boolean;
}): Promise<{ target: DiscoveredTarget; proxy: StartProxyResult }> {
  const { udid, basePort, foreground = false } = options;
  const target = await resolveTarget(udid);
  const existing = await getExistingProxyState(target.udid);
  if (existing) {
    if (basePort && existing.basePort !== basePort) {
      throw new Error(
        `An IWDP proxy is already running for ${target.udid} on port ${existing.basePort}. ` +
          `Stop it first before starting with a new port.`,
      );
    }
    return { target, proxy: proxyStateToResult(existing) };
  }

  const startOptions: StartProxyOptions = { udid: target.udid };
  if (typeof basePort === 'number') {
    startOptions.basePort = basePort;
  }
  if (foreground) {
    startOptions.foreground = true;
  }

  const proxy = await startProxy(startOptions);

  return { target, proxy };
}

export async function stopWebviewProxy(udid: string): Promise<StopProxyResult> {
  return stopProxy(udid);
}

export async function listWebviewTargets(options: {
  udid?: string;
  basePort?: number;
}): Promise<{
  target: DiscoveredTarget;
  proxy: StartProxyResult;
  devices: InspectorDevice[];
}> {
  const { udid, basePort } = options;
  const ensureOptions: EnsureProxyOptions = { autoStart: true };
  if (udid) {
    ensureOptions.udid = udid;
  }
  if (typeof basePort === 'number') {
    ensureOptions.basePort = basePort;
  }
  const { target, proxy } = await ensureProxy(ensureOptions);
  const devices = await listInspectorTargets(proxy.basePort, target);
  return { target, proxy, devices };
}

export async function evaluateInWebview(options: {
  udid: string;
  targetIdOrUrl: string;
  expression: string;
  basePort?: number;
  timeoutMs?: number;
}): Promise<{ evaluation: EvaluateResult; device: InspectorDevice; page: InspectorPage }> {
  const { udid, targetIdOrUrl, expression, basePort, timeoutMs } = options;

  if (!expression) {
    throw new Error('Expression is required for webview evaluation.');
  }

  const ensureOptions: EnsureProxyOptions = { autoStart: true, udid };
  if (typeof basePort === 'number') {
    ensureOptions.basePort = basePort;
  }
  const { target, proxy } = await ensureProxy(ensureOptions);
  const devices = await listInspectorTargets(proxy.basePort, target);
  if (!devices.length || devices.every(device => device.pages.length === 0)) {
    throw new Error([
      'No inspectable pages were detected.',
      '',
      ...EMPTY_STATE_TIPS.map(tip => `• ${tip}`),
    ].join('\n'));
  }

  const match = findMatchingPage(devices, page => {
    if (!targetIdOrUrl) return false;
    if (page.id === targetIdOrUrl) return true;
    if (page.url && page.url.includes(targetIdOrUrl)) return true;
    if (page.title && page.title.includes(targetIdOrUrl)) return true;
    return false;
  });

  if (!match) {
    const available = devices
      .flatMap(device => device.pages.map(page => page.id))
      .filter(Boolean)
      .join(', ');
    throw new Error(`Target "${targetIdOrUrl}" not found. Available page IDs: ${available || 'None'}`);
  }

  if (!match.page.wsUrl) {
    throw new Error(
      `Page "${match.page.id}" does not expose a WebSocket debugger URL. ` +
        'Try reloading the page or ensure the app enables inspection.',
    );
  }

  const client = new WebKitWsClient(match.page.wsUrl);
  try {
    await client.connect();
    const evaluation = await client.evaluate(expression, timeoutMs);
    return { evaluation, device: match.device, page: match.page };
  } finally {
    client.close();
  }
}

export async function evaluateExpression(
  pageWsUrl: string,
  expression: string,
  timeoutMs = 5000,
): Promise<EvaluateResult> {
  const client = new WebKitWsClient(pageWsUrl);
  try {
    await client.connect();
    return await client.evaluate(expression, timeoutMs);
  } finally {
    client.close();
  }
}

export function getEmptyStateTips(): string[] {
  return EMPTY_STATE_TIPS;
}

export async function discoverBootedTargets(): Promise<DiscoveredTarget[]> {
  return listInspectableTargets();
}

export async function openInspectorUrl(url: string): Promise<void> {
  if (!url) {
    throw new Error('No URL provided to open.');
  }

  await execa('open', [url]);
}
