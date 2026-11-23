import { describe, expect, test } from 'bun:test';
import { OpenRouterScriptLlm } from '../../src/modules/ai/infrastructure/openrouter-script';
import { OpenRouterTts } from '../../src/modules/ai/infrastructure/openrouter-tts';

describe('OpenRouter Morning Decode adapters', () => {
  test('leaves room for the script after Nemotron reasoning consumes 1200 tokens', async () => {
    const model = new OpenRouterScriptLlm({
      apiKey: 'test-key', model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const enoughRoom = body.max_tokens >= 2400;
        return Response.json({ choices: [{ finish_reason: enoughRoom ? 'stop' : 'length', message: { content: enoughRoom ? 'The market briefing.' : '' } }] });
      },
    });
    expect((await model.complete({ system: 'Write a briefing', user: 'Verified facts' })).text).toBe('The market briefing.');
  });

  test('rejects JSON returned with a successful speech status', async () => {
    const tts = new OpenRouterTts({ apiKey: 'test-key', model: 'hexgrad/kokoro-82m', voice: 'af_heart', fetch: async () => Response.json({ error: 'provider failed' }) });
    await expect(tts.speak('Morning briefing.')).rejects.toThrow();
  });

  test('returns the generated MP3 bytes', async () => {
    const bytes = Buffer.from('ID3-test-audio');
    const tts = new OpenRouterTts({ apiKey: 'test-key', model: 'hexgrad/kokoro-82m', voice: 'af_heart', fetch: async () => new Response(bytes, { headers: { 'Content-Type': 'audio/mpeg' } }) });
    const audio = await tts.speak('Morning briefing.');
    expect(audio.bytes.equals(bytes)).toBe(true);
    expect(audio.contentType).toBe('audio/mpeg');
  });
});
