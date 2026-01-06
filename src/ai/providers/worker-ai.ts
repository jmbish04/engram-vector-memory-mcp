/**
 * -----------------------------------------------------------------------------
 * FILE: src/ai/providers/worker-ai.ts
 * -----------------------------------------------------------------------------
 * DESCRIPTION:
 * Centralized utility module for Cloudflare Workers AI.
 * Handles Text, Structured, Vision, Embeddings, and Tool Formatting.
 * -----------------------------------------------------------------------------
 */

import { z } from "@hono/zod-openapi";
import { zodToJsonSchema } from "zod-to-json-schema";
import { cleanJsonOutput, sanitizeAndFormatResponse } from "../utils/sanitizer";
import { VisionInput } from "../types";
import { recommendModel } from "../utils/worker-ai-advisor";

// --- Model Configuration ---

/** * @constant REASONING_MODEL 
 * @description GPT-OSS-120B is selected for its high reasoning capabilities. 
 * It is used via the Responses API for broad analysis, brainstorming, and drafting.
 */
const REASONING_MODEL = "@cf/openai/gpt-oss-120b";

/** * @constant STRUCTURING_MODEL 
 * @description Llama 3.3 70B is selected for its ability to strictly adhere to 
 * JSON schemas via the 'response_format' parameter.
 */
const STRUCTURING_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** * @constant VISION_MODEL 
 * @description Llama 3.2 11B Vision is selected for its multimodal capabilities, 
 * enabling high-fidelity image understanding and structured extraction from visual inputs.
 */
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

/** * @constant DEFAULT_EMBEDDING_MODEL 
 * @description BGE Large EN v1.5 is selected for generating high-quality 
 * 1024-dimensional vector embeddings for semantic search and RAG operations.
 */
const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";

export const WorkerAIModels = {
  TEXT_REASONING: REASONING_MODEL,
  TEXT_FAST: "@cf/meta/llama-3-8b-instruct",
  STRUCTURED: STRUCTURING_MODEL,
  VISION: VISION_MODEL,
  EMBEDDING: DEFAULT_EMBEDDING_MODEL
};

// --- TYPES ---

export interface ReasoningOptions {
  /** * Constrains effort on reasoning (if supported by model/binding).
   */
  effort?: "low" | "medium" | "high";

  /** * Controls the verbosity of the reasoning summary returned by the model.
   */
  summary?: "concise" | "detailed" | "auto";

  /** * If true, the output will be run through the `sanitizeAndFormatResponse` utility.
   * This converts Markdown to safe HTML and strips unsafe tags.
   */
  sanitize?: boolean;
}

export interface StructuredOptions {
  /** Constrains effort on the initial reasoning pass before structuring. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Optional system prompt to guide the final JSON formatting step. */
  structuringInstruction?: string;
}

// --- TOOL HELPERS ---

/**
 * Converts a Zod schema to a Worker AI compatible tool definition.
 * Worker AI uses the same format as OpenAI.
 */
export function toWorkerAITool(name: string, description: string, schema: z.ZodType<any>): any {
  const jsonSchema = zodToJsonSchema(schema as any) as any;
  // Worker AI/OpenAI do not support the $schema keyword in parameters
  delete jsonSchema.$schema;

  return {
    type: "function",
    function: {
      name,
      description,
      parameters: jsonSchema
    }
  };
}

// --- CORE FUNCTIONS ---

/**
 * Generates unstructured text (with optional sanitization) using the Reasoning Model.
 */
export async function generateText(
  env: Env,
  input: string,
  systemInstruction?: string,
  options?: ReasoningOptions
): Promise<string> {
  const payload: any = {
    input: systemInstruction
      ? `Instructions: ${systemInstruction}\n\nInput: ${input}`
      : input,
    reasoning: {
      effort: options?.effort || "medium",
      summary: options?.summary || "concise",
    },
  };

  try {
    // Cast model to 'any' to bypass strict typing of @cloudflare/workers-types if model ID is newer
    const response = await env.AI.run(REASONING_MODEL as any, payload);

    let textResult = "";
    // Handle Responses API output format
    if (typeof response === "object" && response !== null && "response" in response) {
      textResult = (response as any).response;
    } else {
      textResult = String(response);
    }

    if (options?.sanitize) {
      return sanitizeAndFormatResponse(textResult);
    }
    return textResult;
  } catch (error) {
    console.error("Worker AI Generation Error:", error);
    throw new Error(`Failed to generate text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generates strictly typed JSON using a 2-step CoT process.
 * 1. Reasoning Model (Analysis)
 * 2. Structuring Model (JSON Formatting)
 * 
 * Supports both raw JSON Schema object and ZodType.
 */
export async function generateStructured<T = any>(
  env: Env,
  prompt: string,
  schema: z.ZodType<T> | object,
  options?: StructuredOptions
): Promise<T> {
  try {
    // 0. Handle Zod -> JSON Schema conversion
    let jsonSchema: object;
    // Duck typing check for Zod schema
    if (typeof schema === 'object' && schema !== null && ('_def' in schema || 'parse' in schema)) {
      // Cast to any to usage zodToJsonSchema which expects ZodType
      jsonSchema = zodToJsonSchema(schema as any);
    } else {
      jsonSchema = schema as object;
    }

    // Step 1: Reasoning Phase
    const reasoningOutput = await generateText(
      env,
      prompt,
      "Analyze the following input comprehensively. Provide a detailed analysis that covers all aspects required.",
      { effort: options?.reasoningEffort || "high", sanitize: false }
    );

    if (!reasoningOutput || reasoningOutput.trim().length === 0) {
      throw new Error("Reasoning model returned no content.");
    }

    // Step 2: Structuring Phase
    const structuringPrompt = options?.structuringInstruction
      || "Extract information from the analysis and format it strictly according to the JSON schema.";

    const messages = [
      { role: "system", content: structuringPrompt },
      { role: "user", content: `Analysis Content:\n${reasoningOutput}` }
    ];

    const response = await env.AI.run(STRUCTURING_MODEL as any, {
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: jsonSchema,
          strict: true
        }
      }
    });

    if (typeof response === "object" && response !== null && "response" in response) {
      const rawJson = (response as any).response;
      // Ensure we clean any potential markdown wrappers before parsing
      return typeof rawJson === "object" ? rawJson : JSON.parse(cleanJsonOutput(String(rawJson)));
    }

    throw new Error("Unexpected response format from structuring model");
  } catch (error) {
    console.error("Worker AI Structured Chain Error:", error);
    throw error;
  }
}

/**
 * Generates text from an image (Vision) using Llama 3.2 11B.
 */
export async function generateVision(
  env: Env,
  image: VisionInput,
  prompt: string,
  options?: { modelName?: string }
): Promise<string> {
  let imageInput: number[] = [];

  if (image.type === 'base64') {
    const binaryString = atob(image.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    imageInput = Array.from(bytes);
  } else {
    throw new Error("Worker AI currently requires Base64 image input.");
  }

  try {
    const model = options?.modelName || VISION_MODEL;
    const response = await env.AI.run(model as any, {
      prompt: prompt,
      image: imageInput
    });
    return (response as any).response || JSON.stringify(response);
  } catch (error) {
    console.error("Worker AI Vision Error:", error);
    throw error;
  }
}

/**
 * Generates Structured Data from Vision Input.
 * Pipeline: Vision Analysis -> Description -> Reasoning (via generateStructured) -> JSON
 */
export async function generateVisionStructured<T>(
  env: Env,
  image: VisionInput,
  prompt: string,
  schema: z.ZodType<T>,
  options?: StructuredOptions & { modelName?: string }
): Promise<T> {
  const validationPrompt = `${prompt} 
    Describe the image in extreme detail, focusing specifically on the data points required to answer the prompt. 
    Do not output JSON yet, just describe the visual facts.`;

  // 1. Get raw description
  const rawDescription = await generateVision(env, image, validationPrompt, options);

  // 2. Extract structured data from description
  const resultObject = await generateStructured(
    env,
    `Extract data from this visual description:\n\n${rawDescription}`,
    schema,
    options // Pass options down (contains reasoningEffort, etc)
  );

  return resultObject;
}

/**
 * Generates vector embeddings using BGE Large.
 */
export async function generateEmbeddings(
  env: Env,
  text: string,
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
  try {
    const response = await env.AI.run(model as any, { text: [text] });
    return (response as any).data[0];
  } catch (error) {
    console.error(`Worker AI Embedding Error (${model}):`, error);
    throw error;
  }
}

/**
 * Generates text with tool support (Chat Model).
 */
export async function generateWithTools(
  env: Env,
  messages: any[],
  tools: any[],
  model: string = WorkerAIModels.TEXT_FAST
): Promise<any> {
  try {
    const response = await env.AI.run(model as any, {
      messages,
      tools
    } as any);
    return response;
  } catch (error) {
    console.error("Worker AI Tool Generation Error:", error);
    throw error;
  }
}

// --- EXPORTS ---

// Re-export the advisor for use in Agents that need dynamic selection
export { recommendModel };

// Backward Compatibility Aliases (if needed for migration)
export const queryWorkerAI = generateText;
// Re-map queryWorkerAIStructured to the new signature
export const queryWorkerAIStructured = async (env: Env, prompt: string, schema: object, systemPrompt?: string) => {
  return generateStructured(env, prompt, schema, { structuringInstruction: systemPrompt });
};
export const queryWorkerAIVision = generateVision;