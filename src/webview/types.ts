import type { ChildProcess } from 'child_process';

export type TargetKind = 'simulator' | 'device' | 'unknown';

export interface DiscoveredTarget {
  udid: string;
  name: string;
  kind: TargetKind;
  state?: string;
  runtime?: string;
  osVersion?: string;
}

export interface ProxyState {
  pid: number;
  basePort: number;
  foreground: boolean;
  startedAt: number;
}

export interface StartProxyOptions {
  udid: string;
  basePort?: number;
  foreground?: boolean;
  autoSelectPort?: boolean;
}

export interface StartProxyResult {
  pid: number;
  basePort: number;
  deviceListUrl: string;
  tabsUrl: string;
  process?: ChildProcess;
}

export interface StopProxyResult {
  stopped: boolean;
  message?: string;
}

export interface InspectorPage {
  id: string;
  title: string;
  url: string;
  type: string;
  wsUrl: string;
  devtoolsFrontendUrl?: string;
}

export interface InspectorDevice {
  udid?: string;
  deviceId?: string;
  name?: string;
  osVersion?: string;
  basePort: number;
  tabsUrl: string;
  pages: InspectorPage[];
}

export interface EvaluateResult {
  result?: unknown;
  exception?: {
    description?: string;
    value?: unknown;
  };
}
