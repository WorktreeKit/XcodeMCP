import type { Command } from 'commander';
import Logger from '../../../utils/Logger.js';
import {
  startWebviewProxy,
  stopWebviewProxy,
  listWebviewTargets,
  evaluateInWebview,
  openInspectorUrl,
  getEmptyStateTips,
} from '../../../webview/service.js';
import type { EvaluateResult, InspectorDevice, InspectorPage } from '../../../webview/types.js';

interface ProxyCommandOptions {
  udid?: string;
  port?: string;
  stop?: boolean;
  foreground?: boolean;
}

interface ListCommandOptions {
  udid?: string;
  port?: string;
}

interface EvalCommandOptions {
  udid?: string;
  target?: string;
  expr?: string;
  port?: string;
  timeout?: string;
}

interface OpenCommandOptions {
  udid?: string;
  port?: string;
  page?: string;
  device?: boolean;
}

function setLogLevel(program: Command): void {
  const globalOpts = program.opts();
  if (globalOpts.quiet) {
    process.env.LOG_LEVEL = 'ERROR';
  } else if (globalOpts.verbose) {
    process.env.LOG_LEVEL = 'DEBUG';
  } else {
    process.env.LOG_LEVEL = 'WARN';
  }
}

function parsePort(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function parseTimeout(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid timeout: ${value}`);
  }
  return parsed;
}

function outputJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function formatDevicesTable(devices: InspectorDevice[]): string {
  const rows: Array<{
    device: string;
    osVersion: string;
    pageId: string;
    type: string;
    title: string;
    url: string;
    ws: string;
  }> = [];

  for (const device of devices) {
    const header = `${device.name ?? 'Unknown device'}${device.udid ? ` (${device.udid})` : ''}`;
    const os = device.osVersion ?? '';

    if (!device.pages.length) {
      rows.push({
        device: header,
        osVersion: os,
        pageId: '(none)',
        type: '-',
        title: '-',
        url: '',
        ws: '',
      });
      continue;
    }

    for (const page of device.pages) {
      rows.push({
        device: header,
        osVersion: os,
        pageId: page.id,
        type: page.type ?? '',
        title: page.title ?? '',
        url: page.url ?? '',
        ws: page.wsUrl ?? '',
      });
    }
  }

  const deviceWidth = Math.max(6, ...rows.map(row => row.device.length));
  const osWidth = Math.max(2, ...rows.map(row => row.osVersion.length));
  const idWidth = Math.max(7, ...rows.map(row => row.pageId.length));
  const typeWidth = Math.max(4, ...rows.map(row => row.type.length));
  const titleWidth = Math.max(5, ...rows.map(row => row.title.length));

  const header = [
    pad('Device', deviceWidth),
    pad('OS', osWidth),
    pad('Page ID', idWidth),
    pad('Type', typeWidth),
    pad('Title', titleWidth),
  ].join('  ');

  const separator = '-'.repeat(header.length + 32);

  const lines = [header, separator];

  for (const row of rows) {
    lines.push(
      [
        pad(row.device, deviceWidth),
        pad(row.osVersion, osWidth),
        pad(row.pageId, idWidth),
        pad(row.type, typeWidth),
        pad(row.title, titleWidth),
      ].join('  '),
    );
    if (row.url) {
      lines.push(`    URL: ${row.url}`);
    }
    if (row.ws) {
      lines.push(`    WS:  ${row.ws}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return `${value}${' '.repeat(width - value.length)}`;
}

function buildEvaluationOutput(evaluation: EvaluateResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('result' in evaluation) {
    payload.result = evaluation.result;
  }
  if (evaluation.exception) {
    payload.exception = evaluation.exception;
  }
  return payload;
}

export function registerWebviewCommands(program: Command): void {
  program
    .command('webview:proxy')
    .description('Start or stop ios_webkit_debug_proxy for a simulator/device')
    .option('--udid <udid>', 'Target simulator/device UDID')
    .option('--port <port>', 'Base port for tabs (defaults to 9222)')
    .option('--stop', 'Stop the running proxy instead of starting a new one')
    .option('--foreground', 'Run ios_webkit_debug_proxy in the foreground and stream logs')
    .action(async (options: ProxyCommandOptions) => {
      try {
        setLogLevel(program);
        const basePort = parsePort(options.port);
        const globalOpts = program.opts();
        if (options.stop) {
          if (!options.udid) {
            throw new Error('UDID is required when stopping ios_webkit_debug_proxy.');
          }
          const result = await stopWebviewProxy(options.udid);
          if (globalOpts.json) {
            outputJson({ ...result, udid: options.udid });
          } else {
            process.stdout.write(`${result.message ?? 'Stopped ios_webkit_debug_proxy.'}\n`);
          }
          process.exit(result.stopped ? 0 : 1);
        }

        const startOptions: {
          udid?: string;
          basePort?: number;
          foreground?: boolean;
        } = {};
        if (options.udid) {
          startOptions.udid = options.udid;
        }
        if (typeof basePort === 'number') {
          startOptions.basePort = basePort;
        }
        if (options.foreground) {
          startOptions.foreground = true;
        }

        const { target, proxy } = await startWebviewProxy(startOptions);

        if (globalOpts.json) {
          outputJson({
            udid: target.udid,
            deviceName: target.name,
            osVersion: target.osVersion,
            pid: proxy.pid,
            basePort: proxy.basePort,
            deviceListUrl: proxy.deviceListUrl,
            tabsUrl: proxy.tabsUrl,
            foreground: options.foreground ?? false,
          });
        } else {
          process.stdout.write(
            [
              `✅ ios_webkit_debug_proxy running for ${target.name ?? target.udid}`,
              `• UDID: ${target.udid}`,
              `• PID: ${proxy.pid}`,
              `• Tabs URL: ${proxy.tabsUrl}`,
              `• Device list URL: ${proxy.deviceListUrl}`,
              options.foreground ? 'Stream will continue until you interrupt (Ctrl+C)…' : '',
            ]
              .filter(Boolean)
              .join('\n')
              .concat('\n'),
          );
        }

        if (options.foreground) {
          if (!proxy.process) {
            process.stdout.write(
              'Proxy already running in the background. Use --stop first if you need a fresh foreground session.\n',
            );
            process.exit(0);
          }
          try {
            await proxy.process;
            process.exit(0);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error('ios_webkit_debug_proxy terminated', message);
            process.exit(1);
          }
        } else {
          process.exit(0);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`❌ webview:proxy failed: ${message}\n`);
        process.exit(1);
      }
    });

  program
    .command('webview:list')
    .description('List inspectable WKWebView/Safari targets exposed by ios_webkit_debug_proxy (use global --json for structured output)')
    .option('--udid <udid>', 'Target simulator/device UDID')
    .option('--port <port>', 'Base port for tabs (defaults to 9222)')
    .action(async (options: ListCommandOptions) => {
      try {
        setLogLevel(program);
        const basePort = parsePort(options.port);
        const globalOpts = program.opts();
        const jsonOutput = Boolean(globalOpts.json);
        const listOptions: { udid?: string; basePort?: number } = {};
        if (options.udid) {
          listOptions.udid = options.udid;
        }
        if (typeof basePort === 'number') {
          listOptions.basePort = basePort;
        }

        const { target, proxy, devices } = await listWebviewTargets(listOptions);

        const payload = devices.map((device: InspectorDevice) => ({
          udid: device.udid ?? target.udid,
          deviceName: device.name ?? target.name,
          osVersion: device.osVersion ?? target.osVersion,
          basePort: proxy.basePort,
          deviceListUrl: proxy.deviceListUrl,
          tabsUrl: device.tabsUrl,
          pages: device.pages.map(page => ({
            id: page.id,
            title: page.title,
            url: page.url,
            type: page.type,
            wsUrl: page.wsUrl,
            devtoolsFrontendUrl: page.devtoolsFrontendUrl,
          })),
        }));

        const hasPages = devices.some((device: InspectorDevice) => device.pages.length > 0);

        if (jsonOutput) {
          outputJson(payload);
        } else if (!hasPages) {
          process.stdout.write(
            [
              'No inspectable pages were found.',
              '',
              ...getEmptyStateTips().map((tip: string) => `• ${tip}`),
            ].join('\n') + '\n',
          );
        } else {
          const table = formatDevicesTable(devices);
          process.stdout.write(`${table}\n`);
        }

        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`❌ webview:list failed: ${message}\n`);
        process.exit(1);
      }
    });

  program
    .command('webview:eval')
    .description('Evaluate JavaScript inside a WKWebView/Safari target')
    .option('--udid <udid>', 'Target simulator/device UDID')
    .option('--target <pageIdOrUrl>', 'Page ID or URL substring to match')
    .option('--expr <expression>', 'JavaScript expression to evaluate')
    .option('--port <port>', 'Base port for tabs (defaults to 9222)')
    .option('--timeout <ms>', 'Timeout in milliseconds (defaults to 5000)')
    .action(async (options: EvalCommandOptions) => {
      try {
        setLogLevel(program);
        if (!options.udid) {
          throw new Error('Missing required option: --udid');
        }
        if (!options.target) {
          throw new Error('Missing required option: --target');
        }
        if (!options.expr) {
          throw new Error('Missing required option: --expr');
        }
        const basePort = parsePort(options.port);
        const timeoutMs = parseTimeout(options.timeout);
        const globalOpts = program.opts();
        const jsonOutput = Boolean(globalOpts.json ?? true);

        const evalOptions: {
          udid: string;
          targetIdOrUrl: string;
          expression: string;
          basePort?: number;
          timeoutMs?: number;
        } = {
          udid: options.udid,
          targetIdOrUrl: options.target,
          expression: options.expr,
        };

        if (typeof basePort === 'number') {
          evalOptions.basePort = basePort;
        }
        if (typeof timeoutMs === 'number') {
          evalOptions.timeoutMs = timeoutMs;
        }

        const { evaluation, device, page } = await evaluateInWebview(evalOptions);

        if (jsonOutput) {
          outputJson({
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
            ...buildEvaluationOutput(evaluation),
          });
        } else if (evaluation.exception) {
          process.stderr.write(
            `❌ Evaluation threw an exception: ${evaluation.exception.description ?? 'Runtime error'}\n`,
          );
          process.exit(1);
        } else {
          process.stdout.write(
            `Result: ${JSON.stringify(evaluation.result, null, 2)}\n`,
          );
        }

        process.exit(evaluation.exception ? 1 : 0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`❌ webview:eval failed: ${message}\n`);
        process.exit(1);
      }
    });

  program
    .command('webview:open')
    .description('Open the ios_webkit_debug_proxy device list or a specific page in the default browser')
    .option('--udid <udid>', 'Target simulator/device UDID')
    .option('--port <port>', 'Base port for tabs (defaults to 9222)')
    .option('--page <pageId>', 'Open a specific page inspector by ID')
    .option('--device', 'Open the device list UI (default)')
    .action(async (options: OpenCommandOptions) => {
      try {
        setLogLevel(program);
        const basePort = parsePort(options.port);
        const globalOpts = program.opts();
        const jsonOutput = Boolean(globalOpts.json ?? false);
        const listOptions: { udid?: string; basePort?: number } = {};
        if (options.udid) {
          listOptions.udid = options.udid;
        }
        if (typeof basePort === 'number') {
          listOptions.basePort = basePort;
        }

        const { target, proxy, devices } = await listWebviewTargets(listOptions);

        let url = proxy.deviceListUrl;

        if (options.page) {
          const pageMatch = devices
            .flatMap((device: InspectorDevice) => device.pages)
            .find((page: InspectorPage) => page.id === options.page || page.url === options.page);

          if (!pageMatch) {
            throw new Error(`Page ${options.page} was not found. Run webview:list to inspect available IDs.`);
          }

          url = pageMatch.devtoolsFrontendUrl ?? pageMatch.url ?? proxy.tabsUrl;
        } else {
          url = proxy.deviceListUrl;
        }

        await openInspectorUrl(url);

        if (jsonOutput) {
          outputJson({ opened: true, url });
        } else {
          process.stdout.write(`Opened ${url} in the default browser for ${target.name ?? target.udid}\n`);
        }

        process.exit(0);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`❌ webview:open failed: ${message}\n`);
        process.exit(1);
      }
    });
}

export default registerWebviewCommands;
