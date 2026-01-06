/**
 * -----------------------------------------------------------------------------
 * FILE: src/ai/providers/gemini.ts
 * -----------------------------------------------------------------------------
 * DESCRIPTION:
 * Gemini Provider Logic.
 * Includes: Text generation, Structured outputs, Vision, and Embeddings.
 * -----------------------------------------------------------------------------
 */

import { GoogleGenAI } from "@google/genai";
import { z } from "@hono/zod-openapi";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getAIGatewayUrl } from "../utils/ai-gateway";
import { VisionInput } from "../types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"; // Updated to latest flash or use "gemini-1.5-pro"
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";

// --- HISTORY & TOOL HELPERS ---

/**
 * Converts internal chat history to Gemini v1beta/v2 format.
 */
export function toGeminiHistory(history: { role: string; content: string | null }[]): any[] {
  return history.map(msg => {
    if (msg.role === 'user') {
      return { role: 'user', parts: [{ text: msg.content || "" }] };
    } else if (msg.role === 'assistant') {
      return { role: 'model', parts: [{ text: msg.content || "" }] };
    } else if (msg.role === 'system') {
      // Gemini doesn't have a strict 'system' role in history array (handled via systemInstruction).
      // We wrap it as user text to ensure context is preserved if passed here.
      return { role: 'user', parts: [{ text: `System Context: ${msg.content}` }] };
    }
    return { role: 'user', parts: [{ text: msg.content || "" }] };
  });
}

/**
 * Converts Zod to Gemini Tool format.
 */
export function toGeminiTool(name: string, description: string, schema: z.ZodType<any>): any {
  const jsonSchema = zodToJsonSchema(schema as any) as any;
  return {
    name,
    description,
    parameters: {
      type: 'OBJECT',
      properties: jsonSchema.properties,
      required: jsonSchema.required
    }
  };
}

// --- CLIENT FACTORY ---

export function createGeminiClient(env: Env) {
  const geminiApiKey = env.GEMINI_API_KEY;
  if (!geminiApiKey || !env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Missing GEMINI_API_KEY or CLOUDFLARE_ACCOUNT_ID");
  }

  return new GoogleGenAI({
    apiKey: geminiApiKey,
    apiVersion: "v1beta",
    httpOptions: {
      baseUrl: getAIGatewayUrl(env, { provider: "google-ai-studio" }),
      headers: { 'cf-aig-authorization': `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}` }
    },
  });
}

// --- QUERY METHODS ---

/**
 * Standard text generation.
 */
export async function queryGemini(
  env: Env,
  prompt: string,
  systemPrompt?: string,
  model: string = DEFAULT_GEMINI_MODEL
): Promise<string> {
  const client = createGeminiClient(env);
  try {
    const response = await client.models.generateContent({
      model,
      config: { systemInstruction: systemPrompt },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });
    return response.text || "";
  } catch (error) {
    console.error("Gemini Query Error:", error);
    throw error;
  }
}

/**
 * Structured Output generation (JSON mode).
 */
export async function queryGeminiStructured(
  env: Env,
  prompt: string,
  schema: object,
  systemPrompt?: string,
  model: string = "gemini-2.0-flash" // Flash is typically best for high-speed structured tasks
): Promise<any> {
  const client = createGeminiClient(env);
  try {
    const response = await client.models.generateContent({
      model,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: schema as any,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini");
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini Structured Query Error:", error);
    throw error;
  }
}

/**
 * Vision/Multimodal generation.
 */
export async function queryGeminiVision(
  env: Env,
  image: VisionInput,
  prompt: string,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<string> {
  const client = createGeminiClient(env);
  try {
    let imagePart;
    if (image.type === 'base64') {
      imagePart = {
        inlineData: {
          mimeType: image.mimeType || "image/jpeg",
          data: image.data
        }
      };
    } else {
      throw new Error("Gemini via this SDK helper currently requires Base64.");
    }

    const response = await client.models.generateContent({
      model: modelName,
      contents: [{
        role: "user",
        parts: [{ text: prompt }, imagePart]
      }]
    });
    return response.text || "";
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    throw error;
  }
}

// --- EMBEDDINGS ---

/**
 * Generates vector embeddings for a given text string.
 * Defaults to 'text-embedding-004'.
 */
export async function generateEmbeddings(
  env: Env,
  text: string,
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
  const client = createGeminiClient(env);
  try {
    // The Google Gen AI SDK expects 'contents' even for embeddings
    const response = await client.models.embedContent({
      model: model,
      contents: [{
        parts: [{ text: text }]
      }]
    });

    // Check for the existence of embeddings in the response
    if (!response.embeddings || response.embeddings.length === 0 || !response.embeddings[0].values) {
      throw new Error("Gemini API returned no embeddings.");
    }

    return response.embeddings[0].values;
  } catch (error) {
    console.error("Gemini Embedding Error:", error);
    throw error;
  }
}