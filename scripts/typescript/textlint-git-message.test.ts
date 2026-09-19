import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { formatReport } from './textlint-git-message.ts';

const SCRIPT = join(import.meta.dir, 'textlint-git-message.ts');

async function runHook(command: string): Promise<{
  exitCode: number;
  stdout: string;
}> {
  const input = {
    hook_event_name: 'PreToolUse',
    session_id: 'textlint-git-message-test',
    transcript_path: join(import.meta.dir, 'transcript.jsonl'),
    cwd: import.meta.dir,
    tool_name: 'Bash',
    tool_use_id: 'toolu_textlint_git_message_test',
    tool_input: { command },
  };
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

describe('git / gh のメッセージを検査する PreToolUse hook', () => {
  test('コミットメッセージに指摘があれば実行を止めること', async () => {
    const { exitCode, stdout } = await runHook(
      'git commit -m "fix: この設定が効くようにする"',
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('効く'),
      },
    });
    expect(
      JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason,
    ).toContain('コミットメッセージ');
  });

  test('PR の本文に指摘があれば実行を止めること', async () => {
    const { stdout } = await runHook(
      `gh pr create --title "fix: 設定を直す" --body "$(cat <<'EOF'\n## 概要\n\nこの設定が効くようにした。\nEOF\n)"`,
    );

    const reason = JSON.parse(stdout).hookSpecificOutput
      .permissionDecisionReason as string;
    expect(reason).toContain('PR の本文');
    expect(reason).toContain('効く');
  });

  test('Issue のコメントに指摘があれば実行を止めること', async () => {
    const { stdout } = await runHook(
      'gh issue comment 12 --body "この設定が効くようにした。"',
    );

    const reason = JSON.parse(stdout).hookSpecificOutput
      .permissionDecisionReason as string;
    expect(reason).toContain('Issue のコメント');
    expect(reason).toContain('効く');
  });

  test('指摘がなければ実行を止めないこと', async () => {
    const { exitCode, stdout } = await runHook(
      'git commit -m "fix: 設定の読み込み順を直す"',
    );

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('deny');
  });

  test('git や gh を含まないコマンドは検査しないこと', async () => {
    const { stdout } = await runHook('echo "この設定が効く"');

    expect(stdout).not.toContain('deny');
  });

  test('日本語を含まないコマンドは検査しないこと', async () => {
    const { stdout } = await runHook('git commit -m "fix: typo"');

    expect(stdout).not.toContain('deny');
  });

  test('読み取りだけの gh コマンドは対象にしないこと', async () => {
    expect(
      (await runHook('gh pr view 5 --json title,body')).stdout,
    ).not.toContain('deny');
    expect((await runHook('gh issue view 12 --comments')).stdout).not.toContain(
      'deny',
    );
  });

  test('存在しない --body-file は検査せず実行を止めないこと', async () => {
    const { stdout } = await runHook(
      'gh pr create --title "件名を直す" --body-file /tmp/no-such-body.md',
    );

    expect(stdout).not.toContain('deny');
  });
});

describe('指摘の報告', () => {
  test('対象ごとに見出しを付け、上限を超えた分は件数にまとめること', () => {
    const findings = Array.from({ length: 10 }, (_, index) => ({
      ruleId: 'ai-words-ja/no-ai-words',
      message: `指摘 ${index}`,
      line: index + 1,
      column: 1,
    }));

    const report = formatReport([{ label: 'PR の本文', findings }]);

    expect(report).toContain('[PR の本文]');
    expect(report).toContain('- 1:1 指摘 0 (ai-words-ja/no-ai-words)');
    expect(report).toContain('- ほか 2 件');
  });
});
