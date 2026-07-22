import asyncio
import json

import pytest
import websockets

from browser_mcp_nextgen.bridge import ExtensionBridge


@pytest.mark.asyncio
async def test_bridge_hello_and_request():
    bridge = ExtensionBridge(host="127.0.0.1", port=29373)
    await bridge.start()
    try:
        async with websockets.connect("ws://127.0.0.1:29373") as ws:
            await ws.send(
                json.dumps(
                    {
                        "kind": "hello",
                        "version": 1,
                        "extensionId": "pytest-ext",
                    }
                )
            )
            ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            assert ack["kind"] == "hello_ack"

            # wait until bridge marks connected
            for _ in range(20):
                if bridge.connected:
                    break
                await asyncio.sleep(0.05)

            async def responder():
                while True:
                    raw = await ws.recv()
                    msg = json.loads(raw)
                    if msg.get("kind") == "request":
                        req = msg["request"]
                        await ws.send(
                            json.dumps(
                                {
                                    "kind": "response",
                                    "response": {
                                        "id": req["id"],
                                        "ok": True,
                                        "result": {"type": req["type"], "pong": True},
                                    },
                                }
                            )
                        )
                        break

            task = asyncio.create_task(responder())
            result = await bridge.send_request("ping", {"x": 1})
            assert result == {"type": "ping", "pong": True}
            await task
    finally:
        await bridge.stop()
