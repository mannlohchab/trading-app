import type { ChatModelProvider, ChatRequest, ChatStreamEvent, ModelProfile } from '../../src/modules/ai';

export const FAKE_MODELS: ModelProfile[] = [
  { id: 'fake-main', provider: 'fake', providerModel: 'fake/main', label: 'Fake main', supportsTools: true, contextWindow: 100_000, maxOutputTokens: 512 },
  { id: 'fake-backup', provider: 'fake', providerModel: 'fake/backup', label: 'Fake backup', supportsTools: true, contextWindow: 100_000, maxOutputTokens: 512 },
];

type Step = ChatStreamEvent[] | Error | ((request: ChatRequest) => ChatStreamEvent[] | Error);

/** A scripted model: each call consumes the next step. Records every request. */
export class FakeChatModel implements ChatModelProvider {
  readonly name = 'fake';
  requests: ChatRequest[] = [];
  private steps: Step[] = [];
  /** Delay between streamed events (lets tests cancel mid-stream). */
  delayMs = 0;

  script(...steps: Step[]) { this.steps = steps; this.requests = []; }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push(structuredClone({ ...request, signal: undefined }));
    let step = this.steps.shift() ?? [text('(no more scripted replies)'), done()];
    if (typeof step === 'function') step = step(request);
    if (step instanceof Error) throw step;
    for (const event of step) {
      if (this.delayMs) await Bun.sleep(this.delayMs);
      request.signal?.throwIfAborted();
      yield event;
    }
  }
}

export const text = (delta: string): ChatStreamEvent => ({ type: 'text', delta });
export const call = (name: string, args: unknown, id = `call_${name}`): ChatStreamEvent => ({ type: 'tool_call', call: { id, name, arguments: JSON.stringify(args) } });
export const done = (inputTokens = 100, outputTokens = 20, finishReason: 'stop' | 'tool_calls' = 'stop'): ChatStreamEvent =>
  ({ type: 'done', finishReason, usage: { inputTokens, outputTokens, costUnits: 1.5, costUnit: 'neurons' } });
