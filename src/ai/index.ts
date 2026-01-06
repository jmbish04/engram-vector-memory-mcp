// Centralized AI Services Export

import { z } from "@hono/zod-openapi";
import * as Gemini from "./providers/gemini";
import * as OpenAI from "./providers/openai";
import * as WorkerAI from "./providers/worker-ai";
import { VisionInput } from "./types";
import { AIModelOptions, GenerateTextOptions, GenerateStructuredOptions, GenerateVisionOptions } from "./types";

// Providers (Namespaced to avoid function name collisions)
export { Gemini, OpenAI, WorkerAI };

// Utilities
export * from "./utils/sanitizer";
export * from "./utils/diagnostician";
export * from "./utils/ai-gateway";


// --- UNIFIED INTERFACES ---

export * from "./types";

// --- UNIFIED FUNCTIONS ---

/**
 * Generates text using the specified provider (defaults to Worker AI).
 */
export async function generateText(
    env: Env,
    prompt: string,
    options: GenerateTextOptions = {}
): Promise<string> {
    const provider = options.provider || "worker-ai";
    const system = options.system;

    switch (provider) {
        case "gemini":
            return Gemini.queryGemini(env, prompt, system, options.model);
        case "openai":
            return OpenAI.queryOpenAI(env, prompt, system, options.model);
        case "worker-ai":
        default:
            return WorkerAI.generateText(env, prompt, system, {
                effort: options.reasoningEffort
            });
    }
}

/**
 * Generates structured data using the specified provider (defaults to Worker AI).
 */
export async function generateStructured<T = any>(
    env: Env,
    prompt: string,
    schema: z.ZodType<T> | object,
    options: GenerateStructuredOptions = {}
): Promise<T> {
    const provider = options.provider || "worker-ai";
    const system = options.system;

    switch (provider) {
        case "gemini":
            // Gemini helper expects schema as object
            // We can pass Zod schema directly if we used zodToJsonSchema, but the helper might do it?
            // Checking Gemini.queryGeminiStructured signature: (env, prompt, schema: object, system?, model?)
            // It expects object. But we might pass Zod.
            // Let's assume the helper handles it or we need to convert?
            // Actually Gemini.ts imported zodToJsonSchema so it likely expects the JSON schema object directly if typed as object.
            // BUT looking at `src/ai/providers/gemini.ts`, queryGeminiStructured takes `schema: object` and passes it to `responseSchema`.
            // Google Gen AI SDK expects a Schema object (not raw JSON schema necessarily, but close).
            // However, our `generateStructured` generally takes Zod.
            // WorkerAI.generateStructured takes Zod or object.
            // OpenAI.queryOpenAIStructured takes object (jsonSchema).

            // Let's standardize on passing JSON Schema object to non-WorkerAI providers for safety if they don't support Zod.
            // Actually, for maximum compatibility, let's convert Zod to JSON schema if it looks like Zod, 
            // OR let the specific provider helpers handle it if they support it.

            // Re-reading Gemini.ts: it takes `schema: object`.
            // OpenAI.ts: takes `jsonSchema: object`.
            // WorkerAI.ts: takes `schema: z.ZodType<T> | object`.

            // We should convert here if needed.
            let jsonSchema: object;
            // Simplified check for Zod
            if (typeof schema === 'object' && schema !== null && ('_def' in schema || 'parse' in schema)) {
                const { zodToJsonSchema } = await import("zod-to-json-schema");
                jsonSchema = zodToJsonSchema(schema as any);
            } else {
                jsonSchema = schema as object;
            }

            return Gemini.queryGeminiStructured(env, prompt, jsonSchema, system, options.model);

        case "openai":
            // OpenAI helper takes jsonSchema object
            let oaSchema: object;
            if (typeof schema === 'object' && schema !== null && ('_def' in schema || 'parse' in schema)) {
                const { zodToJsonSchema } = await import("zod-to-json-schema");
                oaSchema = zodToJsonSchema(schema as any);
            } else {
                oaSchema = schema as object;
            }

            // OpenAI helper doesn't accept system prompt directly in sig, strictly (env, prompt, jsonSchema, model) in `queryOpenAIStructured`?
            // Wait, looking at OpenAI.ts: queryOpenAIStructured(env, prompt, jsonSchema, model)
            // It puts prompt in user message.
            // We should prepend system prompt if provided.
            const finalPrompt = system ? `System: ${system}\n\nUser: ${prompt}` : prompt;
            return OpenAI.queryOpenAIStructured(env, finalPrompt, oaSchema, options.model);

        case "worker-ai":
        default:
            // WorkerAI handles Zod natively in our helper
            return WorkerAI.generateStructured(env, prompt, schema, {
                structuringInstruction: system,
                reasoningEffort: options.reasoningEffort
            });
    }
}

/**
 * Generates embeddings using the specified provider (defaults to Worker AI).
 */
export async function generateEmbeddings(
    env: Env,
    text: string,
    options: AIModelOptions = {}
): Promise<number[]> {
    const provider = options.provider || "worker-ai";

    switch (provider) {
        case "gemini":
            return Gemini.generateEmbeddings(env, text, options.model);
        case "openai":
            return OpenAI.generateEmbeddings(env, text, options.model);
        case "worker-ai":
        default:
            return WorkerAI.generateEmbeddings(env, text, options.model);
    }
}

/**
 * Generates text from vision input using the specified provider (defaults to Worker AI).
 */
export async function generateVision(
    env: Env,
    image: VisionInput,
    prompt: string,
    options: GenerateVisionOptions = {}
): Promise<string> {
    const provider = options.provider || "worker-ai";

    switch (provider) {
        case "gemini":
            return Gemini.queryGeminiVision(env, image, prompt, options.model);
        case "openai":
            return OpenAI.queryOpenAIVision(env, image, prompt, options.model);
        case "worker-ai":
        default:
            return WorkerAI.generateVision(env, image, prompt, { modelName: options.model });
    }
}

