// Strategy Agent Types

export interface LogOptions {
    engagementId?: string;
    workflowId?: string;
    actionType?: "MESSAGE" | "TOOL_CALL" | "TOOL_RESULT" | "ERROR" | "VISION_RESULT" | "VISION_STRUCTURED_RESULT";
    toolName?: string;
    toolArgs?: any;
    provider?: string;
    model?: string;
    latencyMs?: number;
    tokens?: { input: number; output: number };
    status?: "SUCCESS" | "FAILURE";
    error?: string;
    metadataJson?: string;
}



export type VisionInput = {
    type: 'base64' | 'url';
    data: string; // The Base64 string or the URL
    mimeType?: string; // e.g., 'image/jpeg', 'image/png' (Required for Base64)
};

export interface VectorSearchOptions {
    // Standard Vectorize options
    topK?: number;
    returnValues?: boolean;
    returnMetadata?: boolean | 'all' | 'indexed' | 'none';
    namespace?: string;
    filter?: Record<string, any>;

    // Agent-specific options for embedding generation
    provider?: 'gemini' | 'openai' | 'worker-ai';
    model?: string;
}

export type AIProvider = "worker-ai" | "gemini" | "openai";

export interface AIModelOptions {
    provider?: AIProvider;
    model?: string;
}

export interface GenerateTextOptions extends AIModelOptions {
    system?: string;
    reasoningEffort?: "low" | "medium" | "high"; // Maps to specific provider options where applicable
    modelOptions?: AIModelOptions;
}

export interface GenerateStructuredOptions extends AIModelOptions {
    system?: string;
    reasoningEffort?: "low" | "medium" | "high";
    modelOptions?: AIModelOptions;
}

export interface GenerateVisionOptions extends AIModelOptions {
}

