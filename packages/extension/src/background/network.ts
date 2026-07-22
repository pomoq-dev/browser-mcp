import type { NetworkInterceptRule } from "@browser-mcp/shared";

const KEY = "network_rules";
const LOG_KEY = "network_logs";

export interface NetworkLogEntry {
  ts: number;
  url: string;
  method: string;
  type?: string;
  statusCode?: number;
  action?: string;
}

export async function listRules(): Promise<NetworkInterceptRule[]> {
  const data = await chrome.storage.local.get(KEY);
  return (data[KEY] as NetworkInterceptRule[]) ?? [];
}

async function saveRules(rules: NetworkInterceptRule[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: rules });
  await applyDeclarativeRules(rules);
}

function ruleIdNum(id: string): number {
  // stable positive int from string
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1_000_000) + 1;
}

async function applyDeclarativeRules(
  rules: NetworkInterceptRule[],
): Promise<void> {
  // Clear existing dynamic rules we own (ids 1..1e6)
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map((r) => r.id);
  if (removeIds.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
    });
  }

  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.action === "block") {
      addRules.push({
        id: ruleIdNum(rule.id),
        priority: 1,
        action: { type: chrome.declarativeNetRequest.RuleActionType.BLOCK },
        condition: {
          urlFilter: rule.urlPattern,
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
            chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
            chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            chrome.declarativeNetRequest.ResourceType.SCRIPT,
            chrome.declarativeNetRequest.ResourceType.IMAGE,
            chrome.declarativeNetRequest.ResourceType.MEDIA,
            chrome.declarativeNetRequest.ResourceType.FONT,
            chrome.declarativeNetRequest.ResourceType.OTHER,
          ],
        },
      });
    }
    // mock is best-effort via redirect to data URL (limited)
    if (rule.action === "mock" && rule.mockResponse?.body !== undefined) {
      const body = rule.mockResponse.body;
      const dataUrl = `data:application/json,${encodeURIComponent(body)}`;
      addRules.push({
        id: ruleIdNum(rule.id),
        priority: 2,
        action: {
          type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
          redirect: { url: dataUrl },
        },
        condition: {
          urlFilter: rule.urlPattern,
          resourceTypes: [
            chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            chrome.declarativeNetRequest.ResourceType.OTHER,
          ],
        },
      });
    }
  }

  if (addRules.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules });
  }
}

export async function addRule(input: {
  urlPattern: string;
  action: "block" | "mock" | "log";
  mockResponse?: NetworkInterceptRule["mockResponse"];
}): Promise<NetworkInterceptRule> {
  const rule: NetworkInterceptRule = {
    id: `nr_${Date.now().toString(36)}`,
    urlPattern: input.urlPattern,
    action: input.action,
    mockResponse: input.mockResponse,
    enabled: true,
  };
  const rules = await listRules();
  rules.push(rule);
  await saveRules(rules);
  return rule;
}

export async function removeRule(ruleId: string): Promise<boolean> {
  const rules = await listRules();
  const next = rules.filter((r) => r.id !== ruleId);
  await saveRules(next);
  return next.length < rules.length;
}

export async function clearRules(): Promise<void> {
  await saveRules([]);
}

export async function pushNetworkLog(entry: NetworkLogEntry): Promise<void> {
  const data = await chrome.storage.local.get(LOG_KEY);
  const logs = (data[LOG_KEY] as NetworkLogEntry[]) ?? [];
  logs.push(entry);
  const trimmed = logs.slice(-500);
  await chrome.storage.local.set({ [LOG_KEY]: trimmed });
}

export async function getNetworkLogs(
  limit = 100,
  urlFilter?: string,
): Promise<NetworkLogEntry[]> {
  const data = await chrome.storage.local.get(LOG_KEY);
  let logs = (data[LOG_KEY] as NetworkLogEntry[]) ?? [];
  if (urlFilter) {
    logs = logs.filter((l) => l.url.includes(urlFilter));
  }
  return logs.slice(-limit);
}

export async function clearNetworkLogs(): Promise<void> {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

export function setupNetworkLogging(): void {
  // webRequest is limited in MV3; use webNavigation for high-level logs
  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    void pushNetworkLog({
      ts: Date.now(),
      url: details.url,
      method: "GET",
      type: "main_frame",
      statusCode: 200,
      action: "log",
    });
  });

  // re-apply rules on startup
  void listRules().then((rules) => applyDeclarativeRules(rules));
}
