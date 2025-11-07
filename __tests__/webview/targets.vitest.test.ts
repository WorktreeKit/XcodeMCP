import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('undici', () => {
  return {
    fetch: vi.fn(),
  };
});

import { fetch } from 'undici';
import { listInspectorTargets } from '../../src/webview/targets.js';

const mockedFetch = vi.mocked(fetch);

describe('webview targets', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  afterEach(() => {
    mockedFetch.mockReset();
  });

  it('parses device and page listings from IWDP', async () => {
    const deviceListUrl = 'http://127.0.0.1:27752/json';
    const tabsUrl = 'http://127.0.0.1:27753/json';

    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          deviceId: 'device:TEST-1',
          deviceName: 'Mock iPhone',
          osVersion: 'iOS 17.4',
          url: tabsUrl,
        },
      ],
    } as any);

    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'page-1',
          title: 'Welcome',
          url: 'https://example.com',
          type: 'page',
          webSocketDebuggerUrl: 'ws://127.0.0.1:27753/devtools/page/1',
          devtoolsFrontendUrl: 'https://devtools.example.com/inspector?page=1',
        },
      ],
    } as any);

    const devices = await listInspectorTargets(27753, {
      udid: 'TEST-UDID',
      name: 'Mock iPhone',
      kind: 'simulator',
      state: 'Booted',
      osVersion: 'iOS 17.4',
    });

    expect(devices).toHaveLength(1);
    const [device] = devices;
    expect(device.name).toBe('Mock iPhone');
    expect(device.osVersion).toBe('iOS 17.4');
    expect(device.pages).toHaveLength(1);
    expect(device.pages[0]?.id).toBe('page-1');
    expect(device.pages[0]?.devtoolsFrontendUrl).toContain('inspector');

    expect(mockedFetch).toHaveBeenNthCalledWith(1, deviceListUrl, {
      headers: { accept: 'application/json' },
    });
    expect(mockedFetch).toHaveBeenNthCalledWith(2, tabsUrl, {
      headers: { accept: 'application/json' },
    });
  });

  it('falls back to direct tabs listing when device list is empty', async () => {
    const tabsUrl = 'http://127.0.0.1:27753/json';

    mockedFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'page-2',
            title: 'Fallback',
            url: 'app://local',
            type: 'page',
            webSocketDebuggerUrl: 'ws://127.0.0.1:27753/devtools/page/2',
          },
        ],
      } as any);

    const devices = await listInspectorTargets(27753);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.tabsUrl).toBe(tabsUrl);
    expect(devices[0]?.pages[0]?.title).toBe('Fallback');
  });
});
