"""CLI entrypoint: start WebSocket bridge + MCP stdio server."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from .bridge import DEFAULT_WS_HOST, DEFAULT_WS_PORT, ExtensionBridge, set_bridge
from .server import mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="browser-mcp-nextgen",
        description="BrowserMCP NextGen MCP server (stdio) + Chrome extension WS bridge",
    )
    parser.add_argument("--ws-host", default=DEFAULT_WS_HOST)
    parser.add_argument("--ws-port", type=int, default=DEFAULT_WS_PORT)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="[browser-mcp] %(message)s",
        stream=sys.stderr,
    )

    bridge = ExtensionBridge(host=args.ws_host, port=args.ws_port)
    set_bridge(bridge)

    async def _start_bridge() -> None:
        await bridge.start()
        logging.info("Waiting for Chrome extension to connect...")

    # Start bridge in background before MCP stdio loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(_start_bridge())

    # FastMCP run (stdio) — blocks
    try:
        mcp.run(transport="stdio")
    finally:
        loop.run_until_complete(bridge.stop())
        loop.close()


if __name__ == "__main__":
    main()
