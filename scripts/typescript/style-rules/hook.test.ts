import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

const SEVERE = '型定義は鍵となる。';
const SESSION_ID = 'hook-test-session';
const SCRIPT_DIR = dirname(import.meta.dir);

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(import.meta.dir, '.hook-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function runHookScript(
  script: string,
  input: unknown,
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(['bun', 'run', join(SCRIPT_DIR, script)], {
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      STYLE_CHECK_STORE_ROOT: join(workspace, 'store'),
    },
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

describe('hook としての受け渡し', () => {
  test('PostToolUse の入力を流すと、差し戻しの判断が JSON で返ること', async () => {
    const filePath = join(workspace, 'a.md');
    await Bun.write(filePath, SEVERE);

    const { exitCode, stdout } = await runHookScript('style-check.ts', {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      transcript_path: join(workspace, 'transcript.jsonl'),
      cwd: workspace,
      tool_name: 'Write',
      tool_use_id: 'toolu_test',
      tool_input: { file_path: filePath, content: SEVERE },
      tool_response: { filePath, success: true },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(SEVERE),
    });
  });

  test('Stop の入力を流すと、終了の判断が JSON で返ること', async () => {
    const filePath = join(workspace, 'a.md');
    await Bun.write(filePath, SEVERE);
    await runHookScript('style-check.ts', {
      hook_event_name: 'PostToolUse',
      session_id: SESSION_ID,
      transcript_path: join(workspace, 'transcript.jsonl'),
      cwd: workspace,
      tool_name: 'Write',
      tool_use_id: 'toolu_test',
      tool_input: { file_path: filePath, content: SEVERE },
      tool_response: { filePath, success: true },
    });

    const { exitCode, stdout } = await runHookScript('style-check-stop.ts', {
      hook_event_name: 'Stop',
      session_id: SESSION_ID,
      transcript_path: join(workspace, 'transcript.jsonl'),
      cwd: workspace,
      stop_hook_active: false,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(SEVERE),
    });
  });
});
