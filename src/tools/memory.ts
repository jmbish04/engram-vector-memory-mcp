import { BaseMcpTool } from "./base";
import { z } from "zod";
import {
  createMemory,
  getMemoriesByIds,
} from "../db/queries";
import * as VectorService from "../db/vectorize";

interface MemoryMessage {
  text: string;
  context_tags?: string[];
  timestamp: number;
  source_app?: string;
  session_id?: string;
}

export class MemoryTools extends BaseMcpTool {
  register() {
    // TOOL 1: Save Memory (Async Ingestion)
    this.server.tool(
      "save_memory",
      {
        text: z.string().describe("The text to remember"),
        context_tags: z
          .array(z.string())
          .optional()
          .describe("Tags (e.g. ['coding', 'user-bio'])"),
        source_app: z.string().optional(),
        session_id: z.string().optional(),
      },
      async ({ text, context_tags, source_app, session_id }) => {
        const message: MemoryMessage = {
          text,
          context_tags: context_tags || ["general"],
          timestamp: Date.now(),
          source_app,
          session_id,
        };

        // Send to Queue for non-blocking processing
        await this.env.QUEUE.send(message);

        return {
          content: [
            {
              type: "text",
              text: `Memory queued: "${text.substring(0, 40)}..."`,
            },
          ],
        };
      }
    );

    // TOOL 2: Search Memory (Vector + D1 Lookup)
    this.server.tool(
      "search_memory",
      {
        query: z.string().describe("What to search for"),
        limit: z.number().optional().default(5),
      },
      async ({ query, limit = 5 }) => {
        try {
          // A. Vector Search
          const vectorResults = await VectorService.querySimilarVectors(this.env, query, limit);

          if (!vectorResults.matches || vectorResults.matches.length === 0) {
            return {
              content: [{ type: "text", text: "No memories found." }],
            };
          }

          // B. Hydrate Results from D1
          // Create a map of ID -> Score for easy lookup later
          const scoreMap = new Map(
            vectorResults.matches.map((m: any) => [m.id, m.score])
          );
          const ids = vectorResults.matches.map((m: any) => m.id);

          const dbResults = await getMemoriesByIds(this.env.DB, ids);

          // C. Format Output (Sort by vector score)
          const memories = dbResults
            .map((row) => ({
              ...row,
              score: scoreMap.get(row.id) || 0,
            }))
            .sort((a, b) => b.score - a.score) // Ensure sorted by relevance
            .map(
              (m, i) =>
                `${i + 1}. [Score: ${(m.score * 100).toFixed(1)}%] ${m.text}\n   (Source: ${m.tags ? JSON.parse(m.tags).join(", ") : "none"})`
            );

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
                text: `Search Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      }
    );
  }
}
