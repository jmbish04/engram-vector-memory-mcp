import * as AIProvider from "../ai";
import { AIModelOptions } from "../ai";

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
  timestamp: number
): Promise<void> {
  const values = await generateEmbedding(env, text);
  await env.VECTORIZE.upsert([
    { id, values, metadata: { created_at: timestamp } },
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
