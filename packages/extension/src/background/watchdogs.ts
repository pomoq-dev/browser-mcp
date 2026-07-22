import type { Watchdog, WatchdogCondition } from "@browser-mcp/shared";
import { bridgeClient } from "./ws-client.js";
import { sendToContent } from "./tabs.js";

const KEY = "watchdogs";
const ALARM_PREFIX = "watchdog:";

function id(): string {
  return `wd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function listWatchdogs(): Promise<Watchdog[]> {
  const data = await chrome.storage.local.get(KEY);
  return (data[KEY] as Watchdog[]) ?? [];
}

async function saveAll(watchdogs: Watchdog[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: watchdogs });
}

export async function registerWatchdog(input: {
  name?: string;
  url: string;
  intervalSec: number;
  condition: WatchdogCondition;
  actionOnMatch: Watchdog["actionOnMatch"];
}): Promise<Watchdog> {
  const wd: Watchdog = {
    id: id(),
    name: input.name,
    url: input.url,
    intervalSec: Math.max(5, input.intervalSec),
    condition: input.condition,
    actionOnMatch: input.actionOnMatch,
    enabled: true,
    matchCount: 0,
    createdAt: Date.now(),
  };
  const all = await listWatchdogs();
  all.push(wd);
  await saveAll(all);
  await chrome.alarms.create(ALARM_PREFIX + wd.id, {
    periodInMinutes: Math.max(0.5, wd.intervalSec / 60),
    delayInMinutes: 0.05,
  });
  return wd;
}

export async function removeWatchdog(watchdogId: string): Promise<boolean> {
  const all = await listWatchdogs();
  const next = all.filter((w) => w.id !== watchdogId);
  await saveAll(next);
  await chrome.alarms.clear(ALARM_PREFIX + watchdogId);
  return next.length < all.length;
}

export async function evaluateCondition(
  tabId: number,
  condition: WatchdogCondition,
): Promise<boolean> {
  switch (condition.type) {
    case "selector_exists":
      return Boolean(
        await sendToContent(tabId, "exec_js", {
          code: `return !!document.querySelector(${JSON.stringify(condition.selector)});`,
        }).then((r: unknown) => (r as { result?: boolean }).result)
          .catch(() => false),
      );
    case "selector_missing":
      return Boolean(
        await sendToContent(tabId, "exec_js", {
          code: `return !document.querySelector(${JSON.stringify(condition.selector)});`,
        }).then((r: unknown) => (r as { result?: boolean }).result)
          .catch(() => true),
      );
    case "text_contains":
      return Boolean(
        await sendToContent(tabId, "exec_js", {
          code: `const root = ${condition.selector ? `document.querySelector(${JSON.stringify(condition.selector)})` : "document.body"}; return (root?.innerText || "").includes(${JSON.stringify(condition.text)});`,
        }).then((r: unknown) => (r as { result?: boolean }).result)
          .catch(() => false),
      );
    case "js_condition":
      return Boolean(
        await sendToContent(tabId, "exec_js", {
          code: condition.code,
        }).then((r: unknown) => (r as { result?: boolean }).result)
          .catch(() => false),
      );
    case "url_matches": {
      const tab = await chrome.tabs.get(tabId);
      return new RegExp(condition.pattern).test(tab.url ?? "");
    }
    default:
      return false;
  }
}

export async function runWatchdog(watchdogId: string): Promise<void> {
  const all = await listWatchdogs();
  const wd = all.find((w) => w.id === watchdogId);
  if (!wd || !wd.enabled) return;

  let tab = (await chrome.tabs.query({ url: wd.url })).find((t) => t.id);
  if (!tab?.id) {
    // try prefix match
    const tabs = await chrome.tabs.query({});
    tab = tabs.find((t) => t.url?.startsWith(wd.url.split("?")[0]!));
  }
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: wd.url, active: false });
    // wait for load
    await new Promise<void>((resolve) => {
      const listener = (
        tabId: number,
        info: chrome.tabs.TabChangeInfo,
      ) => {
        if (tabId === tab!.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15_000);
    });
  }

  const tabId = tab.id!;
  wd.lastCheck = Date.now();

  const matched = await evaluateCondition(tabId, wd.condition);
  if (matched) {
    wd.lastMatch = Date.now();
    wd.matchCount++;
    const eventName = wd.actionOnMatch.trigger_mcp_event ?? "WATCHDOG_MATCH";
    bridgeClient.emitEvent(eventName, {
      watchdogId: wd.id,
      name: wd.name,
      url: wd.url,
      condition: wd.condition,
      matchCount: wd.matchCount,
    });

    if (wd.actionOnMatch.notify) {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "BrowserMCP Watchdog",
        message: `Condition matched: ${wd.name ?? wd.id} on ${wd.url}`,
      });
    }
    if (wd.actionOnMatch.exec_js) {
      await sendToContent(tabId, "exec_js", {
        code: wd.actionOnMatch.exec_js,
      }).catch(() => {});
    }
    if (wd.actionOnMatch.click_selector) {
      await sendToContent(tabId, "click", {
        target: { selector: wd.actionOnMatch.click_selector },
        clickType: "left",
        modifiers: [],
      }).catch(() => {});
    }
  }

  const idx = all.findIndex((w) => w.id === wd.id);
  if (idx >= 0) all[idx] = wd;
  await saveAll(all);
}

export function setupWatchdogAlarms(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(ALARM_PREFIX)) {
      const id = alarm.name.slice(ALARM_PREFIX.length);
      void runWatchdog(id);
    }
  });

  // rehydrate alarms on SW start
  void listWatchdogs().then((all) => {
    for (const wd of all) {
      if (!wd.enabled) continue;
      void chrome.alarms.create(ALARM_PREFIX + wd.id, {
        periodInMinutes: Math.max(0.5, wd.intervalSec / 60),
      });
    }
  });
}
