/**
 * Content script — executes in page isolated world, handles DOM ops for MCP tools.
 */
import type { ElementTarget } from "@browser-mcp/shared";
import {
  applySomLabels,
  removeSomOverlay,
  buildDomTree,
  getSomMap,
} from "./som.js";
import {
  humanClick,
  humanType,
  humanPressKey,
  humanHover,
  humanDragDrop,
  humanScroll,
  humanSelectOption,
  pageInfo,
} from "./human-input.js";
import { extractData } from "./extract.js";
import {
  startRecording,
  stopRecording,
  isRecording,
  generateReplayScript,
} from "./recorder.js";
import { resolveTarget, sleep } from "./dom-utils.js";

const consoleLogs: Array<{
  level: string;
  message: string;
  ts: number;
}> = [];

// Capture console via page hook is limited in isolated world; store messages we receive
function pushLog(level: string, message: string) {
  consoleLogs.push({ level, message, ts: Date.now() });
  if (consoleLogs.length > 500) consoleLogs.shift();
}

type ContentRequest = {
  id: string;
  action: string;
  payload?: Record<string, unknown>;
};

async function handleAction(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  switch (action) {
    case "ping":
      return { pong: true, href: location.href };

    case "get_visual_state": {
      const elementTypes = (payload.elementTypes as string[]) ?? undefined;
      const drawLabels = payload.drawLabels !== false;
      let elements;
      if (drawLabels) {
        ({ elements } = applySomLabels(elementTypes));
        // allow paint
        await sleep(50);
      } else {
        ({ elements } = applySomLabels(elementTypes));
        removeSomOverlay();
      }
      return {
        elements,
        url: location.href,
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        // screenshot is taken by background via captureVisibleTab
        needsScreenshot: true,
        keepOverlay: drawLabels,
      };
    }

    case "clear_som":
      removeSomOverlay();
      return { ok: true };

    case "get_dom_tree": {
      const rootSel = payload.selector as string | undefined;
      const root = rootSel
        ? document.querySelector(rootSel) ?? document.body
        : document.body;
      const tree = buildDomTree(
        root as Element,
        (payload.maxDepth as number) ?? 12,
        Boolean(payload.includeInvisible),
      );
      return { url: location.href, title: document.title, tree };
    }

    case "click":
      return humanClick(
        payload.target as ElementTarget,
        (payload.clickType as "left") ?? "left",
        (payload.modifiers as string[]) ?? [],
      );

    case "type_text":
      return humanType(payload.target as ElementTarget, String(payload.text ?? ""), {
        clearFirst: payload.clearFirst !== false,
        pressEnter: Boolean(payload.pressEnter),
        delayMs: (payload.delayMs as number) ?? 30,
      });

    case "press_key":
      return humanPressKey(
        String(payload.key),
        (payload.modifiers as string[]) ?? [],
        payload.target as ElementTarget | undefined,
      );

    case "hover":
      return humanHover(payload.target as ElementTarget);

    case "drag_and_drop":
      return humanDragDrop(
        payload.source as ElementTarget,
        payload.target as ElementTarget,
      );

    case "scroll":
      return humanScroll({
        direction: payload.direction as string | undefined,
        amount: payload.amount as number | undefined,
        target: payload.target as ElementTarget | undefined,
      });

    case "select_option":
      return humanSelectOption(payload.target as ElementTarget, {
        value: payload.value as string | undefined,
        label: payload.label as string | undefined,
        index: payload.index as number | undefined,
      });

    case "exec_js": {
      const code = String(payload.code ?? "");
      const args = (payload.args as unknown[]) ?? [];
      // Wrap user code as async function body
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (...args: unknown[]) => Promise<unknown>;
      try {
        const fn = new AsyncFunction(
          ...args.map((_, i) => `arg${i}`),
          `"use strict";\n${code}`,
        );
        const result = await fn(...args);
        return { success: true, result: sanitize(result) };
      } catch (err) {
        const e = err as Error;
        return {
          success: false,
          error: e.message,
          stack: e.stack,
        };
      }
    }

    case "get_page_info":
      return pageInfo();

    case "manage_storage": {
      const storage =
        payload.storageType === "session" ? sessionStorage : localStorage;
      const act = payload.action as string;
      if (act === "get") return { value: storage.getItem(String(payload.key)) };
      if (act === "set") {
        storage.setItem(String(payload.key), String(payload.value ?? ""));
        return { ok: true };
      }
      if (act === "remove") {
        storage.removeItem(String(payload.key));
        return { ok: true };
      }
      if (act === "clear") {
        storage.clear();
        return { ok: true };
      }
      if (act === "get_all") {
        const all: Record<string, string> = {};
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k) all[k] = storage.getItem(k) ?? "";
        }
        return { data: all };
      }
      throw new Error(`Unknown storage action: ${act}`);
    }

    case "extract_data":
      return {
        data: extractData(payload.schema as Record<string, unknown>, {
          multiple: Boolean(payload.multiple),
          containerSelector: payload.containerSelector as string | undefined,
          outputFormat: (payload.outputFormat as "json") ?? "json",
        }),
      };

    case "record_macro_start":
      return startRecording();

    case "record_macro_stop": {
      const acts = stopRecording();
      const generateScript = payload.generateScript !== false;
      return {
        actions: acts,
        generatedScript: generateScript ? generateReplayScript(acts) : undefined,
        count: acts.length,
      };
    }

    case "is_recording":
      return { recording: isRecording() };

    case "wait_for": {
      const condition = payload.condition as string;
      const timeoutMs = (payload.timeoutMs as number) ?? 15_000;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (condition === "timeout") {
          await sleep(timeoutMs);
          return { ok: true };
        }
        if (condition === "selector" && payload.selector) {
          if (document.querySelector(String(payload.selector))) {
            return { ok: true, elapsed: Date.now() - start };
          }
        }
        if (condition === "text" && payload.text) {
          if (document.body.innerText.includes(String(payload.text))) {
            return { ok: true, elapsed: Date.now() - start };
          }
        }
        if (condition === "url" && payload.urlPattern) {
          const re = new RegExp(String(payload.urlPattern));
          if (re.test(location.href)) {
            return { ok: true, url: location.href, elapsed: Date.now() - start };
          }
        }
        if (condition === "network_idle") {
          // best-effort: wait a bit after load
          if (document.readyState === "complete") {
            await sleep(500);
            return { ok: true, elapsed: Date.now() - start };
          }
        }
        await sleep(100);
      }
      throw new Error(`wait_for timed out: ${condition}`);
    }

    case "get_console_logs": {
      const level = (payload.level as string) ?? "all";
      const limit = (payload.limit as number) ?? 100;
      let logs = consoleLogs;
      if (level !== "all") logs = logs.filter((l) => l.level === level);
      return { logs: logs.slice(-limit) };
    }

    case "resolve_target": {
      const r = resolveTarget(payload.target as ElementTarget, getSomMap());
      return {
        found: Boolean(r.element),
        x: r.x,
        y: r.y,
        tag: r.element?.tagName,
      };
    }

    case "upload_file_hint":
      // Actual file upload requires debugger API from background;
      // content script can only focus the input.
      {
        const sel = String(payload.selector);
        const input = document.querySelector(sel);
        if (!(input instanceof HTMLInputElement) || input.type !== "file") {
          throw new Error(`File input not found: ${sel}`);
        }
        input.focus();
        return { ok: true, needsDebuggerUpload: true, selector: sel };
      }

    default:
      throw new Error(`Unknown content action: ${action}`);
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Element) {
    return {
      tag: value.tagName,
      id: value.id || undefined,
      text: (value.textContent || "").trim().slice(0, 100),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [k, v] of Object.entries(value as object)) {
      if (i++ > 100) {
        out["..."] = "truncated";
        break;
      }
      try {
        out[k] = sanitize(v, depth + 1);
      } catch {
        out[k] = "[Unserializable]";
      }
    }
    return out;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.channel !== "browser-mcp-content") return false;
  const req = message as ContentRequest & { channel: string };
  handleAction(req.action, req.payload ?? {})
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err: Error) =>
      sendResponse({
        ok: false,
        error: err.message,
        stack: err.stack,
      }),
    );
  return true; // async
});

// Notify background that content script is ready
chrome.runtime.sendMessage({ channel: "browser-mcp", type: "content_ready", url: location.href }).catch(() => {});

pushLog("info", `BrowserMCP content script loaded on ${location.href}`);
