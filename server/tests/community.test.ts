import { expect, test } from 'bun:test';
test('community actions persist and feed state reflects the viewer', async () => {
  const child = Bun.spawn([process.execPath, 'tests/fixtures/community.ts'], {
    cwd: import.meta.dir + '/..', env: { ...process.env, DATABASE_URL: ':memory:' }, stdout: 'pipe', stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, output: code ? stdout + stderr : '' }).toEqual({ code: 0, output: '' });
});
