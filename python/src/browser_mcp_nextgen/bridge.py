"""WebSocket hub that the Chrome extension connects to."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger("browser_mcp_nextgen.bridge")

DEFAULT_WS_HOST = "127.0.0.1"
DEFAULT_WS_PORT = 17373
PROTOCOL_VERSION = 1


def _rid() -> str:
    return f"{int(time.time() * 1000):x}-{uuid.uuid4().hex[:8]}"


@dataclass
class ExtensionBridge:
    host: str = DEFAULT_WS_HOST
    port: int = DEFAULT_WS_PORT
    _client: ServerConnection | None = field(default=None, repr=False)
    _pending: dict[str, asyncio.Future[dict[str, Any]]] = field(default_factory=dict, repr=False)
    _events: list[dict[str, Any]] = field(default_factory=list, repr=False)
    _server: Any = field(default=None, repr=False)
    extension_id: str | None = None
    connected: bool = False

    @property
    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected and self._client is not None,
            "extensionId": self.extension_id,
            "port": self.port,
            "host": self.host,
            "pendingRequests": len(self._pending),
            "recentEvents": self._events[-20:],
        }

    async def start(self) -> None:
        self._server = await serve(self._handler, self.host, self.port)
        logger.info("WebSocket bridge listening on ws://%s:%s", self.host, self.port)

    async def stop(self) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError("Bridge shutting down"))
        self._pending.clear()
        if self._client is not None:
            await self._client.close()
            self._client = None
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        self.connected = False

    async def _handler(self, ws: ServerConnection) -> None:
        if self._client is not None:
            try:
                await self._client.close(code=4000, reason="replaced by new connection")
            except Exception:
                pass
        self._client = ws
        self.connected = True
        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._on_message(ws, msg)
        except ConnectionClosed:
            pass
        finally:
            if self._client is ws:
                self._client = None
                self.connected = False
                self.extension_id = None

    async def _on_message(self, ws: ServerConnection, msg: dict[str, Any]) -> None:
        kind = msg.get("kind")
        if kind == "hello":
            self.extension_id = msg.get("extensionId")
            await ws.send(
                json.dumps(
                    {
                        "kind": "hello_ack",
                        "version": PROTOCOL_VERSION,
                        "port": self.port,
                    }
                )
            )
            logger.info("Extension connected: %s", self.extension_id)
        elif kind == "response":
            response = msg.get("response") or {}
            rid = response.get("id")
            fut = self._pending.pop(rid, None) if rid else None
            if fut and not fut.done():
                fut.set_result(response)
        elif kind == "event":
            event = msg.get("event") or {}
            self._events.append(event)
            if len(self._events) > 500:
                self._events = self._events[-500:]
        elif kind == "heartbeat":
            await ws.send(json.dumps({"kind": "heartbeat_ack", "ts": int(time.time() * 1000)}))

    async def send_request(
        self,
        type_: str,
        payload: dict[str, Any] | None = None,
        *,
        tab_id: int | None = None,
        timeout_ms: int = 30_000,
    ) -> Any:
        if self._client is None or not self.connected:
            raise RuntimeError(
                f"Chrome extension is not connected. "
                f"Start the extension and click Connect (WS {self.host}:{self.port})."
            )
        rid = _rid()
        request = {
            "id": rid,
            "type": type_,
            "payload": payload or {},
            "tabId": tab_id,
            "timeoutMs": timeout_ms,
        }
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[rid] = fut
        await self._client.send(json.dumps({"kind": "request", "request": request}))
        try:
            response = await asyncio.wait_for(fut, timeout=timeout_ms / 1000)
        except asyncio.TimeoutError as exc:
            self._pending.pop(rid, None)
            raise TimeoutError(f"Request {type_} timed out after {timeout_ms}ms") from exc
        if not response.get("ok"):
            raise RuntimeError(response.get("error") or "Unknown bridge error")
        return response.get("result")

    def drain_events(self, filter_name: str | None = None) -> list[dict[str, Any]]:
        if not filter_name:
            events = list(self._events)
            self._events.clear()
            return events
        matched = [e for e in self._events if e.get("event") == filter_name]
        self._events = [e for e in self._events if e.get("event") != filter_name]
        return matched


_bridge: ExtensionBridge | None = None


def get_bridge() -> ExtensionBridge:
    global _bridge
    if _bridge is None:
        _bridge = ExtensionBridge()
    return _bridge


def set_bridge(bridge: ExtensionBridge) -> None:
    global _bridge
    _bridge = bridge
