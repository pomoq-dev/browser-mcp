#!/usr/bin/env node
/**
 * BrowserMCP NextGen — MCP Server entrypoint
 *
 * Starts:
 *  1. WebSocket bridge for the Chrome extension
 *  2. MCP stdio server exposing the full tool catalog
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import {
  DEFAULT_WS_HOST,
  DEFAULT_WS_PORT,
} from "@browser-mcp/shared";
import { ExtensionBridge, setBridge } from "./bridge/extension-bridge.js";
import { registerAllTools } from "./tools/register-tools.js";

const program = new Command();

program
  .name("browser-mcp-nextgen")
  .description("BrowserMCP NextGen MCP server + extension bridge")
  .option(
    "--ws-port <port>",
    "WebSocket port for Chrome extension",
    String(DEFAULT_WS_PORT),
  )
  .option(
    "--ws-host <host>",
    "WebSocket host bind address",
    DEFAULT_WS_HOST,
  )
  .option(
    "--cdp-endpoint <url>",
    "Chrome CDP endpoint for Playwright tools",
    process.env.BROWSER_MCP_CDP_ENDPOINT ?? "http://127.0.0.1:9222",
  )
  .action(async (opts) => {
    const port = Number(opts.wsPort);
    const host = opts.wsHost as string;

    if (opts.cdpEndpoint) {
      process.env.BROWSER_MCP_CDP_ENDPOINT = opts.cdpEndpoint;
    }

    const bridge = new ExtensionBridge({ host, port });
    setBridge(bridge);

    try {
      await bridge.start();
      // Log to stderr so stdout stays clean for MCP stdio
      console.error(
        `[browser-mcp] WebSocket bridge listening on ws://${host}:${port}`,
      );
      console.error(
        `[browser-mcp] Waiting for Chrome extension to connect...`,
      );
    } catch (err) {
      console.error(`[browser-mcp] Failed to start WS bridge:`, err);
      process.exit(1);
    }

    bridge.on("connected", ({ extensionId }) => {
      console.error(`[browser-mcp] Extension connected: ${extensionId}`);
    });
    bridge.on("disconnected", () => {
      console.error(`[browser-mcp] Extension disconnected`);
    });
    bridge.on("event", (ev) => {
      console.error(`[browser-mcp] event: ${ev.event}`);
    });

    const server = new McpServer({
      name: "browser-mcp-nextgen",
      version: "1.0.0",
    });

    registerAllTools(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[browser-mcp] MCP server ready on stdio`);

    const shutdown = async () => {
      console.error(`[browser-mcp] Shutting down...`);
      await bridge.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program.parse();
