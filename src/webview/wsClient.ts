import WebSocket, { RawData } from 'ws';
import Logger from '../utils/Logger.js';
import type { EvaluateResult } from './types.js';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class WebKitWsClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(url: string) {
    this.url = url;
  }

  public async connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.socket = ws;

      const onOpen = (): void => {
        cleanup();
        resolve();
      };

      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      const onClose = (): void => {
        cleanup();
        reject(new Error('WebSocket closed before connection was established'));
      };

      const cleanup = (): void => {
        ws.off('open', onOpen);
        ws.off('error', onError);
        ws.off('close', onClose);
      };

      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('close', onClose);

      ws.on('message', (data: RawData) => {
        this.handleMessage(data);
      });

      ws.on('close', () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('WebSocket closed unexpectedly'));
        }
        this.pending.clear();
      });
    });
  }

  /**
   * Close the WebSocket connection.
   */
  public close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Send a generic protocol command.
   */
  public async send(method: string, params?: Record<string, unknown>, timeoutMs = 5000): Promise<any> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const id = this.nextId;
    this.nextId += 1;

    const payload = JSON.stringify({ id, method, params });

    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WebSocket request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.socket!.send(payload);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Evaluate a JavaScript expression inside the page.
   */
  public async evaluate(expression: string, timeoutMs = 5000): Promise<EvaluateResult> {
    if (!expression) {
      throw new Error('Expression is required for Runtime.evaluate');
    }

    const response = await this.send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      timeoutMs,
    );

    const { result, exceptionDetails } = response as {
      result?: { type?: string; value?: unknown; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } };
    };

    if (exceptionDetails) {
      return {
        exception: {
          description:
            exceptionDetails.text ??
            exceptionDetails.exception?.description ??
            'Runtime.evaluate reported an exception',
          value: exceptionDetails.exception?.value,
        },
      };
    }

    if (!result) {
      return { result: undefined };
    }

    if (Object.prototype.hasOwnProperty.call(result, 'value')) {
      return { result: result.value };
    }

    if (result.description) {
      return { result: result.description };
    }

    return { result };
  }

  private handleMessage(data: WebSocket.RawData): void {
    let parsed: any;
    try {
      const text = typeof data === 'string' ? data : data.toString();
      parsed = JSON.parse(text);
    } catch (error) {
      Logger.debug('Failed to parse WebSocket message', error);
      return;
    }

    if (!parsed) return;

    if (typeof parsed.id === 'number' && this.pending.has(parsed.id)) {
      const pending = this.pending.get(parsed.id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);

      if (parsed.error) {
        const message = parsed.error?.message ?? 'Unknown WebSocket error';
        pending.reject(new Error(message));
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    // Console messages, events, etc. are logged at debug level
    Logger.debug('Received WebKit inspector event', parsed);
  }
}

export default WebKitWsClient;
