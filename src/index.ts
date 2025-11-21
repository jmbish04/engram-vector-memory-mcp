import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface MemoryMessage {
	text: string;
	context_tags?: string[];
	timestamp: number;
	source_app?: string;
	session_id?: string;
}

// Define our Memory MCP agent
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Global Memory System",
		version: "1.0.0",
	});

	async init() {
		// TOOL 1: Save Memory (Fast! Just pushes to queue)
		this.server.tool(
			"save_memory",
			{
				text: z.string().describe("The text to remember"),
				context_tags: z.array(z.string()).optional().describe("Optional tags for categorization (e.g., ['coding', 'preferences'])"),
				source_app: z.string().optional().describe("The application this memory came from"),
				session_id: z.string().optional().describe("Session identifier"),
			},
			async ({ text, context_tags, source_app, session_id }) => {
				const message: MemoryMessage = {
					text,
					context_tags: context_tags || ["general"],
					timestamp: Date.now(),
					source_app,
					session_id,
				};

				// Push to queue for async processing
				await this.env.QUEUE.send(message);

				return {
					content: [
						{
							type: "text",
							text: `Memory queued for processing: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`,
						},
					],
				};
			},
		);

		// TOOL 2: Search Memory (The Recall)
		this.server.tool(
			"search_memory",
			{
				query: z.string().describe("What to search for in memories"),
				limit: z.number().optional().default(5).describe("Number of results to return (default: 5)"),
				filter_tags: z.array(z.string()).optional().describe("Optional tags to filter by"),
			},
			async ({ query, limit = 5, filter_tags }) => {
				try {
					// 1. Generate vector for the query using Cloudflare AI
					const embeddings = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
						text: [query],
					});
					const queryVector = embeddings.data[0];

					// 2. Search the Vector Index
					const vectorResults = await this.env.VECTORIZE.query(queryVector, {
						topK: limit,
						returnMetadata: true,
					});

					// 3. Format results
					if (vectorResults.matches.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No memories found matching your query.",
								},
							],
						};
					}

					const memories = vectorResults.matches.map((match, idx) => {
						const metadata = match.metadata as any;
						return `${idx + 1}. [Score: ${match.score?.toFixed(3)}] ${metadata.text}\n   Tags: ${metadata.tags}\n   Created: ${metadata.created_at}`;
					});

					return {
						content: [
							{
								type: "text",
								text: `Found ${memories.length} memories:\n\n${memories.join("\n\n")}`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Error searching memories: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
					};
				}
			},
		);
	}
}

async function curateMemories(env: Env): Promise<void> {
	console.log("🧹 Memory Curator: Starting daily curation...");

	try {
		// 1. Get all memories from D1
		const result = await env.DB.prepare("SELECT * FROM memories ORDER BY created_at DESC").all();
		const memories = result.results as any[];

		if (memories.length < 2) {
			console.log("Not enough memories to curate");
			return;
		}

		console.log(`Found ${memories.length} memories to analyze`);

		// 2. Find similar memories using Vectorize
		const duplicatePairs: Array<{ memory: any; duplicates: any[] }> = [];

		for (const memory of memories) {
			// Get embedding for this memory
			const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
				text: [memory.text],
			});
			const vector = embeddings.data[0];

			// Search for very similar memories (>0.95 similarity)
			const similar = await env.VECTORIZE.query(vector, {
				topK: 5,
				returnMetadata: true,
			});

			const duplicates = similar.matches.filter(
				(match) => match.id !== memory.id && match.score && match.score > 0.95,
			);

			if (duplicates.length > 0) {
				duplicatePairs.push({ memory, duplicates });
			}
		}

		console.log(`Found ${duplicatePairs.length} potential duplicate groups`);

		// 3. Use LLM to intelligently consolidate duplicates
		let consolidatedCount = 0;

		for (const { memory, duplicates } of duplicatePairs.slice(0, 10)) {
			// Limit to 10 per run
			const duplicateTexts = duplicates.map((d, i) => `${i + 1}. ${d.metadata?.text}`).join("\n");

			const prompt = `You are a memory curator. Analyze these similar memories and create ONE consolidated memory that preserves all important information:

ORIGINAL:
${memory.text}

SIMILAR MEMORIES:
${duplicateTexts}

Create a single, comprehensive memory that combines the key information from all of these. Be concise but complete.`;

			const response = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
				messages: [{ role: "user", content: prompt }],
				max_tokens: 500,
			});

			const consolidatedText = (response as any).response;

			if (consolidatedText) {
				// Generate new embedding for consolidated memory
				const newEmbeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
					text: [consolidatedText],
				});
				const newVector = newEmbeddings.data[0];

				// Update the original memory
				await env.DB.prepare("UPDATE memories SET text = ? WHERE id = ?")
					.bind(consolidatedText, memory.id)
					.run();

				// Update in Vectorize
				await env.VECTORIZE.upsert([
					{
						id: memory.id,
						values: newVector,
						metadata: {
							text: consolidatedText,
							tags: memory.tags,
							created_at: memory.created_at,
							source_app: memory.source_app,
							session_id: memory.session_id,
						},
					},
				]);

				// Delete duplicates
				for (const dup of duplicates) {
					await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(dup.id).run();
					await env.VECTORIZE.deleteByIds([dup.id]);
				}

				consolidatedCount++;
				console.log(`✅ Consolidated memory ${memory.id} (removed ${duplicates.length} duplicates)`);
			}
		}

		console.log(`🎉 Memory Curator: Completed! Consolidated ${consolidatedCount} memory groups`);
	} catch (error) {
		console.error("❌ Memory Curator failed:", error);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		if (url.pathname === "/trigger-curator") {
			// Manual trigger for testing the curator
			ctx.waitUntil(curateMemories(env));
			return new Response("Memory curator triggered manually", { status: 200 });
		}

		return new Response("Not found", { status: 404 });
	},

	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		// Run the memory curator
		ctx.waitUntil(curateMemories(env));
	},

	async queue(batch: MessageBatch<MemoryMessage>, env: Env, ctx: ExecutionContext) {
		// Process queue messages directly (can't pass MessageBatch to Durable Objects)
		for (const message of batch.messages) {
			const { text, context_tags, timestamp, source_app, session_id } = message.body;

			try {
				// A. Generate Embedding using Cloudflare AI
				const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
					text: [text],
				});
				const vector = embeddings.data[0];

				// B. Store in Vectorize (Fast retrieval)
				const id = crypto.randomUUID();
				await env.VECTORIZE.insert([
					{
						id: id,
						values: vector,
						metadata: {
							text: text,
							tags: JSON.stringify(context_tags),
							created_at: new Date(timestamp).toISOString(),
							source_app: source_app || "unknown",
							session_id: session_id || "unknown",
						},
					},
				]);

				// C. Store in D1 SQL for complex analytics later
				await env.DB.prepare(
					"INSERT INTO memories (id, text, tags, created_at, source_app, session_id) VALUES (?, ?, ?, ?, ?, ?)",
				)
					.bind(id, text, JSON.stringify(context_tags), timestamp, source_app || "unknown", session_id || "unknown")
					.run();

				console.log(`✅ Successfully memorized: ${id}`);
				message.ack();
			} catch (err) {
				console.error("❌ Failed to process memory:", err);
				message.retry();
			}
		}
	},
};
