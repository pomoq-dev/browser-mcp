"""MCP server exposing BrowserMCP NextGen tools."""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
import textwrap
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

from .bridge import get_bridge

logger = logging.getLogger("browser_mcp_nextgen.server")

mcp = FastMCP("browser-mcp-nextgen")


def _text(data: Any, is_error: bool = False) -> dict[str, Any]:
    text = data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False)
    return {
        "content": [{"type": "text", "text": text}],
        "isError": is_error,
    }


async def _req(
    type_: str,
    payload: dict[str, Any] | None = None,
    tab_id: int | None = None,
    timeout_ms: int = 30_000,
) -> Any:
    return await get_bridge().send_request(
        type_, payload or {}, tab_id=tab_id, timeout_ms=timeout_ms
    )


# ── Status ────────────────────────────────────────────────────────────────


@mcp.tool()
async def browser_status() -> str:
    """Check connection status between MCP server and Chrome extension."""
    return json.dumps(get_bridge().status, indent=2)


@mcp.tool()
async def browser_get_events(filter: str | None = None) -> str:
    """Drain recent extension events (watchdog matches, macro events)."""
    return json.dumps(get_bridge().drain_events(filter), indent=2)


# ── Tabs / navigation ─────────────────────────────────────────────────────


@mcp.tool()
async def browser_get_tabs() -> str:
    """List open browser tabs."""
    return json.dumps(await _req("get_tabs"), indent=2)


@mcp.tool()
async def browser_get_active_tab() -> str:
    """Get the currently active tab info."""
    return json.dumps(await _req("get_active_tab"), indent=2)


@mcp.tool()
async def browser_navigate(
    url: str,
    tab_id: int | None = None,
    new_tab: bool = False,
    wait_until: str = "load",
) -> str:
    """Navigate to a URL in the active or specified tab."""
    return json.dumps(
        await _req(
            "navigate",
            {"url": url, "newTab": new_tab, "waitUntil": wait_until},
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_go_back(tab_id: int | None = None) -> str:
    """Navigate back in history."""
    return json.dumps(await _req("go_back", tab_id=tab_id), indent=2)


@mcp.tool()
async def browser_go_forward(tab_id: int | None = None) -> str:
    """Navigate forward in history."""
    return json.dumps(await _req("go_forward", tab_id=tab_id), indent=2)


@mcp.tool()
async def browser_reload(tab_id: int | None = None) -> str:
    """Reload the current page."""
    return json.dumps(await _req("reload", tab_id=tab_id), indent=2)


@mcp.tool()
async def browser_new_tab(url: str | None = None) -> str:
    """Open a new tab, optionally with a URL."""
    return json.dumps(await _req("new_tab", {"url": url}), indent=2)


@mcp.tool()
async def browser_close_tab(tab_id: int | None = None) -> str:
    """Close a tab by id (or active tab)."""
    return json.dumps(await _req("close_tab", tab_id=tab_id), indent=2)


@mcp.tool()
async def browser_switch_tab(tab_id: int) -> str:
    """Activate a tab by id."""
    return json.dumps(await _req("switch_tab", tab_id=tab_id), indent=2)


# ── Vision / SOM ──────────────────────────────────────────────────────────


@mcp.tool()
async def browser_get_visual_state(
    full_page: bool = False,
    draw_labels: bool = True,
    tab_id: int | None = None,
) -> str:
    """Screenshot the page with Set-of-Mark numbered labels on interactive elements."""
    result = await _req(
        "get_visual_state",
        {"fullPage": full_page, "drawLabels": draw_labels},
        tab_id=tab_id,
        timeout_ms=45_000,
    )
    # Keep response size reasonable: include meta + element map; screenshot base64 may be large
    if isinstance(result, dict) and "screenshot" in result:
        shot = result.get("screenshot") or ""
        meta = {
            "url": result.get("url"),
            "title": result.get("title"),
            "viewport": result.get("viewport"),
            "elementCount": len(result.get("elements") or []),
            "elements": result.get("elements"),
            "screenshot_prefix": (shot[:64] + "...") if isinstance(shot, str) and len(shot) > 64 else shot,
            "screenshot": shot,
        }
        return json.dumps(meta, indent=2)
    return json.dumps(result, indent=2)


@mcp.tool()
async def browser_get_dom_tree(
    max_depth: int = 12,
    include_invisible: bool = False,
    selector: str | None = None,
    tab_id: int | None = None,
) -> str:
    """Get a cleaned semantic DOM tree with selectors and XPaths."""
    return json.dumps(
        await _req(
            "get_dom_tree",
            {
                "maxDepth": max_depth,
                "includeInvisible": include_invisible,
                "selector": selector,
            },
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_screenshot(full_page: bool = False, tab_id: int | None = None) -> str:
    """Take a plain screenshot without SOM labels."""
    return json.dumps(
        await _req("screenshot", {"fullPage": full_page}, tab_id=tab_id, timeout_ms=30_000),
        indent=2,
    )


@mcp.tool()
async def browser_get_page_info(tab_id: int | None = None) -> str:
    """Get URL, title, readyState, scroll position, viewport size."""
    return json.dumps(await _req("get_page_info", tab_id=tab_id), indent=2)


# ── Human-like interaction ────────────────────────────────────────────────


@mcp.tool()
async def browser_click(
    target: dict[str, Any],
    click_type: str = "left",
    modifiers: list[str] | None = None,
    tab_id: int | None = None,
) -> str:
    """Human-like click by som_id, CSS selector, xpath, or coordinates."""
    return json.dumps(
        await _req(
            "click",
            {
                "target": target,
                "clickType": click_type,
                "modifiers": modifiers or [],
            },
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_type_text(
    target: dict[str, Any],
    text: str,
    clear_first: bool = True,
    press_enter: bool = False,
    delay_ms: int = 30,
    tab_id: int | None = None,
) -> str:
    """Type text into an input with human-like keystroke delays."""
    return json.dumps(
        await _req(
            "type_text",
            {
                "target": target,
                "text": text,
                "clearFirst": clear_first,
                "pressEnter": press_enter,
                "delayMs": delay_ms,
            },
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_drag_and_drop(
    source: dict[str, Any],
    target: dict[str, Any],
    tab_id: int | None = None,
) -> str:
    """Drag from source element/coords to target."""
    return json.dumps(
        await _req("drag_and_drop", {"source": source, "target": target}, tab_id=tab_id),
        indent=2,
    )


@mcp.tool()
async def browser_upload_file(
    selector: str,
    file_paths: list[str],
    tab_id: int | None = None,
) -> str:
    """Upload local file(s) into input[type=file]."""
    return json.dumps(
        await _req(
            "upload_file",
            {"selector": selector, "filePaths": file_paths},
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_hover(target: dict[str, Any], tab_id: int | None = None) -> str:
    """Hover over an element."""
    return json.dumps(await _req("hover", {"target": target}, tab_id=tab_id), indent=2)


@mcp.tool()
async def browser_scroll(
    direction: str | None = "down",
    amount: int = 600,
    target: dict[str, Any] | None = None,
    tab_id: int | None = None,
) -> str:
    """Scroll the page or an element into view."""
    return json.dumps(
        await _req(
            "scroll",
            {"direction": direction, "amount": amount, "target": target},
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_press_key(
    key: str,
    modifiers: list[str] | None = None,
    target: dict[str, Any] | None = None,
    tab_id: int | None = None,
) -> str:
    """Press a keyboard key (with optional modifiers)."""
    return json.dumps(
        await _req(
            "press_key",
            {"key": key, "modifiers": modifiers or [], "target": target},
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_select_option(
    target: dict[str, Any],
    value: str | None = None,
    label: str | None = None,
    index: int | None = None,
    tab_id: int | None = None,
) -> str:
    """Select option in a <select> by value, label, or index."""
    return json.dumps(
        await _req(
            "select_option",
            {"target": target, "value": value, "label": label, "index": index},
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_wait_for(
    condition: str,
    selector: str | None = None,
    text: str | None = None,
    url_pattern: str | None = None,
    timeout_ms: int = 15_000,
    tab_id: int | None = None,
) -> str:
    """Wait for selector, text, URL change, network idle, or timeout."""
    return json.dumps(
        await _req(
            "wait_for",
            {
                "condition": condition,
                "selector": selector,
                "text": text,
                "urlPattern": url_pattern,
                "timeoutMs": timeout_ms,
            },
            tab_id=tab_id,
            timeout_ms=timeout_ms + 2000,
        ),
        indent=2,
    )


# ── Code execution ────────────────────────────────────────────────────────


@mcp.tool()
async def browser_exec_js_page(
    code: str,
    args: list[Any] | None = None,
    tab_id: int | None = None,
    timeout_ms: int = 30_000,
) -> str:
    """Execute arbitrary JavaScript in the page context (window/DOM)."""
    try:
        result = await _req(
            "exec_js",
            {"code": code, "args": args or []},
            tab_id=tab_id,
            timeout_ms=timeout_ms,
        )
        return json.dumps({"success": True, "result": result}, indent=2)
    except Exception as exc:
        return json.dumps({"success": False, "error": str(exc)}, indent=2)


@mcp.tool()
async def browser_run_node_script(script: str, timeout_ms: int = 30_000) -> str:
    """Run arbitrary Node.js / Python-like host script in an isolated child process.

    The script body is executed as an async IIFE in Node if node is available,
    otherwise as Python. Prefer simple Python expressions with `return`.
    """
    # Prefer Python sandbox (this process runtime)
    wrapped = textwrap.dedent(
        f"""
        import json, sys
        async def __main():
        {textwrap.indent(script, "    ")}
        import asyncio
        try:
            result = asyncio.get_event_loop().run_until_complete(__main())
        except RuntimeError:
            result = asyncio.run(__main())
        print("__RESULT__:" + json.dumps(result, default=str))
        """
    )
    # Actually script may be sync python with return — support both styles
    # Simpler: exec as function body with return support via transform
    py = textwrap.dedent(
        f"""
        import json
        def __user():
        {textwrap.indent(script, "    ")}
        try:
            result = __user()
            print("__RESULT__:" + json.dumps(result, default=str))
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise SystemExit(1)
        """
    )
    with tempfile.TemporaryDirectory(prefix="browser-mcp-py-") as tmp:
        path = Path(tmp) / "script.py"
        path.write_text(py, encoding="utf-8")
        try:
            proc = subprocess.run(
                ["python3", str(path)],
                capture_output=True,
                text=True,
                timeout=timeout_ms / 1000,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return json.dumps(
                {"success": False, "error": f"Script timed out after {timeout_ms}ms"},
                indent=2,
            )
        result = None
        for line in reversed(proc.stdout.splitlines()):
            if line.startswith("__RESULT__:"):
                try:
                    result = json.loads(line[len("__RESULT__:") :])
                except json.JSONDecodeError:
                    result = line[len("__RESULT__:") :]
                break
        ok = proc.returncode == 0
        return json.dumps(
            {
                "success": ok,
                "result": result,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "error": None if ok else (proc.stderr or f"exit {proc.returncode}"),
            },
            indent=2,
        )


@mcp.tool()
async def browser_run_node_playwright(
    script: str,
    timeout_ms: int = 60_000,
    cdp_endpoint: str = "http://127.0.0.1:9222",
) -> str:
    """Run a Playwright script connected to Chrome via CDP (requires node + playwright-core)."""
    wrapper = f"""
import {{ chromium }} from 'playwright-core';
const CDP_ENDPOINT = {json.dumps(cdp_endpoint)};
let browser, context, page;
async function getConnectedPage() {{
  if (page) return page;
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  context = contexts[0] ?? await browser.newContext();
  const pages = context.pages();
  page = pages[0] ?? await context.newPage();
  return page;
}}
async function main() {{
  try {{
    await getConnectedPage();
    const userFn = async () => {{
{textwrap.indent(script, "      ")}
    }};
    const result = await userFn();
    console.log("__RESULT__:" + JSON.stringify(result === undefined ? null : result));
  }} catch (err) {{
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  }} finally {{
    try {{ await browser?.close(); }} catch {{}}
  }}
}}
main();
"""
    with tempfile.TemporaryDirectory(prefix="browser-mcp-pw-") as tmp:
        path = Path(tmp) / "script.mjs"
        path.write_text(wrapper, encoding="utf-8")
        try:
            proc = subprocess.run(
                ["node", str(path)],
                capture_output=True,
                text=True,
                timeout=timeout_ms / 1000,
                check=False,
            )
        except FileNotFoundError:
            return json.dumps(
                {
                    "success": False,
                    "error": "node not found — install Node.js for Playwright tools",
                },
                indent=2,
            )
        except subprocess.TimeoutExpired:
            return json.dumps(
                {"success": False, "error": f"Script timed out after {timeout_ms}ms"},
                indent=2,
            )
        result = None
        for line in reversed(proc.stdout.splitlines()):
            if line.startswith("__RESULT__:"):
                try:
                    result = json.loads(line[len("__RESULT__:") :])
                except json.JSONDecodeError:
                    result = line[len("__RESULT__:") :]
                break
        ok = proc.returncode == 0
        return json.dumps(
            {
                "success": ok,
                "result": result,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "error": None if ok else (proc.stderr or f"exit {proc.returncode}"),
            },
            indent=2,
        )


# ── Cookies / storage / network ───────────────────────────────────────────


@mcp.tool()
async def browser_manage_cookies(
    action: str,
    cookie_data: dict[str, Any] | None = None,
    url: str | None = None,
    tab_id: int | None = None,
) -> str:
    """Get, set, delete, clear, or export cookies."""
    return json.dumps(
        await _req(
            "manage_cookies",
            {"action": action, "cookieData": cookie_data, "url": url},
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_manage_storage(
    storage_type: str,
    action: str,
    key: str | None = None,
    value: str | None = None,
    tab_id: int | None = None,
) -> str:
    """Read/write/clear localStorage or sessionStorage."""
    return json.dumps(
        await _req(
            "manage_storage",
            {
                "storageType": storage_type,
                "action": action,
                "key": key,
                "value": value,
            },
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_intercept_network(
    action: str,
    rule_id: str | None = None,
    url_pattern: str | None = None,
    intercept_action: str | None = None,
    mock_response: dict[str, Any] | None = None,
) -> str:
    """Add/remove/list/clear network intercept rules (block, mock, or log)."""
    return json.dumps(
        await _req(
            "intercept_network",
            {
                "action": action,
                "ruleId": rule_id,
                "urlPattern": url_pattern,
                "interceptAction": intercept_action,
                "mockResponse": mock_response,
            },
        ),
        indent=2,
    )


@mcp.tool()
async def browser_get_console_logs(
    level: str = "all",
    limit: int = 100,
    tab_id: int | None = None,
) -> str:
    """Get captured console logs from the page."""
    return json.dumps(
        await _req("get_console_logs", {"level": level, "limit": limit}, tab_id=tab_id),
        indent=2,
    )


@mcp.tool()
async def browser_get_network_logs(limit: int = 100, url_filter: str | None = None) -> str:
    """Get logged network requests."""
    return json.dumps(
        await _req("get_network_logs", {"limit": limit, "urlFilter": url_filter}),
        indent=2,
    )


# ── Extract / PDF ─────────────────────────────────────────────────────────


@mcp.tool()
async def browser_extract_data(
    schema: dict[str, Any],
    output_format: str = "json",
    multiple: bool = False,
    container_selector: str | None = None,
    tab_id: int | None = None,
) -> str:
    """Extract structured data from the page using a CSS-selector schema."""
    return json.dumps(
        await _req(
            "extract_data",
            {
                "schema": schema,
                "outputFormat": output_format,
                "multiple": multiple,
                "containerSelector": container_selector,
            },
            tab_id=tab_id,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_generate_pdf(
    selector: str | None = None,
    landscape: bool = False,
    print_background: bool = True,
    tab_id: int | None = None,
) -> str:
    """Save the current page as PDF (base64)."""
    return json.dumps(
        await _req(
            "generate_pdf",
            {
                "selector": selector,
                "landscape": landscape,
                "printBackground": print_background,
            },
            tab_id=tab_id,
            timeout_ms=60_000,
        ),
        indent=2,
    )


# ── Macros ────────────────────────────────────────────────────────────────


@mcp.tool()
async def browser_record_macro_start(name: str | None = None) -> str:
    """Start recording user actions for learning-from-demonstration."""
    return json.dumps(await _req("record_macro_start", {"name": name}), indent=2)


@mcp.tool()
async def browser_record_macro_stop(
    name: str | None = None,
    generate_script: bool = True,
) -> str:
    """Stop macro recording; returns actions and optional generated script."""
    return json.dumps(
        await _req("record_macro_stop", {"name": name, "generateScript": generate_script}),
        indent=2,
    )


@mcp.tool()
async def browser_list_macros() -> str:
    """List saved macros."""
    return json.dumps(await _req("list_macros"), indent=2)


@mcp.tool()
async def browser_execute_macro(
    macro_id: str,
    variables: dict[str, str] | None = None,
    tab_id: int | None = None,
) -> str:
    """Replay a saved macro with optional variable substitution."""
    return json.dumps(
        await _req(
            "execute_macro",
            {"macroId": macro_id, "variables": variables or {}},
            tab_id=tab_id,
            timeout_ms=120_000,
        ),
        indent=2,
    )


@mcp.tool()
async def browser_delete_macro(macro_id: str) -> str:
    """Delete a saved macro by id."""
    return json.dumps(await _req("delete_macro", {"macroId": macro_id}), indent=2)


# ── Watchdogs ─────────────────────────────────────────────────────────────


@mcp.tool()
async def browser_register_watchdog(
    url: str,
    condition: dict[str, Any],
    name: str | None = None,
    interval_sec: float = 60,
    action_on_match: dict[str, Any] | None = None,
) -> str:
    """Register a background watchdog that polls a URL/condition."""
    return json.dumps(
        await _req(
            "register_watchdog",
            {
                "name": name,
                "url": url,
                "intervalSec": interval_sec,
                "condition": condition,
                "actionOnMatch": action_on_match or {"notify": True},
            },
        ),
        indent=2,
    )


@mcp.tool()
async def browser_list_watchdogs() -> str:
    """List registered watchdogs and their status."""
    return json.dumps(await _req("list_watchdogs"), indent=2)


@mcp.tool()
async def browser_remove_watchdog(watchdog_id: str) -> str:
    """Remove a watchdog by id."""
    return json.dumps(await _req("remove_watchdog", {"watchdogId": watchdog_id}), indent=2)


def create_mcp() -> FastMCP:
    return mcp
