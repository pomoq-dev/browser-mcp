import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runNodeScript } from "./playwright-runner.js";

describe("runNodeScript", () => {
  it("returns a simple value", async () => {
    const res = await runNodeScript(`return 1 + 2;`);
    assert.equal(res.success, true);
    assert.equal(res.result, 3);
  });

  it("handles async code", async () => {
    const res = await runNodeScript(`
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, n: 42 };
    `);
    assert.equal(res.success, true);
    assert.deepEqual(res.result, { ok: true, n: 42 });
  });

  it("captures thrown errors", async () => {
    const res = await runNodeScript(`throw new Error("boom");`);
    assert.equal(res.success, false);
    assert.ok(res.error?.includes("boom") || res.stderr.includes("boom"));
  });

  it("times out long scripts", async () => {
    const res = await runNodeScript(
      `await new Promise((r) => setTimeout(r, 10_000)); return 1;`,
      200,
    );
    assert.equal(res.success, false);
    assert.ok(
      res.error?.toLowerCase().includes("timeout") ||
        res.error?.includes("SIGTERM") ||
        res.error?.includes("timed out"),
    );
  });
});
