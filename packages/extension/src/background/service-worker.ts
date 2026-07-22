/**
 * Background service worker — bridges MCP server (WS) ↔ browser APIs / content scripts.
 */
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@browser-mcp/shared";
import { bridgeClient } from "./ws-client.js";
import { routeRequest } from "./request-router.js";
import { setupWatchdogAlarms } from "./watchdogs.js";
import { setupNetworkLogging } from "./network.js";

bridgeClient.setHandler(async (request) => routeRequest(request));

async function autoConnect(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "wsHost",
    "wsPort",
    "autoConnect",
  ]);
  const host = (stored.wsHost as string) || DEFAULT_WS_HOST;
  const port = Number(stored.wsPort) || DEFAULT_WS_PORT;
  const auto = stored.autoConnect !== false;
  if (auto) {
    bridgeClient.connect(host, port);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({
    wsHost: DEFAULT_WS_HOST,
    wsPort: DEFAULT_WS_PORT,
    autoConnect: true,
  });
  void chrome.action.setBadgeText({ text: "OFF" });
  void chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
});

chrome.runtime.onStartup.addListener(() => {
  void autoConnect();
});

// Messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.channel !== "browser-mcp") return false;

  (async () => {
    switch (message.type) {
      case "get_status":
        sendResponse({
          ...bridgeClient.state,
          extensionId: chrome.runtime.id,
        });
        break;
      case "connect":
        bridgeClient.connect(
          message.host ?? DEFAULT_WS_HOST,
          Number(message.port ?? DEFAULT_WS_PORT),
        );
        await chrome.storage.local.set({
          wsHost: message.host ?? DEFAULT_WS_HOST,
          wsPort: Number(message.port ?? DEFAULT_WS_PORT),
          autoConnect: true,
        });
        sendResponse({ ok: true });
        break;
      case "disconnect":
        bridgeClient.disconnect();
        await chrome.storage.local.set({ autoConnect: false });
        sendResponse({ ok: true });
        break;
      case "content_ready":
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "unknown message type" });
    }
  })().catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true;
});

setupWatchdogAlarms();
setupNetworkLogging();
void autoConnect();

console.info("[BrowserMCP] service worker started");
