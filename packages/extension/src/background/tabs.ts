export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return tab;
}

export async function resolveTabId(tabId?: number): Promise<number> {
  if (tabId !== undefined) return tabId;
  const tab = await getActiveTab();
  return tab.id!;
}

export async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
    windowId: t.windowId,
    status: t.status,
    pinned: t.pinned,
  }));
}

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      channel: "browser-mcp-content",
      id: "ping",
      action: "ping",
    });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    // small wait for listener attach
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function sendToContent<T = unknown>(
  tabId: number,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  await ensureContentScript(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    channel: "browser-mcp-content",
    id: `${Date.now()}`,
    action,
    payload,
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "Content script error");
  }
  return response.result as T;
}
