import * as AIProvider from "../ai";
import { AIModelOptions } from "../ai";

interface RewrittenQueryResult {
  originalQuery: string;
  rewrittenQuery: string;
  vectorResults: any;
}

export async function generateEmbedding(
  env: Env,
  text: string
): Promise<number[]> {
  // Ensure this uses the AIProvider correctly
  return await AIProvider.generateEmbeddings(env, text, {
    provider: "worker-ai",
    model: "@cf/baai/bge-large-en-v1.5",
  } as AIModelOptions);
}

export async function upsertMemoryVector(
  env: Env,
  text: string,
  id: string,
  timestamp: number,
  metadata?: {
    priority_rank?: number;
    primary_tag?: string;
    [key: string]: any;
  }
): Promise<void> {
  const values = await generateEmbedding(env, text);
  await env.VECTORIZE.upsert([
    {
      id,
      values,
      metadata: {
        created_at: timestamp,
        priority_rank: metadata?.priority_rank || 0,
        primary_tag: metadata?.primary_tag || "general",
        ...metadata,
      },
    },
  ]);
}

export async function querySimilarVectors(
  env: Env,
  text: string,
  topK: number = 3,
  returnMetadata: boolean = false
) {
  const values = await generateEmbedding(env, text);
  return await env.VECTORIZE.query(values, { topK, returnMetadata });
}

export async function deleteMemoryVectors(
  env: Env,
  ids: string[]
): Promise<void> {
  if (!ids?.length) return;
  await env.VECTORIZE.deleteByIds(ids);
}

/**
 * Processes multiple queries by rewriting them for MCP search and querying vectors.
 * This method enhances semantic search by rewriting user questions to be more specific
 * and suitable for vector similarity matching.
 *
 * @param env - The Cloudflare Worker environment
 * @param queries - Array of natural language queries to process
 * @param context - Optional context for query rewriting (bindings, libraries, tags, code snippets)
 * @param topK - Number of similar vectors to retrieve per query (default: 3)
 * @param rewriteOptions - Options for the AI provider used in query rewriting
 * @returns Array of results containing original query, rewritten query, and vector search results
 */
export async function queryMultipleRewrittenVectors(
  env: Env,
  queries: string[],
  context?: {
    bindings?: string[];
    libraries?: string[];
    tags?: string[];
    codeSnippets?: Array<{ file_path: string; code: string; relation: string }>;
  },
  topK: number = 3,
  rewriteOptions: {
    provider?: 'worker-ai' | 'gemini' | 'openai';
    model?: string;
  } = {}
): Promise<RewrittenQueryResult[]> {
  if (!queries.length) return [];

  // Process all queries in parallel for better performance
  const results = await Promise.allSettled(
    queries.map(async (originalQuery): Promise<RewrittenQueryResult> => {
      try {
        // 1. Rewrite the query for better MCP search
        const rewrittenQuery = await AIProvider.rewriteQuestionForMCP(
          env,
          originalQuery,
          context,
          rewriteOptions
        );

        // 2. Generate embedding for the rewritten query
        const values = await generateEmbedding(env, rewrittenQuery);

        // 3. Query the vector database
        const vectorResults = await env.VECTORIZE.query(values, {
          topK,
          returnMetadata: true
        });

        return {
          originalQuery,
          rewrittenQuery,
          vectorResults
        };
      } catch (error) {
        console.error(`Failed to process query "${originalQuery}":`, error);

        // Fallback: use original query if rewriting fails
        try {
          const values = await generateEmbedding(env, originalQuery);
          const vectorResults = await env.VECTORIZE.query(values, {
            topK,
            returnMetadata: true
          });

          return {
            originalQuery,
            rewrittenQuery: originalQuery, // Use original as fallback
            vectorResults
          };
        } catch (fallbackError) {
          console.error(`Fallback also failed for "${originalQuery}":`, fallbackError);

          // Return empty result if both attempts fail
          return {
            originalQuery,
            rewrittenQuery: originalQuery,
            vectorResults: { matches: [] }
          };
        }
      }
    })
  );

  // Filter out rejected promises and return successful results
  return results
    .filter((result): result is PromiseFulfilledResult<RewrittenQueryResult> =>
      result.status === 'fulfilled'
    )
    .map(result => result.value);
}
