import { expect, test } from 'bun:test';

for (const scenario of ['history', 'quota', 'missing-config', 'disconnect']) {
  test(`AI chat route: ${scenario}`, async () => {
    // Each scenario gets its own database and module configuration, never the user's data.
    const child = Bun.spawn([process.execPath, 'tests/fixtures/ai-route.ts', scenario], {
      cwd: import.meta.dir + '/..',
      env: { ...process.env, DATABASE_URL: ':memory:' },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ code, output: code ? stdout + stderr : '' }).toEqual({ code: 0, output: '' });
  });
}
