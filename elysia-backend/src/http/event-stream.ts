/** Streams one event at a time, preserving backpressure and cancelling upstream work on disconnect. */
export function eventStream<T extends { type: string }>(options: {
  iterator: AsyncIterator<T>;
  first: IteratorResult<T>;
  signal: AbortSignal;
  abort: () => void;
  errorBody: (error: unknown) => unknown;
}): Response {
  const { iterator, signal } = options;
  const encoder = new TextEncoder();
  const encode = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let first: IteratorResult<T> | undefined = options.first;
  let closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => signal.removeEventListener('abort', onAbort);
  const stopIterator = () => { void iterator.return?.().catch(() => {}); };
  const onAbort = () => {
    if (closed) return;
    closed = true;
    cleanup();
    streamController.close();
    stopIterator();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      if (closed) return;
      try {
        const next = first ?? await iterator.next();
        first = undefined;
        if (closed) return;
        if (next.done) {
          controller.enqueue(encode('done', {}));
          closed = true;
          cleanup();
          controller.close();
        } else controller.enqueue(encode(next.value.type, next.value));
      } catch (error) {
        if (closed) return;
        if (!signal.aborted) controller.enqueue(encode('error', options.errorBody(error)));
        closed = true;
        cleanup();
        controller.close();
        stopIterator();
      }
    },
    cancel() {
      closed = true;
      cleanup();
      options.abort();
      stopIterator();
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  } });
}
