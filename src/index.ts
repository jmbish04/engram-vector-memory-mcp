import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryTools } from "./tools/memory";
import {
  createMemory,
  getMemoriesByIds,
  getRawMemories,
  markMemoryProcessed,
  updateConsolidatedMemory,
  deleteMemories,
} from "./db/queries";
import * as VectorService from "./db/vectorize";
import { AIModelOptions } from "./ai";
import * as AIProvider from "./ai";
import { sanitizeAndFormatResponse } from "./ai/utils/sanitizer";
import { SignalLogger } from "./utils/logger";

// --- Types ---
interface MemoryMessage {
  text: string;
  context_tags?: string[];
  timestamp: number;
  source_app?: string;
  session_id?: string;
}

// Global logger instance for this worker
const logger = new SignalLogger();

// --- The Agent ---
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "Global Memory System",
    version: "2.0.0",
  });

  async init() {
    // Register Memory Tools
    // 'this.env' is automatically populated by the base class before init() is called
    const memoryTools = new MemoryTools(this.server, this.env); 
    memoryTools.register();
  }
}

// --- Background Logic ---

export default {
  // Handle HTTP (MCP Protocol + API Routes + SSE)
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // 1. SSE Stream for Logs
    if (url.pathname === "/api/sse/logs") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Send initial logs
      const recent = logger.getRecentLogs();
      recent.forEach(log => {
        writer.write(encoder.encode(`data: ${JSON.stringify(log)}\n\n`));
      });

      // Keep connection open (simplified for demo)
      // In production, use Durable Objects for broadcasting real-time logs
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // 2. API Routes for Frontend
    if (url.pathname === "/api/memory" && request.method === "POST") {
      return handlePostMemory(request, env);
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      return handleSearch(request, env, url);
    }

    if (url.pathname === "/api/ai/generate" && request.method === "POST") {
      return handleAIGenerate(request, env);
    }

    if (url.pathname === "/api/search/rewritten" && request.method === "POST") {
      return handleRewrittenSearch(request, env);
    }

    // 3. Standard MCP Endpoints
    if (url.pathname === "/sse")
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    if (url.pathname === "/mcp")
      return MyMCP.serve("/mcp").fetch(request, env, ctx);

    // 4. Manual Trigger
    if (url.pathname === "/trigger-curator") {
      ctx.waitUntil(curateMemories(env));
      return new Response("Curator triggered", { status: 202 });
    }

    // Default: Serve Assets (handled by Worker Assets binding automatically if configured)
    // If not found, fall through to 404 or index.html for SPA routing
    return new Response("Global Memory Agent Active", { status: 200 });
  },

  // Handle Cron Triggers
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(curateMemories(env));
  },

  // Handle Queue
  async queue(
    batch: MessageBatch<MemoryMessage>,
    env: Env,
    ctx: ExecutionContext
  ) {
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        try {
            const { text, context_tags, timestamp, source_app, session_id } =
            message.body;
            const id = crypto.randomUUID();

            logger.log('process', `Ingesting memory from ${source_app}: "${text.substring(0, 30)}..."`);

            // Retry Wrapper for Robustness
            await withRetry(async () => {
                // 1. Vectorize
                await VectorService.upsertMemoryVector(env, text, id, timestamp, {
                    primary_tag: context_tags && context_tags.length > 0 ? context_tags[0] : "general",
                    priority_rank: 0 // Default rank
                });
                
                // 2. D1
                await createMemory(env.DB, {
                    id,
                    text,
                    tags: JSON.stringify(context_tags),
                    createdAt: timestamp,
                    sourceApp: source_app || "unknown",
                    sessionId: session_id || "unknown",
                    status: "raw",
                });
            });

            logger.log('success', `Memory saved successfully: ${id}`);
            message.ack();
        } catch (err: any) {
            logger.log('error', `Failed to process memory: ${err.message}`);
            // Don't ack, let it retry or DLQ
            message.retry();
        }
      })
    );
  }
};

// --- API Handlers ---

async function handlePostMemory(req: Request, env: Env) {
    try {
        const body = await req.json() as any;
        const { text, source_app, session_id } = body;
        
        if (!text) return new Response("Missing text", { status: 400 });

        // Push to queue for async processing
        const message: MemoryMessage = {
            text,
            context_tags: ["web-ui"],
            timestamp: Date.now(),
            source_app: source_app || "web-client",
            session_id: session_id || "default-session"
        };

        await env.QUEUE.send(message);
        
        return new Response(JSON.stringify({ success: true, status: "queued" }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

async function handleSearch(req: Request, env: Env, url: URL) {
    const query = url.searchParams.get("q");
    if (!query) return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" }});

    try {
        const results = await VectorService.querySimilarVectors(env, query, 10);
        const ids = results.matches.map((m: any) => m.id);
        const memories = await getMemoriesByIds(env.DB, ids);
        
        // Merge scores
        const response = memories.map(m => {
            const match = results.matches.find((r: any) => r.id === m.id);
            return { ...m, score: match?.score };
        });

        return new Response(JSON.stringify(response), {
             headers: { "Content-Type": "application/json" }
        });
    } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

async function handleAIGenerate(req: Request, env: Env) {
    try {
        const body = await req.json() as any;
        const { prompt, system, provider, model, schema } = body;

        if (!prompt) return new Response(JSON.stringify({ error: "Missing prompt" }), { status: 400 });

        logger.log('process', `AI generation requested: "${prompt.substring(0, 50)}..."`);

        let response;
        if (schema) {
            // Use structured generation if schema is provided
            response = await AIProvider.generateStructured(env, prompt, schema, {
                provider: provider || "worker-ai",
                system: system,
                model: model,
            });
            // If response is object, stringify it for consistent return type
            if (typeof response !== 'string') {
                response = JSON.stringify(response);
            }
        } else {
            // Standard text generation
            response = await AIProvider.generateText(env, prompt, {
                provider: provider || "worker-ai",
                system: system,
                model: model,
            });
            
            // Sanitize text response to prevent XSS and format Markdown
            response = AIProvider.sanitizeAndFormatResponse(response);
        }

        logger.log('success', `AI generation completed`);

        return new Response(JSON.stringify({
            success: true,
            response
        }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e: any) {
        logger.log('error', `AI generation failed: ${e.message}`);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

async function handleRewrittenSearch(req: Request, env: Env) {
    try {
        const body = await req.json() as any;
        const { queries, context, topK, provider, model } = body;

        if (!queries || !Array.isArray(queries) || queries.length === 0) {
            return new Response(JSON.stringify({ error: "Missing or invalid queries array" }), { status: 400 });
        }

        logger.log('process', `Rewritten search requested for ${queries.length} queries`);

        const results = await VectorService.queryMultipleRewrittenVectors(
            env,
            queries,
            context,
            topK || 5,
            { provider, model }
        );

        logger.log('success', `Rewritten search completed for ${results.length} queries`);

        return new Response(JSON.stringify({
            success: true,
            results
        }), {
            headers: { "Content-Type": "application/json" }
        });
    } catch (e: any) {
        logger.log('error', `Rewritten search failed: ${e.message}`);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
}

// --- Helpers ---

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, Math.pow(2, i) * 100)); // Exponential backoff
        }
    }
    throw new Error("Retry failed"); // Should not reach here
}

// --- Curator ---

async function curateMemories(env: Env): Promise<void> {
  logger.log('info', "🧹 Curator starting...");

  const rawMemories = await getRawMemories(env.DB, 20);

  if (!rawMemories || rawMemories.length === 0) {
    return;
  }

  logger.log('process', `Curating ${rawMemories.length} new memories...`);

  for (const memory of rawMemories) {
    try {
        const similar = await VectorService.querySimilarVectors(env, memory.text, 3);
        const matches = similar.matches.filter(
            (m: any) => m.id !== memory.id && m.score > Number(env.SIMILIARITY_THRESHOLD || 0.92)
        );

        if (matches.length > 0) {
            const matchIds = matches.map((m: any) => m.id);
            const duplicates = await getMemoriesByIds(env.DB, matchIds);

            if (duplicates.length > 0) {
                const combinedText = [memory.text, ...duplicates.map((d) => d.text)].join("\n---\n");
                const prompt = `Consolidate these similar memory fragments into one concise, factual statement. Preserve all context tags/dates if possible.\n\n${combinedText}`;

                const newText = await AIProvider.generateText(env, prompt, {
                    model: "@cf/openai/gpt-oss-120b",
                    system: "You are a memory curator. Merge these memories accurately.",
                });

                await updateConsolidatedMemory(env.DB, memory.id, newText);
                await VectorService.upsertMemoryVector(env, newText, memory.id, memory.createdAt, {
                    priority_rank: 1, // Higher priority for consolidated memories
                    primary_tag: "consolidated"
                });

                const deleteIds = duplicates.map((d) => d.id);
                await deleteMemories(env.DB, deleteIds);
                await VectorService.deleteMemoryVectors(env, deleteIds);

                logger.log('success', `Merged ${deleteIds.length + 1} memories into ID ${memory.id}`);
                continue;
            }
        }

        await markMemoryProcessed(env.DB, memory.id);
    } catch (e: any) {
        logger.log('error', `Curator failed for memory ${memory.id}: ${e.message}`);
    }
  }
}
