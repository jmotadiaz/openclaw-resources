// extensions/travel-tools/src/utils/mcp-browser.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import crypto from "crypto";
import { rm } from "fs/promises";
import { resolve } from "path";
import { logger } from "./logger";

const BROWSER_SERVER_URL = "http://127.0.0.1:3456/mcp/";
const PROFILES_DIR = resolve(__dirname, "..", "chrome-profiles");

/** Thrown when the browser process is confirmed dead (CDP port unreachable). */
export class BrowserDeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserDeadError";
  }
}

export class McpBrowserSession {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  public instance_id?: string;
  private profileDir?: string;
  private consecutiveConnFailures = 0;

  /** After this many consecutive connection-refused errors, we consider the
   *  browser dead and throw BrowserDeadError instead of returning empty data. */
  private static readonly MAX_CONN_FAILURES = 3;

  constructor(private profilePrefix: string) {}

  async start(): Promise<void> {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        logger.info(
          `[MCP] Connecting to HTTP server (attempt ${attempt}): ${this.profilePrefix}`,
        );

        // Clean up previous attempt
        if (this.transport) {
          await this.transport.close().catch(() => {});
          this.transport = undefined;
          this.client = undefined;
          this.instance_id = undefined;
        }

        this.transport = new StreamableHTTPClientTransport(
          new URL(BROWSER_SERVER_URL),
        );
        this.client = new Client(
          { name: `travel-tools-${this.profilePrefix}`, version: "1.0.0" },
          { capabilities: {} },
        );

        await this.client.connect(this.transport);

        const uuid = crypto.randomUUID().slice(0, 8);
        this.profileDir = resolve(
          PROFILES_DIR,
          `${this.profilePrefix}-${uuid}`,
        );

        const instance = await this.callTool("spawn_browser", {
          headless: false,
          user_data_dir: this.profileDir,
          sandbox: false,
        });

        logger.info(
          `[spawn_browser] attempt ${attempt} response: ${JSON.stringify(instance)}`,
        );

        this.instance_id = instance?.instance_id;
        if (!this.instance_id) {
          throw new Error(
            `No instance_id. Response: ${JSON.stringify(instance)}`,
          );
        }

        this.consecutiveConnFailures = 0;
        logger.info(`[MCP] Browser spawned: ${this.instance_id}`);
        return;
      } catch (e: any) {
        logger.warn(
          `[MCP] spawn_browser attempt ${attempt} failed: ${e.message}`,
        );

        if (attempt > MAX_RETRIES) {
          throw e;
        }

        logger.info(`[MCP] Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    if (!this.client)
      throw new Error("MCP client not initialized. Call start() first.");

    let result: any;
    try {
      result = (await this.client.callTool({ name, arguments: args })) as any;
    } catch (e: any) {
      // Transport-level failure (server unreachable)
      this.handleConnectionError(name, e.message);
      throw new BrowserDeadError(
        `Transport error calling '${name}': ${e.message}`,
      );
    }

    if (result.isError) {
      throw new Error(
        `MCP tool '${name}' error: ${JSON.stringify(result.content)}`,
      );
    }

    if (!result.content || result.content.length === 0) {
      this.consecutiveConnFailures = 0;
      return {};
    }

    const text = result.content[0].text;

    // Detect connection-refused errors returned by the MCP server
    // (browser process crashed but MCP server is still alive)
    if (this.isConnectionRefusedResult(text)) {
      this.handleConnectionError(name, text);
      // After MAX_CONN_FAILURES, throw instead of returning garbage
      if (this.consecutiveConnFailures >= McpBrowserSession.MAX_CONN_FAILURES) {
        throw new BrowserDeadError(
          `Browser dead: ${this.consecutiveConnFailures} consecutive connection failures on '${name}'`,
        );
      }
      return { __connError: true, error: text };
    }

    // Success — reset failure counter
    this.consecutiveConnFailures = 0;

    try {
      const parsed = JSON.parse(text);
      logger.debug(`[MCP] ${name} → ${JSON.stringify(parsed)}`);
      return parsed;
    } catch {
      logger.error(`[MCP] ${name} parse failed. Raw: ${text}`);
      return { raw: text };
    }
  }

  async close(): Promise<void> {
    try {
      if (this.client && this.instance_id) {
        await this.callTool("close_instance", {
          instance_id: this.instance_id,
        }).catch((e: any) =>
          logger.warn(`[MCP] close_instance failed: ${e.message}`),
        );
      }
    } catch {
      // Swallow — browser may already be dead
    } finally {
      if (this.transport) {
        await this.transport.close().catch(() => {});
      }
      if (this.profileDir) {
        await rm(this.profileDir, { recursive: true, force: true }).catch(
          (e: any) => logger.warn(`[MCP] profile cleanup failed: ${e.message}`),
        );
        logger.debug(`[MCP] Profile cleaned: ${this.profileDir}`);
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private isConnectionRefusedResult(text: string): boolean {
    if (typeof text !== "string") return false;
    try {
      const parsed = JSON.parse(text);
      const error = parsed.error ?? "";
      return (
        error.includes("Connect call failed") ||
        error.includes("Connection refused") ||
        error.includes("[Errno 111]")
      );
    } catch {
      return (
        text.includes("Connect call failed") || text.includes("[Errno 111]")
      );
    }
  }

  private handleConnectionError(toolName: string, detail: string): void {
    this.consecutiveConnFailures++;
    logger.warn(
      `[MCP] Connection failure #${this.consecutiveConnFailures} on '${toolName}': ${detail.slice(0, 120)}`,
    );
  }
}
