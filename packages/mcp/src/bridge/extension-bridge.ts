import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import {
  DEFAULT_WS_HOST,
  DEFAULT_WS_PORT,
  PROTOCOL_VERSION,
  makeRequestId,
  type BridgeRequest,
  type BridgeRequestType,
  type BridgeResponse,
  type BridgeEvent,
  type ExtensionToServerMessage,
  type ServerToExtensionMessage,
} from "@browser-mcp/shared";

export interface ExtensionBridgeOptions {
  host?: string;
  port?: number;
}

interface PendingRequest {
  resolve: (res: BridgeResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * WebSocket hub that the Chrome extension connects to.
 * MCP tools send requests here; extension executes them and responds.
 */
export class ExtensionBridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private readonly host: string;
  private readonly port: number;
  private connected = false;
  private extensionId: string | null = null;
  private events: BridgeEvent[] = [];
  private readonly maxEvents = 500;

  constructor(opts: ExtensionBridgeOptions = {}) {
    super();
    this.host = opts.host ?? DEFAULT_WS_HOST;
    this.port = opts.port ?? DEFAULT_WS_PORT;
  }

  get isConnected(): boolean {
    return this.connected && this.client?.readyState === WebSocket.OPEN;
  }

  get status() {
    return {
      connected: this.isConnected,
      extensionId: this.extensionId,
      port: this.port,
      host: this.host,
      pendingRequests: this.pending.size,
      recentEvents: this.events.slice(-20),
    };
  }

  async start(): Promise<void> {
    if (this.wss) return;
    await new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({ host: this.host, port: this.port });
      this.wss.once("listening", () => resolve());
      this.wss.once("error", reject);
      this.wss.on("connection", (ws) => this.onConnection(ws));
    });
    this.emit("listening", { host: this.host, port: this.port });
  }

  async stop(): Promise<void> {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Bridge shutting down"));
      this.pending.delete(id);
    }
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    this.connected = false;
  }

  private onConnection(ws: WebSocket): void {
    // Only one extension client at a time
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.close(4000, "replaced by new connection");
    }
    this.client = ws;
    this.connected = true;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ExtensionToServerMessage;
        this.handleMessage(msg, ws);
      } catch (err) {
        this.emit("error", err);
      }
    });

    ws.on("close", () => {
      if (this.client === ws) {
        this.client = null;
        this.connected = false;
        this.extensionId = null;
        this.emit("disconnected");
      }
    });

    ws.on("error", (err) => this.emit("error", err));
  }

  private handleMessage(msg: ExtensionToServerMessage, ws: WebSocket): void {
    switch (msg.kind) {
      case "hello": {
        this.extensionId = msg.extensionId;
        const ack: ServerToExtensionMessage = {
          kind: "hello_ack",
          version: PROTOCOL_VERSION,
          port: this.port,
        };
        ws.send(JSON.stringify(ack));
        this.emit("connected", { extensionId: msg.extensionId });
        break;
      }
      case "response": {
        const pending = this.pending.get(msg.response.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(msg.response.id);
          pending.resolve(msg.response);
        }
        break;
      }
      case "event": {
        this.events.push(msg.event);
        if (this.events.length > this.maxEvents) {
          this.events = this.events.slice(-this.maxEvents);
        }
        this.emit("event", msg.event);
        break;
      }
      case "heartbeat": {
        const ack: ServerToExtensionMessage = {
          kind: "heartbeat_ack",
          ts: Date.now(),
        };
        ws.send(JSON.stringify(ack));
        break;
      }
    }
  }

  async sendRequest(
    type: BridgeRequestType,
    payload: Record<string, unknown> = {},
    options: { tabId?: number; timeoutMs?: number } = {},
  ): Promise<unknown> {
    if (!this.isConnected || !this.client) {
      throw new Error(
        `Chrome extension is not connected. Start the extension and click Connect (WS ${this.host}:${this.port}).`,
      );
    }

    const id = makeRequestId();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const request: BridgeRequest = {
      id,
      type,
      payload,
      tabId: options.tabId,
      timeoutMs,
    };

    const response = await new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const msg: ServerToExtensionMessage = { kind: "request", request };
      this.client!.send(JSON.stringify(msg), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });

    if (!response.ok) {
      const err = new Error(response.error ?? "Unknown bridge error");
      if (response.stack) {
        (err as Error & { stack?: string }).stack = response.stack;
      }
      throw err;
    }
    return response.result;
  }

  drainEvents(filter?: string): BridgeEvent[] {
    if (!filter) {
      const all = [...this.events];
      this.events = [];
      return all;
    }
    const matched = this.events.filter((e) => e.event === filter);
    this.events = this.events.filter((e) => e.event !== filter);
    return matched;
  }
}

/** Singleton used by MCP tools */
let bridgeInstance: ExtensionBridge | null = null;

export function getBridge(): ExtensionBridge {
  if (!bridgeInstance) {
    bridgeInstance = new ExtensionBridge();
  }
  return bridgeInstance;
}

export function setBridge(bridge: ExtensionBridge): void {
  bridgeInstance = bridge;
}
