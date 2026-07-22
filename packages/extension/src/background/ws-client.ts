import {
  DEFAULT_WS_HOST,
  DEFAULT_WS_PORT,
  PROTOCOL_VERSION,
  type BridgeRequest,
  type BridgeResponse,
  type ExtensionToServerMessage,
  type ServerToExtensionMessage,
} from "@browser-mcp/shared";

export type RequestHandler = (request: BridgeRequest) => Promise<unknown>;

export interface WsClientState {
  connected: boolean;
  url: string;
  lastError?: string;
  lastConnectedAt?: number;
  reconnectAttempts: number;
}

/**
 * Maintains WebSocket connection from extension service worker to MCP server bridge.
 */
export class BridgeWsClient {
  private ws: WebSocket | null = null;
  private shouldRun = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private handler: RequestHandler | null = null;
  private host = DEFAULT_WS_HOST;
  private port = DEFAULT_WS_PORT;
  readonly state: WsClientState = {
    connected: false,
    url: "",
    reconnectAttempts: 0,
  };

  setHandler(handler: RequestHandler): void {
    this.handler = handler;
  }

  configure(host: string, port: number): void {
    this.host = host;
    this.port = port;
    this.state.url = `ws://${host}:${port}`;
  }

  connect(host = this.host, port = this.port): void {
    this.configure(host, port);
    this.shouldRun = true;
    this.open();
  }

  disconnect(): void {
    this.shouldRun = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.ws?.close();
    this.ws = null;
    this.state.connected = false;
  }

  private open(): void {
    if (!this.shouldRun) return;
    const url = `ws://${this.host}:${this.port}`;
    this.state.url = url;
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.state.lastError = String(err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.state.connected = true;
      this.state.reconnectAttempts = 0;
      this.state.lastConnectedAt = Date.now();
      this.state.lastError = undefined;
      const hello: ExtensionToServerMessage = {
        kind: "hello",
        version: PROTOCOL_VERSION,
        extensionId: chrome.runtime.id,
      };
      this.ws?.send(JSON.stringify(hello));
      this.startHeartbeat();
      void chrome.action.setBadgeText({ text: "ON" });
      void chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
      void chrome.storage.local.set({ bridgeConnected: true, bridgeUrl: url });
    };

    this.ws.onmessage = (ev) => {
      void this.onMessage(String(ev.data));
    };

    this.ws.onclose = () => {
      this.state.connected = false;
      void chrome.action.setBadgeText({ text: "OFF" });
      void chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
      void chrome.storage.local.set({ bridgeConnected: false });
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.state.lastError = "WebSocket error";
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.state.reconnectAttempts++;
    const delay = Math.min(10_000, 500 * this.state.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const msg: ExtensionToServerMessage = {
          kind: "heartbeat",
          ts: Date.now(),
        };
        this.ws.send(JSON.stringify(msg));
      }
    }, 15_000);
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: ServerToExtensionMessage;
    try {
      msg = JSON.parse(raw) as ServerToExtensionMessage;
    } catch {
      return;
    }

    if (msg.kind === "request") {
      await this.handleRequest(msg.request);
    }
  }

  private async handleRequest(request: BridgeRequest): Promise<void> {
    let response: BridgeResponse;
    try {
      if (!this.handler) throw new Error("No request handler registered");
      const result = await this.handler(request);
      response = { id: request.id, ok: true, result };
    } catch (err) {
      const e = err as Error;
      response = {
        id: request.id,
        ok: false,
        error: e.message,
        stack: e.stack,
      };
    }
    const out: ExtensionToServerMessage = { kind: "response", response };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(out));
    }
  }

  emitEvent(event: string, payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg: ExtensionToServerMessage = {
      kind: "event",
      event: {
        event,
        payload,
        timestamp: Date.now(),
      },
    };
    this.ws.send(JSON.stringify(msg));
  }
}

export const bridgeClient = new BridgeWsClient();
