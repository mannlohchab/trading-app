// OpenRouter request shape for the web-research sub-agent.
// The only accepted models are free NVIDIA Nemotron ids (`:free`). The request
// also sets a $0 price ceiling and disables fallbacks so OpenRouter cannot
// reroute the call onto a billed provider.

export const FREE_NEMOTRON_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const FREE_NEMOTRON_ID = /^nvidia\/nemotron-[a-z0-9]+(?:[.-][a-z0-9]+)*:free$/;

export function assertFreeNemotronModel(model: string): string {
  const id = model.trim().toLowerCase();
  if (!FREE_NEMOTRON_ID.test(id)) {
    throw new Error(
      `Research model must be a free NVIDIA Nemotron id ending in ":free" (received "${model.trim() || '(empty)'}"). ` +
      'Paid models, the openrouter/free router, and any fallback list are refused so this agent cannot spend credits.',
    );
  }
  return id;
}

export type FreeNemotronChatBody = {
  model: string;
  messages: unknown[];
  temperature: number;
  max_tokens: number;
  provider: {
    allow_fallbacks: false;
    sort: 'price';
    max_price: { prompt: 0; completion: 0; request: 0; image: 0 };
    data_collection: 'deny';
  };
  usage: { include: true };
  tools?: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  tool_choice?: 'auto';
};

export function freeNemotronChatBody(input: {
  model: string;
  messages: unknown[];
  maxTokens: number;
  temperature?: number;
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
}): FreeNemotronChatBody {
  const model = assertFreeNemotronModel(input.model);
  const body: FreeNemotronChatBody = {
    model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
    max_tokens: input.maxTokens,
    provider: {
      allow_fallbacks: false,
      sort: 'price',
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
      data_collection: 'deny',
    },
    // Ask OpenRouter to return the billed amount so a non-zero cost can be discarded.
    usage: { include: true },
  };
  if (input.tools?.length) {
    body.tools = input.tools.map(tool => ({ type: 'function', function: tool }));
    body.tool_choice = 'auto';
  }
  return body;
}

/** Accept only an exact zero. Missing, non-numeric, or any other amount is a refusal. */
export function assertZeroOpenRouterCost(payload: { usage?: unknown }): void {
  const usage = payload.usage;
  if (!usage || typeof usage !== 'object') {
    throw new Error('OpenRouter did not report a cost. The research completion was discarded.');
  }
  const record = usage as { cost?: unknown; cost_details?: unknown };
  const cost = numericCost(record.cost);
  if (cost !== 0) {
    throw new Error('OpenRouter reported a non-zero cost. The research completion was discarded.');
  }
  const details = record.cost_details;
  if (details && typeof details === 'object') {
    for (const value of Object.values(details)) {
      if (numericCost(value) !== 0) {
        throw new Error('OpenRouter reported a non-zero upstream cost. The research completion was discarded.');
      }
    }
  }
}

function numericCost(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
