// One assistant turn: user message → model ↔ tools loop → structured, persisted reply.
import { assembleBlocks, type ResponseBlock } from '../domain/blocks';
import { toolResultContent } from '../domain/tool-context';
import { CODE_REMOVED_FALLBACK, createCodeFilter } from '../domain/code-filter';
import { createToolMarkupFilter, stripToolMarkup } from '../domain/tool-markup';
import { CONVERSATION_LIMITS, selectHistory, titleFromMessage } from '../domain/conversation';
import { buildSystemPrompt } from '../domain/prompt';
import { decideQuota, startOfUtcDay, type UsageLimits } from '../domain/usage-policy';
import { AiProviderError } from './errors';
import type {
  ChatMessage, ChatModelProvider, Clock, ConversationRepository, MessageMetadata, ModelProfile,
  ModelUsage, PersonaSource, StoredMessage, ToolCall, UsageRepository, UserSnapshotSource,
} from './ports';
import { renderTurnContext, type ClientTurnContext } from '../domain/turn-context';
import { ToolInputError, type AssistantTool } from './tools';
import { coerceToSchema } from './tool-arguments';

export type TurnEvent =
  | { type: 'user_message'; message: StoredMessage }
  | { type: 'status'; stage: 'thinking' }
  /** A tool call is starting; `arguments` is what the model asked for (parsed when it is valid JSON). */
  | { type: 'status'; stage: 'tool'; tool: string; callId: string; arguments?: unknown }
  | { type: 'tool_result'; callId: string; tool: string; ok: boolean; durationMs: number; error?: string }
  | { type: 'delta'; text: string }
  | { type: 'block'; block: ResponseBlock }
  | { type: 'assistant_message'; message: StoredMessage };

export type AssistantErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONVERSATION_BUSY' | 'DAILY_TURN_LIMIT' | 'DAILY_TOKEN_LIMIT' | 'UNKNOWN_MODEL' | AiProviderError['code'];

export class AssistantError extends Error {
  constructor(readonly code: AssistantErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'AssistantError';
  }
}

type Deps = {
  providers: ChatModelProvider[];
  models: ModelProfile[];
  defaultModelId: string;
  /** Tried in order when the chosen model fails before producing output. */
  fallbackModelIds: string[];
  conversations: ConversationRepository;
  usage: UsageRepository;
  persona: PersonaSource;
  /** What the user has saved and running, summarised into the system prompt each turn. */
  snapshot?: UserSnapshotSource;
  /** Tools for one turn, scoped to the user who is asking. */
  tools: (userId: string) => AssistantTool[];
  limits: UsageLimits;
  clock: Clock;
  /** When set, the system prompt may delegate public-source questions to research_web. */
  webResearch?: boolean;
  newId?: () => string;
  log?: (message: string, error?: unknown) => void;
};

/** Sent with the last model call of a turn, when no tools are offered any more. */
const FINAL_ROUND_NOTE = '[Note from the app, not the user] All tool steps for this reply are used up. Write your final answer now from the tool results above, in plain words. Do not call tools or write tool calls, code or JSON.';
const UNFINISHED_FALLBACK = 'I ran out of steps before I could finish this. Ask me to continue and I will pick up from the results above.';

const parseArguments = (raw: string): unknown => {
  try { return raw.trim() ? JSON.parse(raw) : {}; } catch { return undefined; }
};
const sumUsage = (a: ModelUsage, b: ModelUsage): ModelUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  ...((a.costUnits !== undefined || b.costUnits !== undefined) && { costUnits: (a.costUnits ?? 0) + (b.costUnits ?? 0), costUnit: a.costUnit ?? b.costUnit }),
});

export class AssistantService {
  private readonly busy = new Set<string>();
  private readonly providers: Map<string, ChatModelProvider>;

  constructor(private readonly deps: Deps) {
    this.providers = new Map(deps.providers.map(p => [p.name, p]));
  }

  /** Models that can be used right now (their provider is configured). */
  availableModels(): ModelProfile[] {
    return this.deps.models.filter(m => this.providers.has(m.provider));
  }

  async usageToday(userId: string) {
    const now = this.deps.clock.now();
    const totals = await this.deps.usage.totals(userId, startOfUtcDay(now));
    const decision = decideQuota(totals, this.deps.limits, now);
    return { ...totals, limits: this.deps.limits, resetAt: new Date(startOfUtcDay(now).getTime() + 86_400_000), allowed: decision.allowed };
  }

  async *sendMessage(input: { userId: string; conversationId: string; content: string; modelId?: string; context?: ClientTurnContext; signal?: AbortSignal }): AsyncGenerator<TurnEvent> {
    const { conversations, usage, clock } = this.deps;
    const content = input.content.trim();
    if (!content || content.length > CONVERSATION_LIMITS.messageMaxChars) {
      throw new AssistantError('VALIDATION_ERROR', `Messages must be 1 to ${CONVERSATION_LIMITS.messageMaxChars} characters.`);
    }
    const chain = this.modelChain(input.modelId);
    const conversation = await conversations.find(input.userId, input.conversationId);
    if (!conversation) throw new AssistantError('NOT_FOUND', 'Conversation not found.');

    const now = clock.now();
    const quota = decideQuota(await usage.totals(input.userId, startOfUtcDay(now)), this.deps.limits, now);
    if (!quota.allowed) {
      throw new AssistantError(quota.reason, 'Daily AI limit reached. It resets at 00:00 UTC.', { resetAt: quota.resetAt.toISOString() });
    }
    // One reply at a time per conversation (in this process), so turns can't interleave.
    if (this.busy.has(conversation.id)) throw new AssistantError('CONVERSATION_BUSY', 'A reply is already being generated in this conversation.');
    this.busy.add(conversation.id);

    let userMessage: StoredMessage | undefined;
    let text = '';
    let codeRemoved = false;
    let markupRemoved = false;
    const blocks: ResponseBlock[] = [];
    try {
      const history = selectHistory(await conversations.history(conversation.id, CONVERSATION_LIMITS.historyMaxMessages * 2));
      userMessage = await conversations.addMessage({ conversationId: conversation.id, role: 'USER', content });
      if (!conversation.title) await conversations.update(input.userId, conversation.id, { title: titleFromMessage(content) });
      yield { type: 'user_message', message: userMessage };

      const turnId = this.deps.newId ? this.deps.newId() : crypto.randomUUID();
      const [persona, snapshot] = await Promise.all([
        this.deps.persona.forUser(input.userId),
        this.deps.snapshot?.forUser(input.userId).catch(error => { this.deps.log?.('User snapshot failed', error); return {}; }) ?? {},
      ]);
      const tools = this.deps.tools(input.userId);
      const base: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(persona, clock.now(), { webResearch: this.deps.webResearch, userContext: renderTurnContext(snapshot, input.context) }) },
        ...history.map(m => m.role === 'USER' ? { role: 'user' as const, content: m.content } : { role: 'assistant' as const, content: stripToolMarkup(m.content) }),
        { role: 'user', content },
      ];
      const turn: ChatMessage[] = [];
      const toolLog: NonNullable<MessageMetadata['toolCalls']> = [];
      let total: ModelUsage = { inputTokens: 0, outputTokens: 0 };
      let finishReason = 'other';
      let model = chain[0]!;
      let rounds = 0;

      for (; rounds <= CONVERSATION_LIMITS.maxToolRounds; rounds++) {
        yield { type: 'status', stage: 'thinking' };
        const allowTools = model.supportsTools && rounds < CONVERSATION_LIMITS.maxToolRounds;
        const round = { text: '', calls: [] as ToolCall[], reasoning: undefined as string | undefined, reasoningDetails: undefined as unknown[] | undefined };
        // Tool-call markup written as text is taken out first (and run when tools are allowed);
        // then raw strategy definitions and code (see domain/tool-markup, domain/code-filter).
        const markup = createToolMarkupFilter();
        const filter = createCodeFilter();
        const show = (chunk: string) => (chunk ? filter.push(chunk) : '');
        // Out of tool steps: say so, or the model writes its next call out as text.
        const finalNote: ChatMessage[] = model.supportsTools && !allowTools ? [{ role: 'user', content: FINAL_ROUND_NOTE }] : [];
        let done: { finishReason: string; usage: ModelUsage } | undefined;
        let thinkingOff = false;

        // Try the chain; a model may be skipped only if it failed before producing any output.
        for (;;) {
          const started = Date.now();
          try {
            for await (const event of this.provider(model).stream({
              model: model.providerModel,
              messages: [...base, ...turn, ...finalNote],
              tools: allowTools ? tools.map(t => t.spec) : undefined,
              maxOutputTokens: model.maxOutputTokens,
              temperature: 0.3,
              ...(model.reasoningEffort && { reasoningEffort: model.reasoningEffort }),
              ...(thinkingOff && { disableThinking: true }),
              signal: input.signal,
            })) {
              if (event.type === 'text') {
                const safe = show(markup.push(event.delta));
                if (safe) { round.text += safe; text += safe; yield { type: 'delta', text: safe }; }
              }
              else if (event.type === 'tool_call') round.calls.push(event.call);
              else {
                done = event;
                if (event.reasoning) round.reasoning = event.reasoning;
                if (event.reasoningDetails?.length) round.reasoningDetails = event.reasoningDetails;
              }
            }
            await usage.record({ userId: input.userId, conversationId: conversation.id, turnId, provider: model.provider, model: model.id, status: 'SUCCEEDED', usage: done?.usage ?? { inputTokens: 0, outputTokens: 0 }, toolCalls: round.calls.length, latencyMs: Date.now() - started });
            // Hidden thinking used the whole output budget, so nothing came out: redo this step once
            // without thinking rather than end the turn with an empty reply.
            if (done?.finishReason === 'length' && !round.text && !round.calls.length && !markup.removed && !thinkingOff) {
              this.deps.log?.(`Model ${model.id} spent its output budget thinking; retrying the step without thinking`);
              thinkingOff = true;
              total = sumUsage(total, done.usage);
              done = undefined;
              round.reasoning = undefined;
              round.reasoningDetails = undefined;
              continue;
            }
            break;
          } catch (error) {
            const cancelled = input.signal?.aborted;
            await usage.record({ userId: input.userId, conversationId: conversation.id, turnId, provider: model.provider, model: model.id, status: cancelled ? 'CANCELLED' : 'FAILED', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: 0, latencyMs: Date.now() - started, errorCode: error instanceof AiProviderError ? error.code : 'UNEXPECTED' })
              .catch(e => this.deps.log?.('Recording AI usage failed', e));
            const next = chain[chain.indexOf(model) + 1];
            if (!cancelled && error instanceof AiProviderError && error.retryable && next && !round.text && !round.calls.length) {
              this.deps.log?.(`Model ${model.id} failed (${error.code}); falling back to ${next.id}`);
              model = next;
              continue;
            }
            throw error;
          }
        }

        const rest = show(markup.flush()) + filter.flush();
        if (rest) { round.text += rest; text += rest; yield { type: 'delta', text: rest }; }
        codeRemoved ||= filter.removed;
        if (markup.removed) {
          markupRemoved = true;
          if (allowTools) {
            for (const [index, call] of markup.calls.entries()) round.calls.push({ id: `text_call_${rounds}_${index}`, ...call });
          }
          this.deps.log?.(`Model wrote ${markup.calls.length} tool call(s) as text (${allowTools ? 'ran them' : 'no tools this step; dropped'}) in conversation ${conversation.id}`);
        }

        total = sumUsage(total, done?.usage ?? { inputTokens: 0, outputTokens: 0 });
        finishReason = done?.finishReason ?? 'other';
        if (!round.calls.length) break;

        turn.push({
          role: 'assistant',
          content: round.text || null,
          toolCalls: round.calls,
          ...(round.reasoning && { reasoning: round.reasoning }),
          ...(round.reasoningDetails && { reasoningDetails: round.reasoningDetails }),
        });
        for (const [index, call] of round.calls.entries()) {
          if (index >= CONVERSATION_LIMITS.maxToolCallsPerRound) {
            turn.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: 'Too many tool calls in one step; call fewer at a time.' }) });
            continue;
          }
          yield { type: 'status', stage: 'tool', tool: call.name, callId: call.id, arguments: this.typedArguments(tools, call.name, parseArguments(call.arguments)) };
          const started = Date.now();
          if (input.signal?.aborted) throw new Error('Assistant turn cancelled before tool execution.');
          const outcome = await this.runTool(tools, call);
          const durationMs = Date.now() - started;
          toolLog.push({ name: call.name, arguments: outcome.args, ok: outcome.ok, durationMs, ...(outcome.error && { error: outcome.error }) });
          yield { type: 'tool_result', callId: call.id, tool: call.name, ok: outcome.ok, durationMs, ...(outcome.error && { error: outcome.error }) };
          for (const block of outcome.blocks) { blocks.push(block); yield { type: 'block', block }; }
          turn.push({ role: 'tool', toolCallId: call.id, content: outcome.content });
        }
        // Answer written and only UI-only tools called (e.g. next-step buttons): another model round
        // would just repeat the answer, so the turn ends here.
        if (round.text.trim() && round.calls.every(c => tools.find(t => t.spec.name === c.name)?.terminal)) {
          finishReason = 'stop';
          break;
        }
      }

      if (codeRemoved && !text.trim()) { text = CODE_REMOVED_FALLBACK; yield { type: 'delta', text }; }
      else if (markupRemoved && !text.trim()) { text = UNFINISHED_FALLBACK; yield { type: 'delta', text }; }
      if (codeRemoved) this.deps.log?.(`Removed code from an assistant reply (conversation ${conversation.id})`);
      const assistant = await conversations.addMessage({
        id: turnId,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: text.trim(),
        metadata: { blocks: assembleBlocks(text, blocks), toolCalls: toolLog, finishReason, rounds: Math.min(rounds + 1, CONVERSATION_LIMITS.maxToolRounds + 1), modelId: model.id, ...(codeRemoved && { codeRemoved: true }) },
        modelProvider: model.provider,
        modelName: model.providerModel,
        tokenUsage: { ...total, calls: toolLog.length },
      });
      await conversations.touch(conversation.id);
      yield { type: 'assistant_message', message: assistant };
    } catch (error) {
      // Leave no orphaned question behind when nothing was answered; the client can resend it.
      if (userMessage && !text && !blocks.length) await conversations.deleteMessage(userMessage.id).catch(e => this.deps.log?.('Cleanup failed', e));
      else if (userMessage && (text || blocks.length)) {
        const partialText = text.trim() || 'The reply was interrupted. Submitted tasks and observed results are available in the cards below.';
        await conversations.addMessage({ conversationId: conversation.id, role: 'ASSISTANT', content: partialText, metadata: { blocks: assembleBlocks(partialText, blocks), interrupted: true } })
          .catch(e => this.deps.log?.('Saving a partial reply failed', e));
      }
      throw error;
    } finally {
      this.busy.delete(conversation.id);
    }
  }

  private modelChain(requested?: string): ModelProfile[] {
    const available = this.availableModels();
    if (!available.length) throw new AiProviderError('AI_NOT_CONFIGURED', 'The AI assistant is not configured on this server.', false);
    const byId = (id: string) => available.find(m => m.id === id);
    if (requested && !byId(requested)) throw new AssistantError('UNKNOWN_MODEL', `Unknown or unavailable model "${requested}".`, { models: available.map(m => m.id) });
    const first = byId(requested ?? this.deps.defaultModelId) ?? available[0]!;
    const rest = this.deps.fallbackModelIds.map(byId).filter((m): m is ModelProfile => !!m && m.id !== first.id);
    return [first, ...rest];
  }

  /** Arguments as the tool will read them (text-written numbers and lists converted), for logs and the live trace. */
  private typedArguments(tools: AssistantTool[], name: string, args: unknown) {
    const tool = tools.find(t => t.spec.name === name);
    return tool && args !== undefined ? coerceToSchema(args, tool.spec.parameters) : args;
  }

  private provider(model: ModelProfile) {
    return this.providers.get(model.provider)!;
  }

  private async runTool(tools: AssistantTool[], call: ToolCall): Promise<{ ok: boolean; args: unknown; content: string; blocks: ResponseBlock[]; error?: string }> {
    let args: unknown = call.arguments;
    try {
      args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch {
      return { ok: false, args, content: JSON.stringify({ error: 'Arguments were not valid JSON.' }), blocks: [], error: 'Arguments were not valid JSON.' };
    }
    const tool = tools.find(t => t.spec.name === call.name);
    if (tool) args = coerceToSchema(args, tool.spec.parameters);
    if (!tool) return { ok: false, args, content: JSON.stringify({ error: `Unknown tool "${call.name}".` }), blocks: [], error: 'Unknown tool' };
    try {
      const outcome = await tool.run(args);
      return { ok: true, args, content: toolResultContent(outcome.result), blocks: outcome.blocks ?? [] };
    } catch (error) {
      const expected = error instanceof ToolInputError || (error instanceof Error && error.name === 'MarketError');
      if (!expected) this.deps.log?.(`Tool ${call.name} failed`, error);
      const message = expected ? (error as Error).message : 'The tool failed. Tell the user the data is unavailable right now.';
      return { ok: false, args, content: JSON.stringify({ error: message }), blocks: [], error: message.slice(0, 500) };
    }
  }
}
