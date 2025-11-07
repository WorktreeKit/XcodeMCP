import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { execa } from 'execa';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../../dist/cli.js');

describe('webview CLI smoke test', () => {
  let deviceServer: Server;
  let tabsServer: Server;
  let devicePort: number;
  let basePort: number;
  let tempHome: string;
  let tempBin: string;
  const udid = 'TEST-UDID';

  beforeAll(async () => {
    // Start device list server on an ephemeral port
    deviceServer = createServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              deviceId: `device:${udid}`,
              deviceName: 'Mock Device',
              osVersion: 'iOS 17.4',
              url: `http://127.0.0.1:${basePort}/json`,
            },
          ]),
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => {
      deviceServer.listen(0, '127.0.0.1', resolve);
    });

    devicePort = (deviceServer.address() as AddressInfo).port;
    basePort = devicePort + 1;

    tabsServer = createServer((req, res) => {
      if (req.url === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'page-1',
              title: 'Mock Page',
              url: 'https://example.test',
              type: 'page',
              webSocketDebuggerUrl: `ws://127.0.0.1:${basePort}/devtools/page/1`,
              devtoolsFrontendUrl: 'https://webkit.test/frontend?page=1',
            },
          ]),
        );
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise<void>((resolve) => {
      tabsServer.listen(basePort, '127.0.0.1', resolve);
    });

    tempHome = mkdtempSync(join(tmpdir(), 'webview-cli-'));
    tempBin = join(tempHome, 'bin');
    mkdirSync(tempBin, { recursive: true });

    // Stub idb
    const idbScript = `#!/bin/sh
if [ "$1" = "list-targets" ] && [ "$2" = "--json" ]; then
cat <<'JSON'
[{"udid":"${udid}","device_name":"Mock Device","type":"simulator","state":"Booted","os_version":"iOS 17.4"}]
JSON
else
  echo "[]" 
fi
`;
    const idbPath = join(tempBin, 'idb');
    writeFileSync(idbPath, idbScript);
    chmodSync(idbPath, 0o755);

    // Stub xcrun simctl
    const xcrunScript = `#!/bin/sh
if [ "$1" = "simctl" ] && [ "$2" = "list" ]; then
  echo '{"devices":{}}'
else
  echo '{"devices":{}}'
fi
`;
    const xcrunPath = join(tempBin, 'xcrun');
    writeFileSync(xcrunPath, xcrunScript);
    chmodSync(xcrunPath, 0o755);

    // Seed IWDP state to avoid launching real proxy
    const stateDir = join(tempHome, '.xcodemcp', 'iwdp');
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, `${udid}.json`),
      JSON.stringify(
        {
          pid: process.pid,
          basePort,
          foreground: false,
          startedAt: Date.now(),
        },
        null,
        2,
      ),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => deviceServer.close(() => resolve()));
    await new Promise<void>((resolve) => tabsServer.close(() => resolve()));
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('lists inspectable pages when IWDP state exists', async () => {
    const hasIwdp = await execa('which', ['ios_webkit_debug_proxy'])
      .then(() => true)
      .catch(() => false);

    if (process.env.CI && !hasIwdp) {
      return;
    }

    const { stdout } = await execa('node', [CLI_PATH, '--json', 'webview:list', '--udid', udid, '--port', String(basePort)], {
      env: {
        ...process.env,
        HOME: tempHome,
        PATH: `${tempBin}:${process.env.PATH}`,
        JXA_MOCK: '1',
      },
    });

    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.pages?.[0]?.title).toBe('Mock Page');
  });
});
