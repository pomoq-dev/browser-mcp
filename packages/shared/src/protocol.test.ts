import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WS_PORT,
  PROTOCOL_VERSION,
  makeRequestId,
} from "./protocol.js";

describe("protocol", () => {
  it("exports defaults", () => {
    assert.equal(DEFAULT_WS_PORT, 17373);
    assert.equal(PROTOCOL_VERSION, 1);
  });

  it("makeRequestId is unique", () => {
    const a = makeRequestId();
    const b = makeRequestId();
    assert.notEqual(a, b);
    assert.ok(a.length > 5);
  });
});
