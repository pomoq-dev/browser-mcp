import { spawn } from "node:child_process";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function resolvePlaywrightCore(): string {
  try {
    return dirname(require.resolve("playwright-core/package.json"));
  } catch {
    return "playwright-core";
  }
}

export interface PlaywrightRunOptions {
  script: string;
  timeoutMs?: number;
  cdpEndpoint?: string;
  /** Working directory for the script (file access) */
  cwd?: string;
}

export interface PlaywrightRunResult {
  success: boolean;
  result?: unknown;
  stdout: string;
  stderr: string;
  error?: string;
  durationMs: number;
}

/**
 * Run agent-provided Playwright scripts in an isolated child process.
 * The script receives `page`, `browser`, `context` via CDP connection helpers.
 */
export async function runPlaywrightScript(
  options: PlaywrightRunOptions,
): Promise<PlaywrightRunResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const cdpEndpoint =
    options.cdpEndpoint ??
    process.env.BROWSER_MCP_CDP_ENDPOINT ??
    "http://127.0.0.1:9222";
  const workDir = join(tmpdir(), `browser-mcp-pw-${randomUUID()}`);
  const scriptPath = join(workDir, "script.mjs");
  const started = Date.now();

  const wrapper = buildWrapper(
    options.script,
    cdpEndpoint,
    resolvePlaywrightCore(),
  );

  await mkdir(workDir, { recursive: true });
  await writeFile(scriptPath, wrapper, "utf8");

  try {
    const { stdout, stderr, code, signal } = await runChild(
      process.execPath,
      [scriptPath],
      {
        cwd: options.cwd ?? workDir,
        timeoutMs,
        env: {
          ...process.env,
          BROWSER_MCP_CDP_ENDPOINT: cdpEndpoint,
        },
      },
    );

    const durationMs = Date.now() - started;

    if (code !== 0) {
      return {
        success: false,
        stdout,
        stderr,
        error:
          signal === "SIGTERM"
            ? `Script timed out after ${timeoutMs}ms`
            : `Process exited with code ${code}${stderr ? `: ${stderr.slice(0, 2000)}` : ""}`,
        durationMs,
      };
    }

    // Last line of stdout should be __RESULT__:{json}
    const result = parseResult(stdout);
    return {
      success: true,
      result,
      stdout: stripResultLine(stdout),
      stderr,
      durationMs,
    };
  } catch (err) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      error: (err as Error).message,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildWrapper(
  userScript: string,
  cdpEndpoint: string,
  playwrightPath: string,
): string {
  // Use absolute file URL so the temp script can import playwright-core
  const importPath =
    playwrightPath.startsWith("/") || /^[A-Za-z]:\\/.test(playwrightPath)
      ? `file://${join(playwrightPath, "index.js").replace(/\\/g, "/")}`
      : "playwright-core";

  return `/**
 * Auto-generated Playwright runner for BrowserMCP NextGen.
 * Available globals in user script:
 *   - page, browser, context (Playwright)
 *   - getConnectedPage() helper
 *   - console.log goes to stdout
 */
import { chromium } from ${JSON.stringify(importPath)};

const CDP_ENDPOINT = ${JSON.stringify(cdpEndpoint)};

let browser;
let context;
let page;

async function getConnectedPage() {
  if (page) return page;
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const contexts = browser.contexts();
  context = contexts[0] ?? (await browser.newContext());
  const pages = context.pages();
  page = pages[0] ?? (await context.newPage());
  return page;
}

async function main() {
  try {
    await getConnectedPage();
    const userFn = async () => {
${indent(userScript, 6)}
    };
    const result = await userFn();
    console.log("__RESULT__:" + JSON.stringify(result === undefined ? null : result));
  } catch (err) {
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  } finally {
    // Do not close the real browser — only disconnect
    try { await browser?.close(); } catch {}
  }
}

main();
`;
}

function indent(code: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

function parseResult(stdout: string): unknown {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("__RESULT__:")) {
      try {
        return JSON.parse(line.slice("__RESULT__:".length));
      } catch {
        return line.slice("__RESULT__:".length);
      }
    }
  }
  return null;
}

function stripResultLine(stdout: string): string {
  return stdout
    .split("\n")
    .filter((l) => !l.trim().startsWith("__RESULT__:"))
    .join("\n")
    .trim();
}

function runChild(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000);
    }, opts.timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code, signal });
      }
    });
  });
}

/**
 * Lightweight Node sandbox for non-Playwright host scripts (optional helper).
 */
export async function runNodeScript(
  script: string,
  timeoutMs = 30_000,
): Promise<PlaywrightRunResult> {
  const workDir = join(tmpdir(), `browser-mcp-node-${randomUUID()}`);
  const scriptPath = join(workDir, "script.mjs");
  const started = Date.now();

  const wrapped = `
let __result;
async function __main() {
${indent(script, 2)}
}
__main().then((r) => {
  console.log("__RESULT__:" + JSON.stringify(r === undefined ? null : r));
}).catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
`;

  await mkdir(workDir, { recursive: true });
  await writeFile(scriptPath, wrapped, "utf8");

  try {
    const { stdout, stderr, code, signal } = await runChild(
      process.execPath,
      [scriptPath],
      { cwd: workDir, timeoutMs, env: { ...process.env } },
    );
    const durationMs = Date.now() - started;
    if (code !== 0) {
      return {
        success: false,
        stdout,
        stderr,
        error:
          signal === "SIGTERM"
            ? `Script timed out after ${timeoutMs}ms`
            : `Exited ${code}: ${stderr.slice(0, 2000)}`,
        durationMs,
      };
    }
    return {
      success: true,
      result: parseResult(stdout),
      stdout: stripResultLine(stdout),
      stderr,
      durationMs,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
