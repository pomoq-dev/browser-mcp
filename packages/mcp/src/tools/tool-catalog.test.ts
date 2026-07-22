import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./register-tools.js";

/** Expected tool names from the TZ catalog + helpers */
const EXPECTED_TOOLS = [
  "browser_status",
  "browser_get_events",
  "browser_get_tabs",
  "browser_get_active_tab",
  "browser_navigate",
  "browser_go_back",
  "browser_go_forward",
  "browser_reload",
  "browser_new_tab",
  "browser_close_tab",
  "browser_switch_tab",
  "browser_get_visual_state",
  "browser_get_dom_tree",
  "browser_screenshot",
  "browser_get_page_info",
  "browser_click",
  "browser_type_text",
  "browser_drag_and_drop",
  "browser_upload_file",
  "browser_hover",
  "browser_scroll",
  "browser_press_key",
  "browser_select_option",
  "browser_wait_for",
  "browser_exec_js_page",
  "browser_run_node_playwright",
  "browser_run_node_script",
  "browser_manage_cookies",
  "browser_manage_storage",
  "browser_intercept_network",
  "browser_get_console_logs",
  "browser_get_network_logs",
  "browser_extract_data",
  "browser_generate_pdf",
  "browser_record_macro_start",
  "browser_record_macro_stop",
  "browser_list_macros",
  "browser_execute_macro",
  "browser_delete_macro",
  "browser_register_watchdog",
  "browser_list_watchdogs",
  "browser_remove_watchdog",
];

describe("tool catalog", () => {
  it("registers all expected tools", () => {
    const server = new McpServer({
      name: "test",
      version: "0.0.0",
    });
    registerAllTools(server);

    // Access private registered tools via internal structure
    // MCP SDK stores tools on _registeredTools
    const registered = (
      server as unknown as {
        _registeredTools?: Record<string, unknown>;
      }
    )._registeredTools;

    assert.ok(registered, "server should have _registeredTools");
    const names = Object.keys(registered);
    for (const tool of EXPECTED_TOOLS) {
      assert.ok(names.includes(tool), `missing tool: ${tool}`);
    }
    assert.equal(
      names.length,
      EXPECTED_TOOLS.length,
      `expected ${EXPECTED_TOOLS.length} tools, got ${names.length}: ${names.join(", ")}`,
    );
  });
});
