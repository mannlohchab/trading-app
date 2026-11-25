import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { checkMemory, MEMORY_LIMITS, sameMemory } from '../../src/modules/ai/domain/memory';
import { call, done, text } from '../helpers/fake-ai';
import { createTestApp } from '../helpers/test-app';
import { activeUser } from '../helpers/users';

describe('memory rules', () => {
  test('flattens to one line and refuses sensitive data', () => {
    expect(checkMemory('  Prefers\nswing   trades on 4h ')).toEqual({ ok: true, content: 'Prefers swing trades on 4h' });
    for (const bad of ['Email is asha@example.com', 'Phone +91 98765 43210', 'Card 4111 1111 1111 1111', 'Binance API key is abc', 'Their password is hunter2', 'PAN card ABCDE1234F']) {
      expect(checkMemory(bad).ok).toBe(false);
    }
    expect(checkMemory('Risks at most 2% of a 50000 USDT account per trade').ok).toBe(true);
    expect(checkMemory('x'.repeat(MEMORY_LIMITS.contentMax + 1)).ok).toBe(false);
    expect(sameMemory('Only trades BTC.', 'only trades  btc')).toBe(true);
  });
});

describe('assistant memory', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let u: Awaited<ReturnType<typeof activeUser>>;
  beforeAll(async () => {
    t = await createTestApp();
    await t.market.catalog.sync('BINANCE');
    u = await activeUser(t);
  });
  afterAll(() => t.close());

  const ask = async (content: string, http = u.c) => {
    const id = (await http.post('/api/v1/ai/conversations', {})).body.id as string;
    return http.post(`/api/v1/ai/conversations/${id}/messages`, { content, stream: false });
  };
  const toolResults = (i: number) => t.model.requests[i]!.messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content as string));

  test('a remembered fact appears in later conversations, and duplicates or secrets are not saved', async () => {
    t.model.script(
      [
        call('remember', { fact: 'Only trades BTC and ETH on the 4h timeframe' }, 'a'),
        call('remember', { fact: 'only trades BTC and ETH on the 4h timeframe.' }, 'b'),
        call('remember', { fact: 'Binance API key is xyz' }, 'c'),
        done(100, 10, 'tool_calls'),
      ],
      [text('Noted: BTC and ETH on 4h.'), done()],
    );
    expect((await ask('I only trade BTC and ETH on 4h. My Binance API key is xyz')).status).toBe(201);
    const [first, duplicate, secret] = toolResults(1);
    expect(first).toMatchObject({ saved: true });
    expect(duplicate).toMatchObject({ saved: false, alreadyRemembered: true, id: first.id });
    expect(secret.error).toContain('credential');

    const listed = (await u.c.get('/api/v1/ai/memories')).body.memories;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: first.id, content: 'Only trades BTC and ETH on the 4h timeframe' });

    t.model.script([text('Hi.'), done()]);
    await ask('Any ideas today?');
    const prompt = t.model.requests[0]!.messages[0]!.content as string;
    expect(prompt).toContain('What you remember');
    expect(prompt).toContain(`  - [${first.id}] Only trades BTC and ETH on the 4h timeframe`);
  });

  test('forget_memory deletes only the caller\'s own memories', async () => {
    const [memory] = (await u.c.get('/api/v1/ai/memories')).body.memories;
    const stranger = await activeUser(t);
    t.model.script(
      [call('forget_memory', { id: memory.id }), done(100, 10, 'tool_calls')],
      [text('Nothing to forget.'), done()],
    );
    await ask('Forget that', stranger.c);
    expect(toolResults(1)[0].error).toContain('No memory with that id');
    expect((await stranger.c.delete(`/api/v1/ai/memories/${memory.id}`)).status).toBe(404);
    expect((await stranger.c.get('/api/v1/ai/memories')).body.memories).toEqual([]);

    t.model.script(
      [call('forget_memory', { id: memory.id }), done(100, 10, 'tool_calls')],
      [text('Forgotten.'), done()],
    );
    await ask('Forget that I only trade BTC');
    expect(toolResults(1)[0]).toEqual({ forgotten: true, id: memory.id });
    expect((await u.c.get('/api/v1/ai/memories')).body.memories).toEqual([]);
  });

  test('users can delete memories from the app; the per-answer and per-user caps hold', async () => {
    t.model.script(
      [call('remember', { fact: 'Beginner' }, 'a'), call('remember', { fact: 'Long-term investor' }, 'b'), call('remember', { fact: 'Likes charts' }, 'c'), done(100, 10, 'tool_calls')],
      [text('Got it.'), done()],
    );
    await ask('About me');
    expect(toolResults(1)[2].error).toContain(`At most ${MEMORY_LIMITS.writesPerTurn} memories per answer`);
    const { memories } = (await u.c.get('/api/v1/ai/memories')).body;
    expect(memories.map((m: any) => m.content)).toEqual(['Beginner', 'Long-term investor']);

    expect((await u.c.delete(`/api/v1/ai/memories/${memories[0].id}`)).status).toBe(204);
    expect((await u.c.delete('/api/v1/ai/memories/not-a-uuid')).status).toBe(404);
    expect((await u.c.delete('/api/v1/ai/memories')).body).toEqual({ deleted: 1 });

    for (let i = 0; i < MEMORY_LIMITS.perUser; i++) await t.ai.memories.add(u.user.id, `Fact number ${i}`);
    t.model.script([call('remember', { fact: 'One more' }), done(100, 10, 'tool_calls')], [text('Full.'), done()]);
    await ask('Remember one more');
    expect(toolResults(1)[0].error).toContain('Memory is full');
  });
});
