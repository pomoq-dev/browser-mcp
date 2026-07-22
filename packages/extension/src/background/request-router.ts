import type { BridgeRequest } from "@browser-mcp/shared";
import {
  getActiveTab,
  listTabs,
  resolveTabId,
  sendToContent,
} from "./tabs.js";
import {
  createMacro,
  deleteMacro,
  getMacro,
  listMacros,
} from "./macros-store.js";
import {
  listWatchdogs,
  registerWatchdog,
  removeWatchdog,
} from "./watchdogs.js";
import {
  addRule,
  clearNetworkLogs,
  clearRules,
  getNetworkLogs,
  listRules,
  removeRule,
} from "./network.js";
import type { WatchdogCondition } from "@browser-mcp/shared";

async function captureScreenshot(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  return dataUrl;
}

async function attachDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (err) {
    const msg = String(err);
    if (!msg.includes("Already attached")) throw err;
  }
}

async function detachDebugger(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* ignore */
  }
}

export async function routeRequest(request: BridgeRequest): Promise<unknown> {
  const p = request.payload ?? {};
  const type = request.type;

  switch (type) {
    case "ping":
      return { pong: true, extensionId: chrome.runtime.id };

    case "get_tabs":
      return { tabs: await listTabs() };

    case "get_active_tab": {
      const tab = await getActiveTab();
      return {
        id: tab.id,
        url: tab.url,
        title: tab.title,
        status: tab.status,
      };
    }

    case "navigate": {
      const tabId = await resolveTabId(request.tabId);
      if (p.newTab) {
        const tab = await chrome.tabs.create({ url: String(p.url) });
        return { id: tab.id, url: tab.url };
      }
      await chrome.tabs.update(tabId, { url: String(p.url) });
      return { id: tabId, url: p.url };
    }

    case "go_back": {
      const tabId = await resolveTabId(request.tabId);
      await chrome.tabs.goBack(tabId);
      return { ok: true };
    }

    case "go_forward": {
      const tabId = await resolveTabId(request.tabId);
      await chrome.tabs.goForward(tabId);
      return { ok: true };
    }

    case "reload": {
      const tabId = await resolveTabId(request.tabId);
      await chrome.tabs.reload(tabId);
      return { ok: true };
    }

    case "new_tab": {
      const tab = await chrome.tabs.create({
        url: p.url ? String(p.url) : "about:blank",
      });
      return { id: tab.id, url: tab.url };
    }

    case "close_tab": {
      const tabId = await resolveTabId(request.tabId);
      await chrome.tabs.remove(tabId);
      return { ok: true };
    }

    case "switch_tab": {
      const tabId = await resolveTabId(request.tabId);
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, id: tabId };
    }

    case "get_visual_state": {
      const tabId = await resolveTabId(request.tabId);
      const contentResult = await sendToContent<{
        elements: unknown[];
        url: string;
        title: string;
        viewport: unknown;
        keepOverlay?: boolean;
      }>(tabId, "get_visual_state", p);

      // brief delay for overlay paint
      await new Promise((r) => setTimeout(r, 60));
      const screenshot = await captureScreenshot(tabId);

      if (contentResult.keepOverlay) {
        // clear overlay after capture so page isn't permanently dirty
        await sendToContent(tabId, "clear_som", {});
      }

      return {
        screenshot,
        elements: contentResult.elements,
        url: contentResult.url,
        title: contentResult.title,
        viewport: contentResult.viewport,
      };
    }

    case "screenshot": {
      const tabId = await resolveTabId(request.tabId);
      const tab = await chrome.tabs.get(tabId);
      const screenshot = await captureScreenshot(tabId);
      return { screenshot, url: tab.url, title: tab.title };
    }

    case "get_dom_tree":
    case "click":
    case "type_text":
    case "press_key":
    case "scroll":
    case "hover":
    case "drag_and_drop":
    case "select_option":
    case "get_page_info":
    case "extract_data":
    case "wait_for":
    case "get_console_logs": {
      const tabId = await resolveTabId(request.tabId);
      return sendToContent(tabId, type, p);
    }

    case "exec_js": {
      const tabId = await resolveTabId(request.tabId);
      const result = await sendToContent<{
        success: boolean;
        result?: unknown;
        error?: string;
        stack?: string;
      }>(tabId, "exec_js", p);
      if (!result.success) {
        const err = new Error(result.error ?? "exec_js failed");
        err.stack = result.stack;
        throw err;
      }
      return result.result;
    }

    case "manage_storage": {
      const tabId = await resolveTabId(request.tabId);
      return sendToContent(tabId, "manage_storage", p);
    }

    case "manage_cookies": {
      const action = String(p.action);
      const cookieData = (p.cookieData ?? {}) as chrome.cookies.SetDetails & {
        name?: string;
      };
      const url =
        (p.url as string | undefined) ??
        (await getActiveTab()).url ??
        undefined;

      if (action === "get") {
        if (cookieData.name && url) {
          const c = await chrome.cookies.get({
            url,
            name: cookieData.name,
          });
          return { cookie: c };
        }
        const cookies = await chrome.cookies.getAll(url ? { url } : {});
        return { cookies };
      }
      if (action === "export_all") {
        const cookies = await chrome.cookies.getAll({});
        return { cookies, count: cookies.length };
      }
      if (action === "set") {
        if (!url && !cookieData.url) throw new Error("url required to set cookie");
        const details: chrome.cookies.SetDetails = {
          url: cookieData.url ?? url!,
          name: cookieData.name!,
          value: cookieData.value ?? "",
          domain: cookieData.domain,
          path: cookieData.path,
          secure: cookieData.secure,
          httpOnly: cookieData.httpOnly,
          expirationDate: cookieData.expirationDate,
          sameSite: cookieData.sameSite as chrome.cookies.SameSiteStatus,
        };
        const c = await chrome.cookies.set(details);
        return { cookie: c };
      }
      if (action === "delete") {
        if (!cookieData.name) throw new Error("name required");
        const c = await chrome.cookies.remove({
          url: cookieData.url ?? url!,
          name: cookieData.name,
        });
        return { removed: c };
      }
      if (action === "clear") {
        const cookies = await chrome.cookies.getAll(url ? { url } : {});
        for (const c of cookies) {
          const cookieUrl = `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path}`;
          await chrome.cookies.remove({ url: cookieUrl, name: c.name });
        }
        return { cleared: cookies.length };
      }
      throw new Error(`Unknown cookie action: ${action}`);
    }

    case "intercept_network": {
      const action = String(p.action);
      if (action === "list") return { rules: await listRules() };
      if (action === "clear") {
        await clearRules();
        return { ok: true };
      }
      if (action === "remove") {
        const ok = await removeRule(String(p.ruleId));
        return { ok };
      }
      if (action === "add") {
        const rule = await addRule({
          urlPattern: String(p.urlPattern),
          action: (p.interceptAction as "block" | "mock" | "log") ?? "log",
          mockResponse: p.mockResponse as
            | { status?: number; headers?: Record<string, string>; body?: string }
            | undefined,
        });
        return { rule };
      }
      throw new Error(`Unknown intercept action: ${action}`);
    }

    case "get_network_logs":
      return {
        logs: await getNetworkLogs(
          (p.limit as number) ?? 100,
          p.urlFilter as string | undefined,
        ),
      };

    case "clear_network_logs":
      await clearNetworkLogs();
      return { ok: true };

    case "upload_file": {
      const tabId = await resolveTabId(request.tabId);
      const selector = String(p.selector);
      const filePaths = p.filePaths as string[];
      // Chrome extension cannot read arbitrary host files without native host.
      // We use debugger DOM.setFileInputFiles which accepts paths when Chrome
      // is run with appropriate access (local automation / CDP).
      await sendToContent(tabId, "upload_file_hint", { selector });
      await attachDebugger(tabId);
      try {
        const { root } = (await chrome.debugger.sendCommand(
          { tabId },
          "DOM.getDocument",
          {},
        )) as { root: { nodeId: number } };
        const { nodeId } = (await chrome.debugger.sendCommand(
          { tabId },
          "DOM.querySelector",
          { nodeId: root.nodeId, selector },
        )) as { nodeId: number };
        if (!nodeId) throw new Error(`Element not found: ${selector}`);
        await chrome.debugger.sendCommand(
          { tabId },
          "DOM.setFileInputFiles",
          { nodeId, files: filePaths },
        );
        return { ok: true, files: filePaths };
      } finally {
        await detachDebugger(tabId);
      }
    }

    case "generate_pdf": {
      const tabId = await resolveTabId(request.tabId);
      await attachDebugger(tabId);
      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.enable");
        const result = (await chrome.debugger.sendCommand(
          { tabId },
          "Page.printToPDF",
          {
            landscape: Boolean(p.landscape),
            printBackground: p.printBackground !== false,
            preferCSSPageSize: true,
          },
        )) as { data: string };
        return {
          pdfBase64: result.data,
          mimeType: "application/pdf",
        };
      } finally {
        await detachDebugger(tabId);
      }
    }

    case "record_macro_start": {
      const tabId = await resolveTabId(request.tabId);
      await sendToContent(tabId, "record_macro_start", p);
      await chrome.storage.session.set({
        recording: true,
        recordingName: p.name ?? `macro_${Date.now()}`,
      });
      return { ok: true, recording: true };
    }

    case "record_macro_stop": {
      const tabId = await resolveTabId(request.tabId);
      const result = await sendToContent<{
        actions: unknown[];
        generatedScript?: string;
        count: number;
      }>(tabId, "record_macro_stop", p);
      const session = await chrome.storage.session.get([
        "recordingName",
      ]);
      const name =
        (p.name as string) ||
        (session.recordingName as string) ||
        `macro_${Date.now()}`;
      const macro = await createMacro(
        name,
        result.actions as never,
        result.generatedScript,
      );
      await chrome.storage.session.set({ recording: false });
      return { macro, actionCount: result.count };
    }

    case "list_macros":
      return { macros: await listMacros() };

    case "delete_macro":
      return { ok: await deleteMacro(String(p.macroId)) };

    case "execute_macro": {
      const macro = await getMacro(String(p.macroId));
      if (!macro) throw new Error(`Macro not found: ${p.macroId}`);
      const tabId = await resolveTabId(request.tabId);
      const variables = (p.variables as Record<string, string>) ?? {};
      const results: unknown[] = [];
      for (const action of macro.actions) {
        let selector = action.selector;
        let value = action.value;
        // simple {{var}} substitution
        if (value) {
          value = value.replace(/\{\{(\w+)\}\}/g, (_, k) => variables[k] ?? "");
        }
        if (action.type === "navigate" && action.url) {
          await chrome.tabs.update(tabId, { url: action.url });
          await new Promise((r) => setTimeout(r, 800));
          results.push({ type: "navigate", url: action.url });
        } else if (action.type === "click" && selector) {
          results.push(
            await sendToContent(tabId, "click", {
              target: { selector },
              clickType: "left",
              modifiers: [],
            }),
          );
        } else if (action.type === "type" && selector) {
          results.push(
            await sendToContent(tabId, "type_text", {
              target: { selector },
              text: value ?? "",
              clearFirst: true,
              pressEnter: false,
              delayMs: 20,
            }),
          );
        } else if (action.type === "keydown" && action.key) {
          results.push(
            await sendToContent(tabId, "press_key", {
              key: action.key,
              modifiers: [],
            }),
          );
        } else if (action.type === "scroll" && action.coordinates) {
          results.push(
            await sendToContent(tabId, "scroll", {
              direction: "down",
              amount: action.coordinates.y,
            }),
          );
        }
      }
      return { ok: true, steps: results.length, results };
    }

    case "register_watchdog": {
      const wd = await registerWatchdog({
        name: p.name as string | undefined,
        url: String(p.url),
        intervalSec: Number(p.intervalSec ?? 60),
        condition: p.condition as WatchdogCondition,
        actionOnMatch: (p.actionOnMatch as never) ?? { notify: true },
      });
      return { watchdog: wd };
    }

    case "list_watchdogs":
      return { watchdogs: await listWatchdogs() };

    case "remove_watchdog":
      return { ok: await removeWatchdog(String(p.watchdogId)) };

    default:
      throw new Error(`Unhandled request type: ${type}`);
  }
}
