import { expect, test } from 'bun:test';

test('AI conversation delete is owner-scoped and cascades messages', async () => {
  // Separate process with an in-memory database, never the user's data.
  const child = Bun.spawn([process.execPath, 'tests/fixtures/ai-delete.ts'], {
    cwd: import.meta.dir + '/..', env: { ...process.env, DATABASE_URL: ':memory:' }, stdout: 'pipe', stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, output: code ? stdout + stderr : '' }).toEqual({ code: 0, output: '' });
});
