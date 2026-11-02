export type AiKind = 'chat' | 'analysis' | 'portfolio';
export type AiEvent = { type: string; content?: string; conversationId?: string; message?: string; error?: string };

// One active request per visible conversation, including same-frame taps.
export function createAiRequestGate() {
  let active: AbortController | null = null;
  return {
    begin() {
      if (active) return null;
      active = new AbortController();
      return active;
    },
    isCurrent(request: AbortController) { return active === request && !request.signal.aborted; },
    finish(request: AbortController) { if (active === request) active = null; },
    reset() { active?.abort(); active = null; },
  };
}

export async function consumeAiStream(stream: ReadableStream<Uint8Array>, onEvent: (event: AiEvent) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const dispatch = (line: string) => {
    if (!line.trim().startsWith('data:')) return;
    let event: AiEvent;
    try {
      event = JSON.parse(line.trim().slice(5).trim());
    } catch {
      throw new Error('The AI response could not be read. Please try a new chat.');
    }
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'error') throw new Error(event.message || event.error || event.content || 'AI request failed');
    if (event.type === 'done') completed = true;
    onEvent(event);
  };
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        dispatch(line);
        if (completed) break;
      }
      if (done) {
        if (buffer && !completed) dispatch(buffer);
        break;
      }
    }
    if (!completed) throw new Error('Response interrupted. Start a new chat to retry.');
  } finally {
    try { await reader.cancel(); } catch { /* Fetch may already be aborted. */ }
    reader.releaseLock();
  }
}
