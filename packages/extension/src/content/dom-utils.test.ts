import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Pure unit-style tests for selector helpers by re-implementing the pure logic
 * that doesn't need a real DOM (XPath-like path building is DOM-bound).
 * Full DOM tests run in the extension at runtime.
 */
describe("content helpers (sanity)", () => {
  it("random and sleep utilities work", async () => {
    const { sleep, randomBetween } = await import("./dom-utils.js");
    const a = randomBetween(1, 2);
    assert.ok(a >= 1 && a <= 2);
    const t0 = Date.now();
    await sleep(30);
    assert.ok(Date.now() - t0 >= 20);
  });
});
