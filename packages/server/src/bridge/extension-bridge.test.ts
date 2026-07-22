import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { ExtensionBridge } from "./extension-bridge.js";
import type {
  ExtensionToServerMessage,
  ServerToExtensionMessage,
} from "@browser-mcp/shared";

describe("ExtensionBridge", () => {
  let bridge: ExtensionBridge;
  const port = 27373;

  before(async () => {
    bridge = new ExtensionBridge({ host: "127.0.0.1", port });
    await bridge.start();
  });

  after(async () => {
    await bridge.stop();
  });

  it("starts and reports status", () => {
    const status = bridge.status;
    assert.equal(status.port, port);
    assert.equal(status.connected, false);
  });

  it("accepts extension hello and answers requests", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const hello: ExtensionToServerMessage = {
      kind: "hello",
      version: 1,
      extensionId: "test-ext",
    };
    ws.send(JSON.stringify(hello));

    await new Promise<void>((resolve) => {
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString()) as ServerToExtensionMessage;
        if (msg.kind === "hello_ack") {
          ws.off("message", onMsg);
          resolve();
        }
      };
      ws.on("message", onMsg);
    });

    assert.equal(bridge.isConnected, true);

    // Auto-respond to requests as a fake extension
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerToExtensionMessage;
      if (msg.kind === "request") {
        const response: ExtensionToServerMessage = {
          kind: "response",
          response: {
            id: msg.request.id,
            ok: true,
            result: { pong: true, type: msg.request.type },
          },
        };
        ws.send(JSON.stringify(response));
      }
    });

    const result = await bridge.sendRequest("ping", { hello: "world" });
    assert.deepEqual(result, { pong: true, type: "ping" });

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });
});
