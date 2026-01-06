/**
 * -----------------------------------------------------------------------------
 * FILE: src/ai/providers/openai.ts
 * -----------------------------------------------------------------------------
 * DESCRIPTION:
 * OpenAI Provider Logic.
 * Includes: Text generation, Structured outputs, Vision, and Embeddings.
 * -----------------------------------------------------------------------------
 */

import OpenAI from "openai";
import { z } from "@hono/zod-openapi";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getAIGatewayUrl } from "../utils/ai-gateway";
import { VisionInput } from "../types";

export const DEFAULT_OPENAI_MODEL = "gpt-4o";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

// --- TOOL HELPERS ---

/**
 * Converts Zod to OpenAI Tool format.
 */
export function toOpenAITool(name: string, description: string, schema: z.ZodType<any>): any {
    const jsonSchema = zodToJsonSchema(schema as any, { target: "openApi3" });
    delete (jsonSchema as any).$schema;

    return {
        type: "function",
        function: {
            name,
            description,
            parameters: jsonSchema
        }
    };
}

// --- CLIENT FACTORY ---

export function createOpenAIClient(env: Env) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

    return new OpenAI({
        apiKey: apiKey,
        baseURL: getAIGatewayUrl(env, { provider: "openai" }),
        defaultHeaders: {
            'cf-aig-authorization': `Bearer ${env.CLOUDFLARE_AI_GATEWAY_TOKEN}`,
        },
    });
}

// --- QUERY METHODS ---

export async function queryOpenAI(
    env: Env,
    prompt: string,
    systemPrompt?: string,
    model: string = DEFAULT_OPENAI_MODEL
): Promise<string> {
    const client = createOpenAIClient(env);
    try {
        const messages: any[] = [];
        if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: prompt });

        const completion = await client.chat.completions.create({
            model,
            messages,
        });
        return completion.choices[0].message.content || "";
    } catch (error) {
        console.error("OpenAI Query Error:", error);
        throw error;
    }
}

export async function queryOpenAIStructured<T>(
    env: Env,
    prompt: string,
    jsonSchema: object,
    model: string = DEFAULT_OPENAI_MODEL
): Promise<T> {
    const client = createOpenAIClient(env);
    try {
        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "response",
                    schema: jsonSchema as any,
                    strict: true
                }
            }
        });
        const content = completion.choices[0].message.content || "{}";
        return JSON.parse(content);
    } catch (error) {
        console.error("OpenAI Structured Error:", error);
        throw error;
    }
}

export async function queryOpenAIVision(
    env: Env,
    image: VisionInput,
    prompt: string,
    modelName: string = DEFAULT_OPENAI_MODEL
): Promise<string> {
    const client = createOpenAIClient(env);
    try {
        let imageUrlContent: string;
        if (image.type === 'url') {
            imageUrlContent = image.data;
        } else {
            imageUrlContent = image.data.startsWith('data:')
                ? image.data
                : `data:${image.mimeType || 'image/jpeg'};base64,${image.data}`;
        }

        const completion = await client.chat.completions.create({
            model: modelName,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: imageUrlContent } }
                ]
            }],
        });
        return completion.choices[0].message.content || "";
    } catch (error) {
        console.error("OpenAI Vision Error:", error);
        throw error;
    }
}

// --- EMBEDDINGS ---

/**
 * Generates vector embeddings for a given text string using OpenAI.
 * Defaults to 'text-embedding-3-small'.
 */
export async function generateEmbeddings(
    env: Env,
    text: string,
    model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
    const client = createOpenAIClient(env);
    try {
        // OpenAI expects input as a string or array of tokens/strings.
        // We're wrapping single text generation here.
        const response = await client.embeddings.create({
            model,
            input: text,
            encoding_format: "float",
        });

        if (!response.data || response.data.length === 0) {
            throw new Error("OpenAI API returned no embedding data.");
        }

        return response.data[0].embedding;
    } catch (error) {
        console.error("OpenAI Embedding Error:", error);
        throw error;
    }
}