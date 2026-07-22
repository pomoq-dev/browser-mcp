import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBridge } from "../bridge/extension-bridge.js";
import { execJsOnPage } from "../code-exec/page-exec.js";
import { runPlaywrightScript, runNodeScript } from "../code-exec/playwright-runner.js";
import {
  GetVisualStateSchema,
  GetDomTreeSchema,
  ClickSchema,
  TypeTextSchema,
  DragAndDropSchema,
  UploadFileSchema,
  ExecJsPageSchema,
  RunNodePlaywrightSchema,
  RunNodeScriptSchema,
  ManageCookiesSchema,
  ManageStorageSchema,
  InterceptNetworkSchema,
  ExtractDataSchema,
  GeneratePdfSchema,
  NavigateSchema,
  ScrollSchema,
  PressKeySchema,
  HoverSchema,
  SelectOptionSchema,
  WaitForSchema,
  RecordMacroStartSchema,
  RecordMacroStopSchema,
  ExecuteMacroSchema,
  RegisterWatchdogSchema,
  TabsSchema,
  ScreenshotSchema,
  toolResult,
  toolImageResult,
} from "./schemas.js";
import { z } from "zod";

function tabOpts(tabId?: number) {
  return tabId !== undefined ? { tabId } : {};
}

/**
 * Register the full Browser MCP tool catalog on an MCP server.
 */
export function registerAllTools(server: McpServer): void {
  // ── Status ──────────────────────────────────────────────────────────
  server.tool(
    "browser_status",
    "Check connection status between MCP server and Chrome extension",
    {},
    async () => toolResult(getBridge().status),
  );

  server.tool(
    "browser_get_events",
    "Drain recent extension events (watchdog matches, macro events, console errors)",
    {
      filter: z.string().optional().describe("Optional event name filter"),
    },
    async ({ filter }) => toolResult(getBridge().drainEvents(filter)),
  );

  // ── Tabs / Navigation ───────────────────────────────────────────────
  server.tool(
    "browser_get_tabs",
    "List open browser tabs",
    {},
    async () => {
      const result = await getBridge().sendRequest("get_tabs");
      return toolResult(result);
    },
  );

  server.tool(
    "browser_get_active_tab",
    "Get the currently active tab info",
    {},
    async () => {
      const result = await getBridge().sendRequest("get_active_tab");
      return toolResult(result);
    },
  );

  server.tool(
    "browser_navigate",
    "Navigate to a URL in the active or specified tab",
    NavigateSchema.shape,
    async (args) => {
      const parsed = NavigateSchema.parse(args);
      const result = await getBridge().sendRequest(
        "navigate",
        {
          url: parsed.url,
          newTab: parsed.new_tab,
          waitUntil: parsed.wait_until,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_go_back",
    "Navigate back in history",
    TabsSchema.shape,
    async (args) => {
      const parsed = TabsSchema.parse(args);
      const result = await getBridge().sendRequest(
        "go_back",
        {},
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_go_forward",
    "Navigate forward in history",
    TabsSchema.shape,
    async (args) => {
      const parsed = TabsSchema.parse(args);
      const result = await getBridge().sendRequest(
        "go_forward",
        {},
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_reload",
    "Reload the current page",
    TabsSchema.shape,
    async (args) => {
      const parsed = TabsSchema.parse(args);
      const result = await getBridge().sendRequest(
        "reload",
        {},
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_new_tab",
    "Open a new tab, optionally with a URL",
    {
      url: z.string().optional(),
    },
    async ({ url }) => {
      const result = await getBridge().sendRequest("new_tab", { url });
      return toolResult(result);
    },
  );

  server.tool(
    "browser_close_tab",
    "Close a tab by id (or active tab)",
    TabsSchema.shape,
    async (args) => {
      const parsed = TabsSchema.parse(args);
      const result = await getBridge().sendRequest(
        "close_tab",
        {},
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_switch_tab",
    "Activate a tab by id",
    {
      tab_id: z.number().int(),
    },
    async ({ tab_id }) => {
      const result = await getBridge().sendRequest("switch_tab", {}, {
        tabId: tab_id,
      });
      return toolResult(result);
    },
  );

  // ── Category 1: Vision / SOM ────────────────────────────────────────
  server.tool(
    "browser_get_visual_state",
    "Screenshot the page with Set-of-Mark numbered labels on interactive elements. Returns image + element map for vision models.",
    GetVisualStateSchema.shape,
    async (args) => {
      const parsed = GetVisualStateSchema.parse(args);
      const result = (await getBridge().sendRequest(
        "get_visual_state",
        {
          fullPage: parsed.full_page,
          drawLabels: parsed.draw_labels,
          elementTypes: parsed.element_types,
        },
        { ...tabOpts(parsed.tab_id), timeoutMs: 45_000 },
      )) as {
        screenshot: string;
        elements: unknown[];
        url: string;
        title: string;
        viewport: unknown;
      };

      return toolImageResult(
        result.screenshot,
        "image/png",
        {
          url: result.url,
          title: result.title,
          viewport: result.viewport,
          elementCount: Array.isArray(result.elements)
            ? result.elements.length
            : 0,
          elements: result.elements,
        },
      );
    },
  );

  server.tool(
    "browser_get_dom_tree",
    "Get a cleaned semantic DOM tree with selectors and XPaths (scripts/styles stripped)",
    GetDomTreeSchema.shape,
    async (args) => {
      const parsed = GetDomTreeSchema.parse(args);
      const result = await getBridge().sendRequest(
        "get_dom_tree",
        {
          maxDepth: parsed.max_depth,
          includeInvisible: parsed.include_invisible,
          selector: parsed.selector,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_screenshot",
    "Take a plain screenshot without SOM labels",
    ScreenshotSchema.shape,
    async (args) => {
      const parsed = ScreenshotSchema.parse(args);
      const result = (await getBridge().sendRequest(
        "screenshot",
        { fullPage: parsed.full_page },
        { ...tabOpts(parsed.tab_id), timeoutMs: 30_000 },
      )) as { screenshot: string; url?: string; title?: string };
      return toolImageResult(result.screenshot, "image/png", {
        url: result.url,
        title: result.title,
      });
    },
  );

  server.tool(
    "browser_get_page_info",
    "Get URL, title, readyState, scroll position, viewport size",
    TabsSchema.shape,
    async (args) => {
      const parsed = TabsSchema.parse(args);
      const result = await getBridge().sendRequest(
        "get_page_info",
        {},
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  // ── Category 2: Human-like interaction ──────────────────────────────
  server.tool(
    "browser_click",
    "Human-like click by som_id, CSS selector, xpath, or coordinates (Bezier mouse path)",
    ClickSchema.shape,
    async (args) => {
      const parsed = ClickSchema.parse(args);
      const result = await getBridge().sendRequest(
        "click",
        {
          target: parsed.target,
          clickType: parsed.click_type,
          modifiers: parsed.modifiers,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_type_text",
    "Type text into an input with human-like keystroke delays",
    TypeTextSchema.shape,
    async (args) => {
      const parsed = TypeTextSchema.parse(args);
      const result = await getBridge().sendRequest(
        "type_text",
        {
          target: parsed.target,
          text: parsed.text,
          clearFirst: parsed.clear_first,
          pressEnter: parsed.press_enter,
          delayMs: parsed.delay_ms,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_drag_and_drop",
    "Drag from source element/coords to target",
    DragAndDropSchema.shape,
    async (args) => {
      const parsed = DragAndDropSchema.parse(args);
      const result = await getBridge().sendRequest(
        "drag_and_drop",
        { source: parsed.source, target: parsed.target },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_upload_file",
    "Upload local file(s) into input[type=file]",
    UploadFileSchema.shape,
    async (args) => {
      const parsed = UploadFileSchema.parse(args);
      const result = await getBridge().sendRequest(
        "upload_file",
        {
          selector: parsed.selector,
          filePaths: parsed.file_paths,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_hover",
    "Hover over an element",
    HoverSchema.shape,
    async (args) => {
      const parsed = HoverSchema.parse(args);
      const result = await getBridge().sendRequest(
        "hover",
        { target: parsed.target },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_scroll",
    "Scroll the page or an element into view",
    ScrollSchema.shape,
    async (args) => {
      const parsed = ScrollSchema.parse(args);
      const result = await getBridge().sendRequest(
        "scroll",
        {
          direction: parsed.direction,
          amount: parsed.amount,
          target: parsed.target,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_press_key",
    "Press a keyboard key (with optional modifiers)",
    PressKeySchema.shape,
    async (args) => {
      const parsed = PressKeySchema.parse(args);
      const result = await getBridge().sendRequest(
        "press_key",
        {
          key: parsed.key,
          modifiers: parsed.modifiers,
          target: parsed.target,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_select_option",
    "Select option in a <select> by value, label, or index",
    SelectOptionSchema.shape,
    async (args) => {
      const parsed = SelectOptionSchema.parse(args);
      const result = await getBridge().sendRequest(
        "select_option",
        {
          target: parsed.target,
          value: parsed.value,
          label: parsed.label,
          index: parsed.index,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_wait_for",
    "Wait for selector, text, URL change, network idle, or timeout",
    WaitForSchema.shape,
    async (args) => {
      const parsed = WaitForSchema.parse(args);
      const result = await getBridge().sendRequest(
        "wait_for",
        {
          condition: parsed.condition,
          selector: parsed.selector,
          text: parsed.text,
          urlPattern: parsed.url_pattern,
          timeoutMs: parsed.timeout_ms,
        },
        { ...tabOpts(parsed.tab_id), timeoutMs: parsed.timeout_ms + 2000 },
      );
      return toolResult(result);
    },
  );

  // ── Category 3: Code execution ──────────────────────────────────────
  server.tool(
    "browser_exec_js_page",
    "Execute arbitrary JavaScript in the page context (window/DOM). Code is an async function body that may return a value.",
    ExecJsPageSchema.shape,
    async (args) => {
      const parsed = ExecJsPageSchema.parse(args);
      const result = await execJsOnPage(
        parsed.code,
        parsed.args,
        parsed.tab_id,
        parsed.timeout_ms,
      );
      return toolResult(result, !result.success);
    },
  );

  server.tool(
    "browser_run_node_playwright",
    "Run a Playwright script on the host connected to Chrome via CDP. Use getConnectedPage() or globals page/browser/context. Return a value for the result.",
    RunNodePlaywrightSchema.shape,
    async (args) => {
      const parsed = RunNodePlaywrightSchema.parse(args);
      const result = await runPlaywrightScript({
        script: parsed.script,
        timeoutMs: parsed.timeout_ms,
        cdpEndpoint: parsed.cdp_endpoint,
      });
      return toolResult(result, !result.success);
    },
  );

  server.tool(
    "browser_run_node_script",
    "Run arbitrary Node.js code in an isolated child process on the host (no browser). Return a value for the result.",
    RunNodeScriptSchema.shape,
    async (args) => {
      const parsed = RunNodeScriptSchema.parse(args);
      const result = await runNodeScript(parsed.script, parsed.timeout_ms);
      return toolResult(result, !result.success);
    },
  );

  // ── Category 4: Cookies / Storage / Network ─────────────────────────
  server.tool(
    "browser_manage_cookies",
    "Get, set, delete, clear, or export cookies for the browser profile",
    ManageCookiesSchema.shape,
    async (args) => {
      const parsed = ManageCookiesSchema.parse(args);
      const result = await getBridge().sendRequest(
        "manage_cookies",
        {
          action: parsed.action,
          cookieData: parsed.cookie_data,
          url: parsed.url,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_manage_storage",
    "Read/write/clear localStorage or sessionStorage",
    ManageStorageSchema.shape,
    async (args) => {
      const parsed = ManageStorageSchema.parse(args);
      const result = await getBridge().sendRequest(
        "manage_storage",
        {
          storageType: parsed.storage_type,
          action: parsed.action,
          key: parsed.key,
          value: parsed.value,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_intercept_network",
    "Add/remove/list/clear network intercept rules (block, mock, or log requests)",
    InterceptNetworkSchema.shape,
    async (args) => {
      const parsed = InterceptNetworkSchema.parse(args);
      const result = await getBridge().sendRequest("intercept_network", {
        action: parsed.action,
        ruleId: parsed.rule_id,
        urlPattern: parsed.url_pattern,
        interceptAction: parsed.intercept_action,
        mockResponse: parsed.mock_response,
      });
      return toolResult(result);
    },
  );

  server.tool(
    "browser_get_console_logs",
    "Get captured console logs from the page",
    {
      level: z.enum(["all", "log", "warn", "error", "info", "debug"]).optional(),
      limit: z.number().int().positive().optional().default(100),
      tab_id: z.number().int().optional(),
    },
    async ({ level, limit, tab_id }) => {
      const result = await getBridge().sendRequest(
        "get_console_logs",
        { level: level ?? "all", limit },
        tabOpts(tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_get_network_logs",
    "Get logged network requests (when intercept log rules are active or auto-logging is on)",
    {
      limit: z.number().int().positive().optional().default(100),
      url_filter: z.string().optional(),
    },
    async ({ limit, url_filter }) => {
      const result = await getBridge().sendRequest("get_network_logs", {
        limit,
        urlFilter: url_filter,
      });
      return toolResult(result);
    },
  );

  // ── Category 5: Extract / PDF ───────────────────────────────────────
  server.tool(
    "browser_extract_data",
    "Extract structured data from the page using a CSS-selector schema. Supports json/csv/markdown output.",
    ExtractDataSchema.shape,
    async (args) => {
      const parsed = ExtractDataSchema.parse(args);
      const result = await getBridge().sendRequest(
        "extract_data",
        {
          schema: parsed.schema,
          outputFormat: parsed.output_format,
          multiple: parsed.multiple,
          containerSelector: parsed.container_selector,
        },
        tabOpts(parsed.tab_id),
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_generate_pdf",
    "Save the current page (or a selector region via print) as PDF (base64)",
    GeneratePdfSchema.shape,
    async (args) => {
      const parsed = GeneratePdfSchema.parse(args);
      const result = await getBridge().sendRequest(
        "generate_pdf",
        {
          selector: parsed.selector,
          landscape: parsed.landscape,
          printBackground: parsed.print_background,
        },
        { ...tabOpts(parsed.tab_id), timeoutMs: 60_000 },
      );
      return toolResult(result);
    },
  );

  // ── Category 6: Macros ──────────────────────────────────────────────
  server.tool(
    "browser_record_macro_start",
    "Start recording user actions (clicks, typing, navigation) for learning-from-demonstration",
    RecordMacroStartSchema.shape,
    async (args) => {
      const parsed = RecordMacroStartSchema.parse(args);
      const result = await getBridge().sendRequest("record_macro_start", {
        name: parsed.name,
      });
      return toolResult(result);
    },
  );

  server.tool(
    "browser_record_macro_stop",
    "Stop macro recording; returns actions and optionally a generated replay script",
    RecordMacroStopSchema.shape,
    async (args) => {
      const parsed = RecordMacroStopSchema.parse(args);
      const result = await getBridge().sendRequest("record_macro_stop", {
        name: parsed.name,
        generateScript: parsed.generate_script,
      });
      return toolResult(result);
    },
  );

  server.tool(
    "browser_list_macros",
    "List saved macros",
    {},
    async () => {
      const result = await getBridge().sendRequest("list_macros");
      return toolResult(result);
    },
  );

  server.tool(
    "browser_execute_macro",
    "Replay a saved macro with optional variable substitution",
    ExecuteMacroSchema.shape,
    async (args) => {
      const parsed = ExecuteMacroSchema.parse(args);
      const result = await getBridge().sendRequest(
        "execute_macro",
        {
          macroId: parsed.macro_id,
          variables: parsed.variables,
        },
        { ...tabOpts(parsed.tab_id), timeoutMs: 120_000 },
      );
      return toolResult(result);
    },
  );

  server.tool(
    "browser_delete_macro",
    "Delete a saved macro by id",
    {
      macro_id: z.string().min(1),
    },
    async ({ macro_id }) => {
      const result = await getBridge().sendRequest("delete_macro", {
        macroId: macro_id,
      });
      return toolResult(result);
    },
  );

  // ── Category 7: Watchdogs ───────────────────────────────────────────
  server.tool(
    "browser_register_watchdog",
    "Register a background watchdog that polls a URL/condition and fires actions on match",
    RegisterWatchdogSchema.shape,
    async (args) => {
      const parsed = RegisterWatchdogSchema.parse(args);
      const result = await getBridge().sendRequest("register_watchdog", {
        name: parsed.name,
        url: parsed.url,
        intervalSec: parsed.interval_sec,
        condition: parsed.condition,
        actionOnMatch: parsed.action_on_match,
      });
      return toolResult(result);
    },
  );

  server.tool(
    "browser_list_watchdogs",
    "List registered watchdogs and their status",
    {},
    async () => {
      const result = await getBridge().sendRequest("list_watchdogs");
      return toolResult(result);
    },
  );

  server.tool(
    "browser_remove_watchdog",
    "Remove a watchdog by id",
    {
      watchdog_id: z.string().min(1),
    },
    async ({ watchdog_id }) => {
      const result = await getBridge().sendRequest("remove_watchdog", {
        watchdogId: watchdog_id,
      });
      return toolResult(result);
    },
  );
}
