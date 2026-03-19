// extensions/flight-tools/src/utils/mcp-browser.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import crypto from 'crypto';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { logger } from './logger';

const BROWSER_SERVER_URL = "http://127.0.0.1:3456/mcp/";
const PROFILES_DIR = resolve(__dirname, '..', 'chrome-profiles');

export class McpBrowserSession {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  public instance_id?: string;
  private profileDir?: string;  // ← añadir

  // pythonBin ya no se usa — se mantiene en firma para no romper llamadas existentes
  constructor(private profilePrefix: string) {}

  async start(): Promise<void> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 3000; // 3s entre reintentos

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      logger.info(`[MCP] Conectando al servidor HTTP (attempt ${attempt}): ${this.profilePrefix}`);

      // Limpiar conexión previa si es un reintento
      if (this.transport) {
        await this.transport.close().catch(() => {});
        this.transport = undefined;
        this.client = undefined;
        this.instance_id = undefined;
      }

      this.transport = new StreamableHTTPClientTransport(
        new URL(BROWSER_SERVER_URL)
      );
      this.client = new Client(
        { name: `flight-tools-${this.profilePrefix}`, version: "1.0.0" },
        { capabilities: {} }
      );

      await this.client.connect(this.transport);

      const uuid = crypto.randomUUID().slice(0, 8);
      this.profileDir = resolve(PROFILES_DIR, `${this.profilePrefix}-${uuid}`);

      const instance = await this.callTool("spawn_browser", {
        headless: false,
        user_data_dir: this.profileDir,
        sandbox: false
      });

      logger.info(`[spawn_browser] attempt ${attempt} response: ${JSON.stringify(instance)}`);

      this.instance_id = instance?.instance_id;
      if (!this.instance_id) {
        throw new Error(`No instance_id. Response: ${JSON.stringify(instance)}`);
      }

      logger.info(`[MCP] Browser spawned: ${this.instance_id}`);
      return; // éxito — salir del loop

    } catch (e: any) {
      logger.warn(`[MCP] spawn_browser attempt ${attempt} failed: ${e.message}`);

      if (attempt > MAX_RETRIES) {
        // Agotados los reintentos — propagar el error
        throw e;
      }

      // Esperar antes del siguiente intento
      logger.info(`[MCP] Retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

  async callTool(name: string, args: any): Promise<any> {
    if (!this.client) throw new Error("Cliente MCP no inicializado. Llama a start() primero.");

    const result = (await this.client.callTool({ name, arguments: args })) as any;

    if (result.isError) {
      throw new Error(`MCP tool '${name}' error: ${JSON.stringify(result.content)}`);
    }

    if (!result.content || result.content.length === 0) return {};

    const text = result.content[0].text;
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
        await this.callTool("close_instance", { instance_id: this.instance_id }).catch(
          (e: any) => logger.warn(`[MCP] close_instance failed: ${e.message}`)
        );
      }
    } finally {
      if (this.transport) {
        await this.transport.close().catch(() => {});
      }
      if (this.profileDir) {
        await rm(this.profileDir, { recursive: true, force: true })
          .catch((e: any) => logger.warn(`[MCP] profile cleanup failed: ${e.message}`));
        logger.debug(`[MCP] Profile cleaned: ${this.profileDir}`);
      }
    }
  }
}
