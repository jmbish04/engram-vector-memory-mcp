import { z } from "@hono/zod-openapi";

/**
 * Standard Logger definition used by Agents and Tools.
 */
export type LogActionType =
    | "MESSAGE"
    | "TOOL_CALL"
    | "TOOL_RESULT"
    | "ERROR"
    | "VISION_RESULT"
    | "VISION_STRUCTURED_RESULT";

export interface LogOptions {
    actionType?: LogActionType;
    toolName?: string;
    toolArgs?: any;
    provider?: string;
    model?: string;
    latencyMs?: number;
    status?: "SUCCESS" | "FAILURE";
    error?: string;
    metadataJson?: string;
    [key: string]: any;
}

export type ToolLogger = (
    role: string,
    content: string,
    options?: LogOptions
) => Promise<void>;

/**
 * Interface for the return value of BaseTool.register()
 * This is what BaseAgent consumes to build its tool definitions.
 */
export interface ToolRegistration {
    name: string;
    description: string;
    schema: z.ZodType<any>;
    execute: (args: any) => Promise<any>;
}

export interface VisionInput {
    type: 'base64' | 'url';
    data: string;
    mimeType?: string;
}