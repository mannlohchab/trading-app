import { HttpError } from './errors';

const tooLarge = () => new HttpError(413, { error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' });

/** Bounds memory before parsing, even when a client omits or lies about Content-Length. */
export async function limitedRequestBody(request: Request, maxBytes: number): Promise<Request> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge();
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request.url, { method: request.method, headers: request.headers, signal: request.signal, body: bytes });
}
