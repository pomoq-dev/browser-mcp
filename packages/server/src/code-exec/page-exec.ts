import { getBridge } from "../bridge/extension-bridge.js";

export interface ExecJsResult {
  success: boolean;
  result?: unknown;
  error?: string;
  stack?: string;
}

/**
 * Execute arbitrary JS in the active page context via the extension.
 */
export async function execJsOnPage(
  code: string,
  args: unknown[] = [],
  tabId?: number,
  timeoutMs = 30_000,
): Promise<ExecJsResult> {
  try {
    const result = await getBridge().sendRequest(
      "exec_js",
      { code, args },
      { tabId, timeoutMs },
    );
    return { success: true, result };
  } catch (err) {
    const e = err as Error;
    return {
      success: false,
      error: e.message,
      stack: e.stack,
    };
  }
}
