import { z } from "@hono/zod-openapi";
import type { ToolLogger, ToolRegistration } from "./types";
import * as AIProvider from "../ai";
import { GenerateTextOptions, GenerateStructuredOptions } from "../ai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Custom Transport for Cloudflare Workers (Web Streams).
 */
class WorkerSSEServerTransport implements Transport {
  private _writer: WritableStreamDefaultWriter<any>;
  private _encoder = new TextEncoder();
  
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(writer: WritableStreamDefaultWriter<any>) {
    this._writer = writer;
  }

  async start(): Promise<void> {
    await this.writeEvent("endpoint", "/mcp/messages");
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await this.writeEvent("message", JSON.stringify(message));
  }

  async close(): Promise<void> {
    try {
      await this._writer.close();
    } catch (e) { }
    this.onclose?.();
  }

  private async writeEvent(event: string, data: string) {
    const streamData = `event: ${event}\ndata: ${data}\n\n`;
    await this._writer.write(this._encoder.encode(streamData));
  }

  public async handlePostMessage(message: JSONRPCMessage) {
    if (this.onmessage) {
      this.onmessage(message);
    }
  }
}

/**
 * Base abstract class for SINGLE Agent Tools.
 * Use this when defining a specific tool logic.
 */
export abstract class BaseTool<TArgs = any, TResult = any> {
  abstract name: string;
  abstract description: string;
  abstract schema: z.ZodType<TArgs>;

  constructor(protected env: Env) { }

  protected abstract execute(args: TArgs): Promise<TResult>;

  public async run(args: TArgs, logger: ToolLogger): Promise<TResult> {
    const start = Date.now();
    await logger("assistant", `[TOOL_START] ${this.name}`, {
      actionType: "TOOL_CALL",
      toolName: this.name,
      toolArgs: args,
      status: "SUCCESS"
    });

    try {
      const result = await this.execute(args);
      await logger("tool", `[TOOL_END] ${this.name}`, {
        actionType: "TOOL_RESULT",
        toolName: this.name,
        latencyMs: Date.now() - start,
        status: "SUCCESS",
      });
      return result;
    } catch (error: any) {
      console.error(`Tool Error (${this.name}):`, error);
      await logger("tool", `[TOOL_ERROR] ${this.name}: ${error.message}`, {
        actionType: "ERROR",
        toolName: this.name,
        latencyMs: Date.now() - start,
        status: "FAILURE",
        error: error.message
      });
      throw error;
    }
  }

  public createBinding(logger: ToolLogger): ToolRegistration {
    return {
      name: this.name,
      description: this.description,
      schema: this.schema,
      execute: (args: TArgs) => this.run(args, logger)
    };
  }

  // --- SHARED AI CAPABILITIES ---
  protected async generateText(
    prompt: string,
    options: GenerateTextOptions = { 
      reasoningEffort: "medium",
      // @ts-ignore
      modelOptions: { provider: "worker-ai" }
    }
  ) {
    return AIProvider.generateText(this.env, prompt, options);
  }

  protected async generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options: GenerateStructuredOptions = { 
      reasoningEffort: "medium",
      // @ts-ignore
      modelOptions: { provider: "worker-ai" }
    }
  ): Promise<T> {
    return AIProvider.generateStructured(this.env, prompt, schema, options);
  }
}

/**
 * Base abstract class for TOOL REGISTRIES (Groups of Tools).
 * Use this for classes like 'MemoryTools' that register multiple tools.
 */
export abstract class BaseMcpTool {
  constructor(protected server: McpServer, protected env: Env) {}

  abstract register(): void;
}

/**
 * Base class for a Cloudflare Worker-based MCP Agent.
 */
export abstract class McpAgent {
  // Abstract: The child class must define the server instance
  abstract server: McpServer;
  
  // These are injected via property assignment, not constructor
  env!: Env;
  ctx!: ExecutionContext;

  abstract init(): Promise<void>;

  static serveSSE(endpoint: string) {
    return {
      fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
        const AgentClass = this as any;
        // Instantiate with NO arguments
        const agent = new AgentClass() as McpAgent;
        
        // Inject dependencies
        agent.env = env;
        agent.ctx = ctx;
        await agent.init();

        if (request.method === "GET") {
          const { readable, writable } = new TransformStream();
          const writer = writable.getWriter();
          const transport = new WorkerSSEServerTransport(writer);

          await agent.server.connect(transport);
          ctx.waitUntil(transport.start());

          return new Response(readable, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            },
          });
        }
        else if (request.method === "POST") {
           // Stateless fallback
          return new Response("Stateless POST not supported without Durable Objects", { status: 501 });
        }

        return new Response("Method Not Allowed", { status: 405 });
      }
    };
  }

  static serve(endpoint: string) {
    return {
      fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
        return new Response("Standard HTTP Transport not yet implemented. Use /sse", { status: 501 });
      }
    };
  }
}