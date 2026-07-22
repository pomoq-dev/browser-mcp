# Browser MCP

**TypeScript MCP server + Chrome extension** — automate your *real* browser with AI (Cursor, Claude, VS Code, Windsurf, …).

Inspired by [BrowserMCP/mcp](https://github.com/BrowserMCP/mcp): same architecture (stdio MCP ↔ WebSocket ↔ extension), expanded toolset (vision/SOM, code execution, macros, watchdogs).

```
┌──────────────────┐   MCP stdio    ┌─────────────────────────┐
│  AI client       │ ─────────────► │  @browser-mcp/mcp       │
│  Cursor / Claude │ ◄───────────── │  (Node.js / TypeScript) │
└──────────────────┘                └───────────┬─────────────┘
                                                │ WebSocket :17373
                                                ▼
                                    ┌─────────────────────────┐
                                    │  Chrome extension (MV3) │
                                    │  your real profile      │
                                    └─────────────────────────┘
```

No Python. No remote browser farm. Everything runs locally on your machine.

## Why this exists

| | Cloud browser bots | **Browser MCP** |
|--|--|--|
| Profile | Empty / disposable | **Your** logged-in Chrome |
| Bot detection | Often blocked | Real fingerprint / cookies |
| Stack | Mixed | **Pure TypeScript** |
| Latency | Network hop | Local WebSocket |

## Features

- **Vision (Set-of-Mark)** — screenshot with numbered interactive elements
- **Human-like input** — Bezier mouse paths, typed key delays
- **Code execution** — run JS in the page *or* Node/Playwright on the host
- **Tabs, cookies, storage, network intercept**
- **Extract data / PDF**
- **Macros** — record & replay flows
- **Watchdogs** — background condition polling

## Repo layout

```
packages/
  shared/      # WS protocol types (shared by MCP + extension)
  mcp/         # TypeScript MCP server (stdio + WS hub)
  extension/   # Chrome MV3 extension (load unpacked from dist/)
```

## Quick start

### 1. Install & build

```bash
git clone git@github.com:pomoq-dev/browser-mcp.git
cd browser-mcp
npm install
npm run build
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `packages/extension/dist`
4. Pin the extension

### 3. Point your AI client at the MCP server

**Cursor** (`~/.cursor/mcp.json`) / Claude Desktop / Windsurf:

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/browser-mcp/packages/mcp/dist/index.js"]
    }
  }
}
```

See `mcp-config.example.json`.

### 4. Connect the tab

1. Open the page you want to automate
2. Click the extension icon → **Connect** (default `127.0.0.1:17373`)
3. Badge turns green **ON**

The MCP server starts a WebSocket hub on port **17373** and speaks MCP over stdio to the AI client.

## Development

```bash
npm run build          # shared → mcp → extension
npm start              # run MCP server
npm run dev            # mcp with tsx watch
npm test
npm run typecheck
npm run inspector      # MCP inspector UI
npm run build:extension
```

Extension watch:

```bash
npm run watch -w @browser-mcp/extension
```

Then reload the extension in Chrome.

## Tools (overview)

Navigation & tabs: `browser_navigate`, `browser_get_tabs`, `browser_new_tab`, …

Vision: `browser_get_visual_state`, `browser_get_dom_tree`, `browser_screenshot`

Input: `browser_click`, `browser_type_text`, `browser_drag_and_drop`, `browser_hover`, …

Code: `browser_exec_js_page`, `browser_run_node_playwright`, `browser_run_node_script`

Session: `browser_manage_cookies`, `browser_manage_storage`, `browser_intercept_network`

Data: `browser_extract_data`, `browser_generate_pdf`

Macros & watchdogs: `browser_record_macro_*`, `browser_register_watchdog`, …

Full list is exposed via MCP `tools/list`.

## Optional: CDP for Playwright tools

`browser_run_node_playwright` can attach via Chrome DevTools Protocol:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-mcp-profile
```

Extension mode already uses your normal profile; CDP is only for heavy host scripts.

## Security

The agent gets full control of the connected browser profile (clicks, cookies, arbitrary page JS). Run only with trusted local agents.

## Credits

Architecture adapted from [BrowserMCP/mcp](https://github.com/BrowserMCP/mcp) / [Playwright MCP](https://github.com/microsoft/playwright-mcp) ideas: control the user's browser instead of spawning a disposable one.

## License

MIT
