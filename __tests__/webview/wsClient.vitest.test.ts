import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'net';
import WebKitWsClient from '../../src/webview/wsClient.js';

describe('WebKitWsClient', () => {
  let server: WebSocketServer;
  let port: number;

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });

    server.on('connection', socket => {
      socket.on('message', raw => {
        const message = JSON.parse(raw.toString()) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };

        const expression = typeof message.params?.expression === 'string'
          ? message.params.expression
          : '';

        if (expression.includes('throw')) {
          socket.send(
            JSON.stringify({
              id: message.id,
              result: {
                result: { type: 'undefined' },
                exceptionDetails: {
                  text: 'Script error',
                  exception: { description: 'Script error' },
                },
              },
            }),
          );
          return;
        }

        socket.send(
          JSON.stringify({
            id: message.id,
            result: {
              result: {
                type: 'number',
                value: 42,
              },
            },
          }),
        );
      });
    });

    await new Promise<void>(resolve => {
      server.once('listening', resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  it('evaluates expressions and returns values', async () => {
    const client = new WebKitWsClient(`ws://127.0.0.1:${port}`);
    await client.connect();

    const result = await client.evaluate('21 * 2');
    expect(result).toEqual({ result: 42 });

    client.close();
  });

  it('captures runtime exceptions', async () => {
    const client = new WebKitWsClient(`ws://127.0.0.1:${port}`);
    await client.connect();

    const result = await client.evaluate('throw new Error("boom")');
    expect(result.exception).toBeDefined();
    expect(result.exception?.description).toContain('Script error');

    client.close();
  });
});
