import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { ExtensionBridge, setBridge } from "./bridge/extension-bridge.js";
import type {
  ExtensionToServerMessage,
  ServerToExtensionMessage,
} from "@browser-mcp/shared";
import { execJsOnPage } from "./code-exec/page-exec.js";
import { runNodeScript } from "./code-exec/playwright-runner.js";

/**
 * End-to-end smoke with a fake extension that answers bridge requests.
 * Validates the server tool path without a real Chrome.
 */
describe("smoke: bridge + code exec", () => {
  let bridge: ExtensionBridge;
  const port = 28373;
  let ws: WebSocket;

  before(async () => {
    bridge = new ExtensionBridge({ host: "127.0.0.1", port });
    setBridge(bridge);
    await bridge.start();

    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    ws.send(
      JSON.stringify({
        kind: "hello",
        version: 1,
        extensionId: "smoke-ext",
      } satisfies ExtensionToServerMessage),
    );

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

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerToExtensionMessage;
      if (msg.kind !== "request") return;
      const req = msg.request;
      let result: unknown = { ok: true, type: req.type };

      if (req.type === "exec_js") {
        // Simulate page exec evaluating simple code patterns used in tests
        const code = String(req.payload?.code ?? "");
        if (code.includes("1+1") || code.includes("1 + 1")) {
          result = 2;
        } else if (code.includes("document.title")) {
          result = "Smoke Page";
        } else {
          result = { evaluated: true };
        }
      } else if (req.type === "get_visual_state") {
        result = {
          screenshot: "data:image/png;base64,iVBORw0KGgo=",
          elements: [
            {
              id: 1,
              tag: "BUTTON",
              text: "OK",
              bbox: { x: 10, y: 10, w: 80, h: 30 },
              selector: "button",
              xpath: "/html/body/button[1]",
              visible: true,
              enabled: true,
            },
          ],
          url: "https://example.com",
          title: "Example",
          viewport: { width: 1280, height: 720 },
        };
      } else if (req.type === "get_tabs") {
        result = {
          tabs: [{ id: 1, url: "https://example.com", title: "Example", active: true }],
        };
      } else if (req.type === "click") {
        result = { ok: true, x: 50, y: 25 };
      }

      const response: ExtensionToServerMessage = {
        kind: "response",
        response: { id: req.id, ok: true, result },
      };
      ws.send(JSON.stringify(response));
    });
  });

  after(async () => {
    ws?.close();
    await bridge.stop();
  });

  it("bridge status connected", () => {
    assert.equal(bridge.isConnected, true);
    assert.equal(bridge.status.extensionId, "smoke-ext");
  });

  it("get_tabs via bridge", async () => {
    const tabs = await bridge.sendRequest("get_tabs");
    assert.ok((tabs as { tabs: unknown[] }).tabs.length >= 1);
  });

  it("get_visual_state via bridge", async () => {
    const vs = (await bridge.sendRequest("get_visual_state", {
      drawLabels: true,
    })) as { elements: unknown[]; screenshot: string };
    assert.equal(vs.elements.length, 1);
    assert.ok(vs.screenshot.includes("base64") || vs.screenshot.length > 10);
  });

  it("click via bridge", async () => {
    const r = await bridge.sendRequest("click", {
      target: { som_id: 1 },
      clickType: "left",
    });
    assert.equal((r as { ok: boolean }).ok, true);
  });

  it("execJsOnPage helper", async () => {
    const r = await execJsOnPage("return 1 + 1;");
    // Fake extension returns unwrapped number as result of exec_js request
    // page-exec wraps success
    assert.equal(r.success, true);
    assert.equal(r.result, 2);
  });

  it("runNodeScript host sandbox", async () => {
    const r = await runNodeScript(`
      const data = [1,2,3].map(x => x * 2);
      return { data, sum: data.reduce((a,b)=>a+b,0) };
    `);
    assert.equal(r.success, true);
    assert.deepEqual(r.result, { data: [2, 4, 6], sum: 12 });
  });
});
