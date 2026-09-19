import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { formatReport } from './textlint-stop.ts';

const SCRIPT = join(import.meta.dir, 'textlint-stop.ts');
const SESSION_ID = 'textlint-stop-test';

async function runHook(input: unknown): Promise<{
  exitCode: number;
  stdout: string;
}> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

function stopInput(lastAssistantMessage: string, stopHookActive = false) {
  return {
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    transcript_path: join(import.meta.dir, 'transcript.jsonl'),
    cwd: import.meta.dir,
    stop_hook_active: stopHookActive,
    last_assistant_message: lastAssistantMessage,
  };
}

describe('textlint Stop hook', () => {
  test('返答に指摘があればターンを差し戻す', async () => {
    const { exitCode, stdout } = await runHook(
      stopInput('この構成が効くかどうかを確かめます。'),
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('効く'),
    });
  });

  test('指摘がなければ何も返さない', async () => {
    const { exitCode, stdout } = await runHook(
      stopInput('設定を書き換えました。'),
    );

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('block');
  });

  test('差し戻し後の再実行では止めない', async () => {
    const { stdout } = await runHook(
      stopInput('この構成が効くかどうかを確かめます。', true),
    );

    expect(stdout).not.toContain('block');
  });

  test('日本語を含まない返答は検査しない', async () => {
    const { stdout } = await runHook(stopInput('Done.'));

    expect(stdout).not.toContain('block');
  });

  test('コードブロックの中は検査しない', async () => {
    const { stdout } = await runHook(
      stopInput('次のとおりです。\n\n```\nこの設定が効く\n```\n'),
    );

    expect(stdout).not.toContain('block');
  });
});

describe('textlint Stop hook の報告', () => {
  test('同じ指摘は件数にまとめる', () => {
    const report = formatReport([
      { ruleId: 'ai-words-ja/no-ai-words', message: '"効く" は避けたい。' },
      { ruleId: 'ai-words-ja/no-ai-words', message: '"効く" は避けたい。' },
      { ruleId: 'ai-words-ja/no-ai-words', message: '"経路" は避けたい。' },
    ]);

    expect(report).toContain('- "効く" は避けたい。 (2 箇所)');
    expect(report).toContain('- "経路" は避けたい。');
  });
});
