import type { ModelProfile } from '../application/ports';

/**
 * Models verified end to end (streaming + tool calls + answering from tool results) on Workers AI.
 * Add a model here (or a profile for another provider) to make it selectable.
 */
export const WORKERS_AI_MODELS: ModelProfile[] = [
  {
    id: 'llama-4-scout',
    provider: 'workers-ai',
    providerModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout',
    supportsTools: true,
    contextWindow: 131_000,
    maxOutputTokens: 1024,
  },
  {
    id: 'mistral-small-3.1',
    provider: 'workers-ai',
    providerModel: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    label: 'Mistral Small 3.1',
    supportsTools: true,
    contextWindow: 128_000,
    maxOutputTokens: 1024,
  },
];
