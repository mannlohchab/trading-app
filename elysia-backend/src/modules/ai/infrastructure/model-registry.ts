import type { ModelProfile } from '../application/ports';
import { FREE_NEMOTRON_MODEL } from '../domain/free-nemotron';

/**
 * The app's main models (Xiaomi MiMo Token Plan). When a MiMo key is set these are the only chat
 * models offered: ultraspeed answers ~3x faster than pro, pro and flash are its fallbacks.
 * Their reasoning counts against maxOutputTokens, hence the larger budget.
 */
export const MIMO_MODELS: ModelProfile[] = [
  { id: 'mimo-ultraspeed', provider: 'mimo', providerModel: 'mimo-v2.6-pro-ultraspeed', label: 'MiMo Pro Ultraspeed', supportsTools: true, contextWindow: 128_000, maxOutputTokens: 8192, reasoningEffort: 'low' },
  { id: 'mimo-pro', provider: 'mimo', providerModel: 'mimo-v2.6-pro', label: 'MiMo Pro', supportsTools: true, contextWindow: 128_000, maxOutputTokens: 8192, reasoningEffort: 'low' },
  { id: 'mimo-flash', provider: 'mimo', providerModel: 'mimo-v2.6-flash', label: 'MiMo Flash', supportsTools: true, contextWindow: 128_000, maxOutputTokens: 4096, reasoningEffort: 'low' },
];
export const MIMO_DEFAULT_MODEL = 'mimo-ultraspeed';
export const MIMO_FALLBACK_MODELS = ['mimo-pro', 'mimo-flash'];

/** Default chat model. OpenRouter's free Nemotron endpoint; the provider refuses any other id. */
export const NEMOTRON_FREE_MODEL: ModelProfile = {
  id: 'nemotron-free',
  provider: 'openrouter',
  providerModel: FREE_NEMOTRON_MODEL,
  label: 'Nemotron 3 Ultra',
  supportsTools: true,
  contextWindow: 128_000,
  maxOutputTokens: 4096,
};

/**
 * Models verified end to end (streaming + tool calls + answering from tool results) on Workers AI.
 * Add a model here (or a profile for another provider) to make it selectable.
 */
export const WORKERS_AI_MODELS: ModelProfile[] = [
  {
    // Default since 2026-11-12: in a live comparison it was the only model on the Workers Free plan
    // that used every tool correctly and never wrote raw code. It reasons before answering, and
    // that hidden thinking counts against max tokens, so the budget is larger than the others'.
    id: 'gpt-oss-120b',
    provider: 'workers-ai',
    providerModel: '@cf/openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    supportsTools: true,
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    reasoningEffort: 'low',
  },
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
