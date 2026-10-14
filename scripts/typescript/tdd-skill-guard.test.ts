import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'tdd-skill-guard.ts');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tdd-skill-guard-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function writeTranscript(path: string, entries: unknown[]): Promise<void> {
  await Bun.write(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

function userText(text: string) {
  return { type: 'user', message: { role: 'user', content: text } };
}

function assistantToolUse(name: string, input: Record<string, unknown>) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name, input }] },
  };
}

async function runHook(options: {
  filePath: string;
  toolName?: 'Edit' | 'Write';
  transcriptPath?: string;
  agentId?: string;
}): Promise<{ exitCode: number; stdout: string }> {
  const toolName = options.toolName ?? 'Edit';
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'tdd-skill-guard-test',
        transcript_path: options.transcriptPath ?? join(dir, 'session.jsonl'),
        cwd: dir,
        permission_mode: 'default',
        tool_name: toolName,
        tool_use_id: 'toolu_target',
        tool_input:
          toolName === 'Edit'
            ? { file_path: options.filePath, old_string: 'a', new_string: 'b' }
            : { file_path: options.filePath, content: 'a' },
        ...(options.agentId === undefined
          ? {}
          : { agent_id: options.agentId, agent_type: 'general-purpose' }),
      }),
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

describe('スキルの起動記録がないとき', () => {
  test('テストファイルを編集するとき、スキルの起動を求めて deny すること', async () => {
    await writeTranscript(join(dir, 'session.jsonl'), [userText('テストを直して')]);

    const { exitCode, stdout } = await runHook({ filePath: '/repo/src/foo.test.ts' });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('general-dev-skills:test-driven-design'),
      },
    });
  });

  test('system-reminder のスキル一覧にだけスキル名が載っているとき、deny すること', async () => {
    await writeTranscript(join(dir, 'session.jsonl'), [
      userText(
        '<system-reminder>\nThe following skills are available:\n- general-dev-skills:test-driven-design: テスト設計・実装・レビュー\n</system-reminder>',
      ),
      userText('テストを直して'),
    ]);

    const { stdout } = await runHook({ filePath: '/repo/src/foo.test.ts' });

    expect(stdout).toContain('deny');
  });

  test('transcript ファイルが存在しないとき、deny すること', async () => {
    const { exitCode, stdout } = await runHook({
      filePath: '/repo/src/foo.test.ts',
      transcriptPath: join(dir, 'missing.jsonl'),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('deny');
  });
});

describe('スキルの起動記録があるとき', () => {
  test('ユーザーがスラッシュコマンドでスキルを起動済みのとき、deny しないこと', async () => {
    await writeTranscript(join(dir, 'session.jsonl'), [
      userText(
        '<command-message>general-dev-skills:test-driven-design</command-message>\n<command-name>/general-dev-skills:test-driven-design</command-name>',
      ),
    ]);

    const { exitCode, stdout } = await runHook({ filePath: '/repo/src/foo.test.ts' });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('deny');
  });

  test('Claude が Skill ツールでスキルを起動済みのとき、deny しないこと', async () => {
    await writeTranscript(join(dir, 'session.jsonl'), [
      userText('テストを直して'),
      assistantToolUse('Skill', { skill: 'general-dev-skills:test-driven-design' }),
    ]);

    const { stdout } = await runHook({ filePath: '/repo/src/foo.test.ts' });

    expect(stdout).not.toContain('deny');
  });

  test('サブエージェントが自分の transcript でスキルを起動済みのとき、deny しないこと', async () => {
    await writeTranscript(join(dir, 'session.jsonl'), [userText('テストを直して')]);
    await writeTranscript(join(dir, 'session', 'subagents', 'agent-a123.jsonl'), [
      userText('テストを直して'),
      assistantToolUse('Skill', { skill: 'general-dev-skills:test-driven-design' }),
    ]);

    const { stdout } = await runHook({ filePath: '/repo/src/foo.test.ts', agentId: 'a123' });

    expect(stdout).not.toContain('deny');
  });
});

describe('編集対象のファイル', () => {
  test('テストファイル以外を編集するとき、deny しないこと', async () => {
    await writeTranscript(join(dir, 'session.jsonl'), [userText('実装を直して')]);

    const { stdout } = await runHook({ filePath: '/repo/src/foo.ts' });

    expect(stdout).not.toContain('deny');
  });

  test.each([
    '/repo/src/foo.test.ts',
    '/repo/src/foo.spec.tsx',
    '/repo/src/sync.integration.test.ts',
    '/repo/src/foo.test.js',
  ])('%s を Write するとき、deny すること', async (filePath) => {
    await writeTranscript(join(dir, 'session.jsonl'), [userText('テストを書いて')]);

    const { stdout } = await runHook({ filePath, toolName: 'Write' });

    expect(stdout).toContain('deny');
  });
});
