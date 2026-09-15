import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEdit, introducedFindings } from './textlint-post-tool-use.ts';

const SCRIPT = join(import.meta.dir, 'textlint-post-tool-use.ts');
const SESSION_ID = 'textlint-post-tool-use-test';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(import.meta.dir, '.textlint-post-use-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

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

function postToolInput(
  toolName: 'Write' | 'Edit',
  filePath: string,
  toolInput: Record<string, string | boolean>,
) {
  return {
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    transcript_path: join(workspace, 'transcript.jsonl'),
    cwd: workspace,
    tool_name: toolName,
    tool_use_id: 'toolu_textlint_test',
    tool_input: { file_path: filePath, ...toolInput },
    tool_response: {},
  };
}

describe('textlint PostToolUse hook', () => {
  test('Write 後に指摘が残っていれば追加コンテキストで知らせる', async () => {
    const filePath = join(workspace, 'new.md');
    const content = 'この機能を処理の入口として使います。\n';
    await writeFile(filePath, content);
    const { exitCode, stdout } = await runHook(
      postToolInput('Write', filePath, { content }),
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringContaining('入口'),
      },
    });
  });

  test('編集がツールを止めない', async () => {
    const filePath = join(workspace, 'new.md');
    const content = 'この機能を処理の入口として使います。\n';
    await writeFile(filePath, content);
    const { stdout } = await runHook(
      postToolInput('Write', filePath, { content }),
    );

    expect(stdout).not.toContain('permissionDecision');
  });

  test('Edit で既存の指摘数が増えなければ何も返さない', async () => {
    const filePath = join(workspace, 'existing.md');
    await writeFile(filePath, '処理の入口を用意します。\n');
    const { exitCode, stdout } = await runHook(
      postToolInput('Edit', filePath, {
        old_string: '追加します',
        new_string: '用意します',
      }),
    );

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('additionalContext');
  });

  test('Edit で同じ指摘を増やせば知らせる', async () => {
    const filePath = join(workspace, 'existing.md');
    await writeFile(filePath, '処理の入口を入口として使います。\n');
    const { exitCode, stdout } = await runHook(
      postToolInput('Edit', filePath, {
        old_string: '追加します',
        new_string: '入口として使います',
      }),
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        additionalContext: expect.stringContaining('入口'),
      },
    });
  });
});

describe('textlint hook helpers', () => {
  test('Edit と replace_all の文字列置換を再現する', () => {
    expect(applyEdit('入口と入口', '入口', '境界', true)).toBe('境界と境界');
    expect(applyEdit('一意な文字列', '文字列', '文')).toBe('一意な文');
  });

  test('実行できない置換は候補を作らない', () => {
    expect(applyEdit('同じ同じ', '同じ', '別')).toBeUndefined();
    expect(applyEdit('本文', '存在しない', '別')).toBeUndefined();
  });

  test('既存指摘と同じ rule/message の件数増分だけを返す', () => {
    const existing = {
      ruleId: 'ai-words-ja/no-ai-words',
      message: '「入口」はよく使われる表現です。',
      line: 1,
      column: 1,
    };
    const after = [
      { ...existing, line: 2 },
      { ...existing, line: 4 },
    ];

    expect(introducedFindings([existing], after)).toEqual([
      { ...existing, line: 4 },
    ]);
  });
});
