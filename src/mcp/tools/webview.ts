import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import WebviewTools from '../../tools/WebviewTools.js';

export async function webview_start_proxy(args: {
  udid?: string;
  port?: number;
  foreground?: boolean;
}): Promise<CallToolResult> {
  return WebviewTools.startProxy(args);
}

export async function webview_stop_proxy(args: { udid: string }): Promise<CallToolResult> {
  return WebviewTools.stopProxy(args);
}

export async function webview_list_targets(args: {
  udid?: string;
  port?: number;
}): Promise<CallToolResult> {
  return WebviewTools.listTargets(args);
}

export async function webview_eval(args: {
  udid: string;
  target_id_or_url: string;
  expr: string;
  port?: number;
  timeout_ms?: number;
}): Promise<CallToolResult> {
  return WebviewTools.evaluate(args);
}

export async function webview_open_ui(args: {
  udid?: string;
  port?: number;
  page_id?: string;
}): Promise<CallToolResult> {
  return WebviewTools.openUi(args);
}
