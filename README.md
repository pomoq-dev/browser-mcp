# BrowserMCP NextGen

Autonomous AI browser employee: **MCP server + Chrome extension** with vision (Set-of-Mark), human-like input, page/host code execution, macros, and background watchdogs.

```
┌────────────────────┐   MCP stdio    ┌─────────────────────┐
│  AI Agent          │ ─────────────► │  MCP Server (Node)  │
│  Claude / Cursor   │ ◄───────────── │  + code sandbox     │
└────────────────────┘                └──────────┬──────────┘
                                                 │ WebSocket :17373
                                                 ▼
                                      ┌─────────────────────┐
                                      │  Chrome Extension   │
                                      │  SOM · DOM · CDP    │
                                      └─────────────────────┘
```

## Features

| Category | Tools |
|----------|--------|
| **Vision / SOM** | `browser_get_visual_state`, `browser_get_dom_tree`, `browser_screenshot` |
| **Human-like UI** | `browser_click`, `browser_type_text`, `browser_drag_and_drop`, `browser_hover`, `browser_scroll`, `browser_press_key`, `browser_select_option`, `browser_upload_file` |
| **Code execution** | `browser_exec_js_page`, `browser_run_node_playwright`, `browser_run_node_script` |
| **Session / network** | `browser_manage_cookies`, `browser_manage_storage`, `browser_intercept_network`, console/network logs |
| **Data** | `browser_extract_data`, `browser_generate_pdf` |
| **Macros** | `browser_record_macro_start/stop`, `browser_execute_macro`, list/delete |
| **Watchdogs** | `browser_register_watchdog`, list/remove |
| **Tabs** | navigate, back/forward, reload, new/close/switch tab |

**40+ MCP tools** for full browser control from any MCP-capable agent.

## Monorepo layout

```
packages/
  shared/      # Wire protocol types
  server/      # MCP server + WS bridge + Playwright sandbox
  extension/   # Chrome MV3 extension (dist/ is loadable)
```

## Quick start

### 1. Install & build

```bash
cd browser-mcp-ext
npm install
npm run build
npm test
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `packages/extension/dist`
4. Pin the extension

### 3. Start the MCP server

```bash
npm start
# WebSocket bridge: ws://127.0.0.1:17373
# MCP protocol: stdio
```

### 4. Connect the extension

Click the extension icon → **Connect** (default host `127.0.0.1`, port `17373`). Badge turns green **ON**.

### 5. Wire your AI client

**Cursor** (`~/.cursor/mcp.json`) / **Claude Desktop** / **Windsurf**:

```json
{
  "mcpServers": {
    "browser-mcp-nextgen": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/browser-mcp-ext/packages/server/dist/index.js"]
    }
  }
}
```

See `mcp-config.example.json`.

### Optional: CDP for Playwright tools

For `browser_run_node_playwright`, start Chrome with remote debugging:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-mcp-profile
```

Or set `BROWSER_MCP_CDP_ENDPOINT=http://127.0.0.1:9222`.

> Note: extension mode already uses your real logged-in profile. CDP is only needed for heavy Playwright host scripts.

## Agent usage examples

### Vision + click

```
1. browser_get_visual_state → see numbered elements on screenshot
2. browser_click { target: { som_id: 42 } }
```

### High-level page JS

```
browser_exec_js_page:
  code: |
    return Array.from(document.querySelectorAll('h2'))
      .map(h => h.innerText);
```

### Host Playwright loop

```
browser_run_node_playwright:
  script: |
    const page = await getConnectedPage();
    await page.goto('https://example.com');
    return await page.title();
```

### Watchdog

```
browser_register_watchdog:
  url: https://example.com/product
  interval_sec: 30
  condition: { type: "selector_exists", selector: ".in-stock" }
  action_on_match: { notify: true, trigger_mcp_event: "ITEM_AVAILABLE" }
```

### Macro record / replay

```
browser_record_macro_start → (you perform the flow) → browser_record_macro_stop
browser_execute_macro { macro_id: "..." }
```

## Architecture notes

- **Extension ↔ Server**: WebSocket JSON protocol (`@browser-mcp/shared`)
- **SOM**: content script injects numbered badges → `captureVisibleTab` → badges removed
- **Human-like input**: Bezier mouse paths, randomized key delays
- **Page JS**: content-script `AsyncFunction` with serializable results
- **Host scripts**: isolated child process + timeout; Playwright via `connectOverCDP`
- **Self-healing**: tool failures return error + stack (and screenshots when available) without crashing the server

## Development

```bash
npm run build          # all packages
npm run dev:server     # server with tsx watch
npm run typecheck
npm test
npm run inspector      # MCP inspector UI
```

Extension watch mode:

```bash
npm run watch -w @browser-mcp/extension
```

Then reload the extension in Chrome.

## Security

This gives an AI agent **full control** of your browser profile (cookies, storage, clicks, arbitrary JS). Run only against trusted agents/local models. Host code execution is sandboxed in a child process with a hard timeout, but still has the same OS privileges as your user account for that process.

## License

MIT
