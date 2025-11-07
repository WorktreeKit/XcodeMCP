import type { McpResult } from '../types/index.js';
import Logger from '../utils/Logger.js';
import {
  startWebviewProxy,
  stopWebviewProxy,
  listWebviewTargets,
  evaluateInWebview,
  openInspectorUrl,
  getEmptyStateTips,
} from '../webview/service.js';
import type { InspectorDevice, InspectorPage } from '../webview/types.js';

function successText(text: string): McpResult {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function jsonText(data: unknown): McpResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string): McpResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

export class WebviewTools {
  public static async startProxy(args: {
    udid?: string;
    port?: number;
    foreground?: boolean;
  }): Promise<McpResult> {
    try {
      const startOptions: {
        udid?: string;
        basePort?: number;
        foreground?: boolean;
      } = {};

      if (args.udid) {
        startOptions.udid = args.udid;
      }
      if (typeof args.port === 'number') {
        startOptions.basePort = args.port;
      }
      if (typeof args.foreground === 'boolean') {
        startOptions.foreground = args.foreground;
      }

      const { target, proxy } = await startWebviewProxy(startOptions);

      return jsonText({
        udid: target.udid,
        deviceName: target.name,
        osVersion: target.osVersion,
        pid: proxy.pid,
        basePort: proxy.basePort,
        deviceListUrl: proxy.deviceListUrl,
        tabsUrl: proxy.tabsUrl,
        foreground: args.foreground ?? false,
        message: `ios_webkit_debug_proxy running for ${target.name ?? target.udid}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('webview_start_proxy failed', error);
      return errorResult(`Failed to start ios_webkit_debug_proxy: ${message}`);
    }
  }

  public static async stopProxy(args: { udid: string }): Promise<McpResult> {
    try {
      const result = await stopWebviewProxy(args.udid);
      return jsonText({
        udid: args.udid,
        stopped: result.stopped,
        message: result.message ?? '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('webview_stop_proxy failed', error);
      return errorResult(`Failed to stop ios_webkit_debug_proxy: ${message}`);
    }
  }

  public static async listTargets(args: {
    udid?: string;
    port?: number;
  }): Promise<McpResult> {
    try {
      const listOptions: {
        udid?: string;
        basePort?: number;
      } = {};

      if (args.udid) {
        listOptions.udid = args.udid;
      }
      if (typeof args.port === 'number') {
        listOptions.basePort = args.port;
      }

      const { target, proxy, devices } = await listWebviewTargets(listOptions);

      if (!devices.some((device: InspectorDevice) => device.pages.length > 0)) {
        return successText(
          [
            'No inspectable pages were returned by ios_webkit_debug_proxy.',
            '',
            ...getEmptyStateTips().map((tip: string) => `• ${tip}`),
          ].join('\n'),
        );
      }

      return jsonText(
        devices.map((device: InspectorDevice) => ({
          udid: device.udid ?? target.udid,
          deviceName: device.name ?? target.name ?? 'Unknown device',
          osVersion: device.osVersion ?? target.osVersion,
          basePort: proxy.basePort,
          deviceListUrl: proxy.deviceListUrl,
          tabsUrl: device.tabsUrl,
          pages: device.pages.map((page: InspectorPage) => ({
            id: page.id,
            title: page.title,
            url: page.url,
            type: page.type,
            wsUrl: page.wsUrl,
            devtoolsFrontendUrl: page.devtoolsFrontendUrl,
          })),
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('webview_list_targets failed', error);
      return errorResult(`Failed to list webview targets: ${message}`);
    }
  }

  public static async evaluate(args: {
    udid: string;
    target_id_or_url: string;
    expr: string;
    port?: number;
    timeout_ms?: number;
  }): Promise<McpResult> {
    try {
      const evalOptions: {
        udid: string;
        targetIdOrUrl: string;
        expression: string;
        basePort?: number;
        timeoutMs?: number;
      } = {
        udid: args.udid,
        targetIdOrUrl: args.target_id_or_url,
        expression: args.expr,
      };

      if (typeof args.port === 'number') {
        evalOptions.basePort = args.port;
      }
      if (typeof args.timeout_ms === 'number') {
        evalOptions.timeoutMs = args.timeout_ms;
      }

      const { evaluation, device, page } = await evaluateInWebview(evalOptions);

      return jsonText({
        device: {
          udid: device.udid,
          name: device.name,
          osVersion: device.osVersion,
        },
        page: {
          id: page.id,
          title: page.title,
          url: page.url,
          type: page.type,
        },
        result: evaluation.result,
        exception: evaluation.exception,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('webview_eval failed', error);
      return errorResult(`Failed to evaluate expression: ${message}`);
    }
  }

  public static async openUi(args: {
    udid?: string;
    port?: number;
    page_id?: string;
  }): Promise<McpResult> {
    try {
      const listOptions: {
        udid?: string;
        basePort?: number;
      } = {};

      if (args.udid) {
        listOptions.udid = args.udid;
      }
      if (typeof args.port === 'number') {
        listOptions.basePort = args.port;
      }

      const { target, proxy, devices } = await listWebviewTargets(listOptions);

      let url = proxy.deviceListUrl;

      if (args.page_id) {
        const pageMatch = devices
          .flatMap((device: InspectorDevice) => device.pages)
          .find((page: InspectorPage) => page.id === args.page_id || page.url === args.page_id);

        if (!pageMatch) {
          return errorResult(`Page ${args.page_id} was not found. Run webview:list to inspect available IDs.`);
        }

        url = pageMatch.devtoolsFrontendUrl ?? pageMatch.url ?? proxy.tabsUrl;
      }

      await openInspectorUrl(url);

      return jsonText({
        opened: true,
        url,
        udid: target.udid,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('webview_open_ui failed', error);
      return errorResult(`Failed to open inspector UI: ${message}`);
    }
  }
}

export default WebviewTools;
