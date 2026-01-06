/**
 * Cloudflare Workers AI Model Advisor
 * 
 * Fetches the full model catalog from Cloudflare API and provides
 * intelligent recommendations based on use case requirements.
 */

// Types for the Cloudflare AI Models API response
export interface AIModel {
    id: string;
    name: string;
    description?: string;
    task: {
        id: string;
        name: string;
        description?: string;
    };
    properties?: Array<{
        property_id: string;
        value: string;
    }>;
    tags?: string[];
    beta?: boolean;
    source?: number;
}

export interface ModelListResponse {
    success: boolean;
    errors: any[];
    messages: any[];
    result: AIModel[];
}

// Minified model representation for context passing
export interface MinifiedModel {
    id: string;
    task: string;
    tags?: string[];
    beta?: boolean;
}

export interface MinifiedModelCatalog {
    textGen: MinifiedModel[];
    embeddings: MinifiedModel[];
    imageGen: MinifiedModel[];
    speech: MinifiedModel[];
    classification: MinifiedModel[];
    translation: MinifiedModel[];
    summarization: MinifiedModel[];
    objectDetection: MinifiedModel[];
    imageToText: MinifiedModel[];
    voiceActivity: MinifiedModel[];
}

// Use case context types
export type UseCaseContext =
    | 'strong-reasoning'
    | 'fast-inference'
    | 'code-generation'
    | 'vision'
    | 'multimodal'
    | 'embeddings'
    | 'image-generation'
    | 'speech-to-text'
    | 'text-to-speech'
    | 'translation'
    | 'summarization'
    | 'classification'
    | 'function-calling'
    | 'long-context'
    | 'multilingual'
    | 'cost-effective'
    | 'math-reasoning'
    | 'safety-moderation'
    | 'object-detection'
    | 'real-time-audio';

export interface ModelRecommendation {
    modelId: string;
    reason: string;
    alternatives: string[];
    taskType: string;
    capabilities: string[];
}

// Model metadata with capabilities (curated based on documentation)
const MODEL_CAPABILITIES: Record<string, { capabilities: string[]; score: Record<UseCaseContext, number> }> = {
    '@cf/openai/gpt-oss-120b': {
        capabilities: ['reasoning', 'agentic', 'production', 'general-purpose'],
        score: { 'strong-reasoning': 95, 'function-calling': 85, 'code-generation': 80, 'long-context': 75 } as any
    },
    '@cf/openai/gpt-oss-20b': {
        capabilities: ['reasoning', 'low-latency', 'specialized'],
        score: { 'fast-inference': 90, 'strong-reasoning': 75, 'cost-effective': 85 } as any
    },
    '@cf/meta/llama-4-scout-17b-16e-instruct': {
        capabilities: ['multimodal', 'moe', 'vision', 'batch', 'function-calling'],
        score: { 'multimodal': 95, 'vision': 95, 'function-calling': 90, 'strong-reasoning': 85 } as any
    },
    '@cf/meta/llama-3.3-70b-instruct-fp8-fast': {
        capabilities: ['batch', 'function-calling', 'fast', 'high-capacity'],
        score: { 'strong-reasoning': 90, 'fast-inference': 85, 'function-calling': 90, 'code-generation': 85 } as any
    },
    '@cf/meta/llama-3.1-8b-instruct-fast': {
        capabilities: ['fast', 'multilingual'],
        score: { 'fast-inference': 95, 'cost-effective': 90, 'multilingual': 80 } as any
    },
    '@cf/meta/llama-3.1-8b-instruct': {
        capabilities: ['multilingual', 'dialogue'],
        score: { 'cost-effective': 85, 'multilingual': 85, 'fast-inference': 75 } as any
    },
    '@cf/meta/llama-3.1-70b-instruct': {
        capabilities: ['multilingual', 'high-capacity'],
        score: { 'strong-reasoning': 88, 'multilingual': 90, 'long-context': 85 } as any
    },
    '@cf/qwen/qwq-32b': {
        capabilities: ['reasoning', 'thinking', 'lora'],
        score: { 'strong-reasoning': 92, 'math-reasoning': 95, 'code-generation': 80 } as any
    },
    '@cf/qwen/qwen2.5-coder-32b-instruct': {
        capabilities: ['code', 'lora'],
        score: { 'code-generation': 95, 'strong-reasoning': 75 } as any
    },
    '@cf/qwen/qwen3-30b-a3b-fp8': {
        capabilities: ['batch', 'function-calling', 'moe'],
        score: { 'function-calling': 90, 'multilingual': 85, 'strong-reasoning': 82 } as any
    },
    '@cf/google/gemma-3-12b-it': {
        capabilities: ['multimodal', 'lora', '128k-context', 'multilingual'],
        score: { 'long-context': 95, 'multimodal': 80, 'multilingual': 90, 'vision': 75 } as any
    },
    '@cf/mistralai/mistral-small-3.1-24b-instruct': {
        capabilities: ['vision', '128k-context', 'function-calling'],
        score: { 'vision': 90, 'long-context': 95, 'function-calling': 88, 'multimodal': 85 } as any
    },
    '@cf/deepseek/deepseek-r1-distill-qwen-32b': {
        capabilities: ['reasoning', 'distilled'],
        score: { 'strong-reasoning': 90, 'math-reasoning': 88 } as any
    },
    '@cf/meta/llama-guard-3-8b': {
        capabilities: ['safety', 'moderation', 'lora'],
        score: { 'safety-moderation': 95 } as any
    },
    '@cf/meta/llama-3.2-11b-vision-instruct': {
        capabilities: ['vision', 'image-reasoning', 'lora'],
        score: { 'vision': 92, 'multimodal': 88 } as any
    },
    '@cf/meta/llama-3.2-1b-instruct': {
        capabilities: ['lightweight', 'fast'],
        score: { 'fast-inference': 95, 'cost-effective': 95 } as any
    },
    '@cf/meta/llama-3.2-3b-instruct': {
        capabilities: ['lightweight', 'agent'],
        score: { 'fast-inference': 90, 'cost-effective': 90 } as any
    },
    '@cf/ibm/granite-4.0-h-micro': {
        capabilities: ['function-calling', 'agentic', 'rag', 'edge'],
        score: { 'function-calling': 92, 'fast-inference': 88, 'cost-effective': 85 } as any
    },
    '@hf/nousresearch/hermes-2-pro-mistral-7b': {
        capabilities: ['function-calling', 'json-mode'],
        score: { 'function-calling': 88, 'cost-effective': 82 } as any
    },
    // Embeddings
    '@cf/google/embeddinggemma-300m': {
        capabilities: ['embeddings', 'multilingual', '100-languages'],
        score: { 'embeddings': 95, 'multilingual': 95 } as any
    },
    '@cf/baai/bge-m3': {
        capabilities: ['embeddings', 'multilingual', 'multi-granularity'],
        score: { 'embeddings': 90, 'multilingual': 90 } as any
    },
    '@cf/baai/bge-large-en-v1.5': {
        capabilities: ['embeddings', 'batch', '1024-dim'],
        score: { 'embeddings': 88 } as any
    },
    '@cf/baai/bge-base-en-v1.5': {
        capabilities: ['embeddings', 'batch', '768-dim'],
        score: { 'embeddings': 82, 'cost-effective': 85 } as any
    },
    '@cf/baai/bge-small-en-v1.5': {
        capabilities: ['embeddings', 'batch', '384-dim'],
        score: { 'embeddings': 75, 'cost-effective': 95, 'fast-inference': 90 } as any
    },
    '@cf/qwen/qwen3-embedding-0.6b': {
        capabilities: ['embeddings', 'ranking'],
        score: { 'embeddings': 85 } as any
    },
    // Image Generation
    '@cf/black-forest-labs/flux-2-dev': {
        capabilities: ['image-gen', 'multi-reference', 'partner'],
        score: { 'image-generation': 95 } as any
    },
    '@cf/black-forest-labs/flux-1-schnell': {
        capabilities: ['image-gen', 'fast', '12b-params'],
        score: { 'image-generation': 88, 'fast-inference': 90 } as any
    },
    '@cf/leonardo/lucid-origin': {
        capabilities: ['image-gen', 'text-rendering', 'partner'],
        score: { 'image-generation': 90 } as any
    },
    '@cf/leonardo/phoenix-1.0': {
        capabilities: ['image-gen', 'prompt-adherence', 'partner'],
        score: { 'image-generation': 85 } as any
    },
    '@cf/bytedance/stable-diffusion-xl-lightning': {
        capabilities: ['image-gen', 'fast', '1024px'],
        score: { 'image-generation': 82, 'fast-inference': 95 } as any
    },
    // Speech
    '@cf/deepgram/nova-3': {
        capabilities: ['asr', 'batch', 'partner', 'real-time'],
        score: { 'speech-to-text': 95, 'real-time-audio': 95 } as any
    },
    '@cf/deepgram/flux': {
        capabilities: ['asr', 'voice-agents', 'partner', 'real-time'],
        score: { 'speech-to-text': 92, 'real-time-audio': 95 } as any
    },
    '@cf/openai/whisper-large-v3-turbo': {
        capabilities: ['asr', 'multilingual'],
        score: { 'speech-to-text': 90, 'multilingual': 88 } as any
    },
    '@cf/openai/whisper': {
        capabilities: ['asr', 'multilingual', 'translation'],
        score: { 'speech-to-text': 85, 'multilingual': 85, 'translation': 70 } as any
    },
    '@cf/deepgram/aura-2-en': {
        capabilities: ['tts', 'batch', 'partner', 'real-time'],
        score: { 'text-to-speech': 95, 'real-time-audio': 90 } as any
    },
    '@cf/deepgram/aura-1': {
        capabilities: ['tts', 'batch', 'partner', 'real-time'],
        score: { 'text-to-speech': 88, 'real-time-audio': 85 } as any
    },
    '@cf/myshell-ai/melotts': {
        capabilities: ['tts', 'multilingual'],
        score: { 'text-to-speech': 80, 'multilingual': 85 } as any
    },
    // Translation
    '@cf/meta/m2m100-1.2b': {
        capabilities: ['translation', 'batch', 'many-to-many'],
        score: { 'translation': 90, 'multilingual': 95 } as any
    },
    '@cf/ai4bharat/indictrans2-en-indic-1B': {
        capabilities: ['translation', 'indic-languages'],
        score: { 'translation': 85 } as any
    },
    // Classification
    '@cf/huggingface/distilbert-sst-2-int8': {
        capabilities: ['classification', 'sentiment'],
        score: { 'classification': 85 } as any
    },
    '@cf/baai/bge-reranker-base': {
        capabilities: ['reranking', 'relevance'],
        score: { 'classification': 80, 'embeddings': 70 } as any
    },
    // Summarization
    '@cf/facebook/bart-large-cnn': {
        capabilities: ['summarization'],
        score: { 'summarization': 85 } as any
    },
    // Object Detection
    '@cf/facebook/detr-resnet-50': {
        capabilities: ['object-detection', 'coco'],
        score: { 'object-detection': 85 } as any
    },
    // Voice Activity
    '@cf/pipecat-ai/smart-turn-v2': {
        capabilities: ['vad', 'batch', 'real-time'],
        score: { 'real-time-audio': 90 } as any
    },
};

// Task type mapping
const TASK_MAPPING: Record<string, string> = {
    'Text Generation': 'textGen',
    'Text Embeddings': 'embeddings',
    'Text-to-Image': 'imageGen',
    'Automatic Speech Recognition': 'speech',
    'Text-to-Speech': 'speech',
    'Text Classification': 'classification',
    'Translation': 'translation',
    'Summarization': 'summarization',
    'Object Detection': 'objectDetection',
    'Image-to-Text': 'imageToText',
    'Image Classification': 'classification',
    'Voice Activity Detection': 'voiceActivity',
};

/**
 * Fetches the complete model catalog from Cloudflare API
 */
export async function fetchModelCatalog(
    accountId: string,
    apiToken: string
): Promise<AIModel[]> {
    const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
        {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as ModelListResponse;

    if (!data.success) {
        throw new Error(`API error: ${JSON.stringify(data.errors)}`);
    }

    return data.result;
}

/**
 * Creates a minified model catalog for efficient context passing
 */
export function minifyModelCatalog(models: AIModel[]): MinifiedModelCatalog {
    const catalog: MinifiedModelCatalog = {
        textGen: [],
        embeddings: [],
        imageGen: [],
        speech: [],
        classification: [],
        translation: [],
        summarization: [],
        objectDetection: [],
        imageToText: [],
        voiceActivity: [],
    };

    for (const model of models) {
        const taskKey = TASK_MAPPING[model.task?.name || ''] || 'textGen';
        const minified: MinifiedModel = {
            id: model.name || model.id,
            task: model.task?.name || 'Unknown',
            tags: model.tags,
            beta: model.beta,
        };

        (catalog as any)[taskKey]?.push(minified);
    }

    return catalog;
}

/**
 * Gets the best model recommendation based on use case context
 */
export function recommendModel(
    context: UseCaseContext,
    _catalog?: MinifiedModelCatalog // Reserved for future use with dynamic catalog scoring
): ModelRecommendation {
    // Score all models for the given context
    const scored: Array<{ id: string; score: number; caps: string[] }> = [];

    for (const [modelId, meta] of Object.entries(MODEL_CAPABILITIES)) {
        const score = meta.score[context] || 0;
        if (score > 0) {
            scored.push({ id: modelId, score, caps: meta.capabilities });
        }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
        return {
            modelId: '@cf/meta/llama-3.1-8b-instruct',
            reason: `No specific model found for "${context}". Defaulting to Llama 3.1 8B as a versatile option.`,
            alternatives: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/qwen/qwen3-30b-a3b-fp8'],
            taskType: 'Text Generation',
            capabilities: ['multilingual', 'dialogue'],
        };
    }

    const best = scored[0];
    const alternatives = scored.slice(1, 4).map(s => s.id);

    // Determine task type from model ID
    let taskType = 'Text Generation';
    if (best.caps.includes('embeddings')) taskType = 'Text Embeddings';
    else if (best.caps.includes('image-gen')) taskType = 'Text-to-Image';
    else if (best.caps.includes('asr')) taskType = 'Automatic Speech Recognition';
    else if (best.caps.includes('tts')) taskType = 'Text-to-Speech';
    else if (best.caps.includes('translation')) taskType = 'Translation';
    else if (best.caps.includes('classification') || best.caps.includes('reranking')) taskType = 'Text Classification';
    else if (best.caps.includes('summarization')) taskType = 'Summarization';
    else if (best.caps.includes('object-detection')) taskType = 'Object Detection';
    else if (best.caps.includes('vad')) taskType = 'Voice Activity Detection';

    const reasons = RECOMMENDATION_REASONS[context] || `Best match for ${context} with score ${best.score}/100`;

    return {
        modelId: best.id,
        reason: reasons.replace('{model}', best.id),
        alternatives,
        taskType,
        capabilities: best.caps,
    };
}

// Detailed recommendation reasons
const RECOMMENDATION_REASONS: Record<UseCaseContext, string> = {
    'strong-reasoning': '{model} excels at complex reasoning tasks, achieving state-of-the-art performance on benchmarks.',
    'fast-inference': '{model} is optimized for low-latency inference, ideal for real-time applications.',
    'code-generation': '{model} is specifically trained on code and excels at programming tasks.',
    'vision': '{model} has native vision capabilities for image understanding and analysis.',
    'multimodal': '{model} handles both text and images natively with mixture-of-experts architecture.',
    'embeddings': '{model} produces high-quality vector representations for semantic search and RAG.',
    'image-generation': '{model} generates high-quality images from text prompts with excellent detail.',
    'speech-to-text': '{model} provides accurate speech recognition with support for multiple languages.',
    'text-to-speech': '{model} generates natural-sounding speech with context-aware pacing.',
    'translation': '{model} supports many-to-many multilingual translation.',
    'summarization': '{model} excels at text summarization tasks.',
    'classification': '{model} is optimized for text classification and sentiment analysis.',
    'function-calling': '{model} has robust function calling capabilities for agentic workflows.',
    'long-context': '{model} supports up to 128K context window for processing large documents.',
    'multilingual': '{model} trained on 100+ languages with excellent cross-lingual performance.',
    'cost-effective': '{model} provides excellent quality-to-cost ratio for budget-conscious applications.',
    'math-reasoning': '{model} excels at mathematical reasoning and problem-solving.',
    'safety-moderation': '{model} is specifically designed for content safety classification.',
    'object-detection': '{model} detects and localizes objects in images.',
    'real-time-audio': '{model} is optimized for real-time audio processing and voice agents.',
};

/**
 * Main advisor function - fetches catalog and provides recommendation
 */
export async function adviseModel(
    context: UseCaseContext,
    env: { CLOUDFLARE_ACCOUNT_ID: string; CLOUDFLARE_API_TOKEN: string }
): Promise<{
    recommendation: ModelRecommendation;
    catalog: MinifiedModelCatalog;
}> {
    const models = await fetchModelCatalog(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN);
    const catalog = minifyModelCatalog(models);
    const recommendation = recommendModel(context, catalog);

    return { recommendation, catalog };
}

/**
 * Lightweight advisor that uses curated model data (no API call)
 */
export function adviseModelOffline(context: UseCaseContext): ModelRecommendation {
    return recommendModel(context);
}

/**
 * Get all available use case contexts
 */
export function getAvailableContexts(): UseCaseContext[] {
    return [
        'strong-reasoning',
        'fast-inference',
        'code-generation',
        'vision',
        'multimodal',
        'embeddings',
        'image-generation',
        'speech-to-text',
        'text-to-speech',
        'translation',
        'summarization',
        'classification',
        'function-calling',
        'long-context',
        'multilingual',
        'cost-effective',
        'math-reasoning',
        'safety-moderation',
        'object-detection',
        'real-time-audio',
    ];
}

/**
 * For Workers environment - uses env.AI binding
 */
export function getModelForBinding(context: UseCaseContext): string {
    const recommendation = recommendModel(context);
    // Strip the @cf/ or @hf/ prefix if needed for certain binding formats
    return recommendation.modelId;
}

// Export a compact JSON string of the model capabilities for context injection
export const MODEL_CONTEXT_JSON = JSON.stringify(
    Object.entries(MODEL_CAPABILITIES).reduce((acc, [id, meta]) => {
        acc[id] = { c: meta.capabilities.slice(0, 3), s: Object.keys(meta.score) };
        return acc;
    }, {} as Record<string, { c: string[]; s: string[] }>)
);