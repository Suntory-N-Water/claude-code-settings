import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'unfinished-work-guard.ts');

interface StopInput {
  lastAssistantMessage: string;
  transcriptPath?: string;
  stopHookActive?: boolean;
  backgroundTasks?: { status: string }[];
}

// 差し戻さないとき hook は何も出力しないので、空の出力を {} として比較できるようにする
async function runHook(input: StopInput): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'unfinished-work-guard-test',
        transcript_path: input.transcriptPath ?? join(import.meta.dir, 'missing.jsonl'),
        cwd: import.meta.dir,
        stop_hook_active: input.stopHookActive ?? false,
        last_assistant_message: input.lastAssistantMessage,
        background_tasks: input.backgroundTasks?.map((task, i) => ({
          id: `task-${i}`,
          type: 'local_agent',
          description: 'test task',
          ...task,
        })),
      }),
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return stdout.trim() === '' ? {} : JSON.parse(stdout);
}

describe('差し戻す文', () => {
  test('検証の作業を実行していないと報告したとき、その文を引用して差し戻すこと', async () => {
    const result = await runHook({
      lastAssistantMessage: '設定を修正しました。\nテストは実行していません。',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('- テストは実行していません。'),
    });
  });

  test.each([
    '確認はしていません。',
    '確認もしていません。',
  ])('名詞と「している」の間に助詞が入った不実施の報告(%s)のとき、差し戻すこと', async (sentence) => {
    const result = await runHook({
      lastAssistantMessage: `設定を修正しました。\n${sentence}`,
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(`- ${sentence}`),
    });
  });

  test('次の作業を宣言して終えたとき、差し戻すこと', async () => {
    const result = await runHook({
      lastAssistantMessage:
        'レビューの指摘を直しました。\n続けて、変更を機能ごとにコミットします。',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('- 続けて、変更を機能ごとにコミットします。'),
    });
  });

  test('作業の許可を求めて終えたとき、差し戻すこと', async () => {
    const result = await runHook({
      lastAssistantMessage: '修正方針は 2 つあり、A を推奨します。\nこの方針で進めてよいですか？',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('- この方針で進めてよいですか？'),
    });
  });
});

describe('差し戻さない文', () => {
  test.each([
    ['作業範囲の説明', '型定義だけを直しました。ロジックは変更していません。'],
    ['作業の対象の状態の説明', '口コミに投稿者 ID が付いていないため、件数だけを集計しました。'],
  ])('%s だけのとき、差し戻さないこと', async (_, message) => {
    const result = await runHook({ lastAssistantMessage: message });

    expect(result).toEqual({});
  });

  test.each([
    ['コードブロック', '例です。\n\n```\nテストは実行していません。\n```\n'],
    ['引用', '前回の返答です。\n> テストは実行していません。'],
    ['表', '| 区分 | 例 |\n|---|---|\n| 検証 | テストは実行していません。 |'],
    ['かぎかっこ', '「テストは実行していません」で終わる返答を検知します。'],
  ])('不実施の文が %s の中にだけあるとき、差し戻さないこと', async (_, message) => {
    const result = await runHook({ lastAssistantMessage: message });

    expect(result).toEqual({});
  });
});

describe('差し戻しを見送る状況', () => {
  const REPORT = '設定を修正しました。\nテストは実行していません。';

  test('同じターンですでに差し戻したあとのとき、差し戻さないこと', async () => {
    const result = await runHook({ lastAssistantMessage: REPORT, stopHookActive: true });

    expect(result).toEqual({});
  });

  test('バックグラウンドのタスクが実行中のとき、差し戻さないこと', async () => {
    const result = await runHook({
      lastAssistantMessage: REPORT,
      backgroundTasks: [{ status: 'completed' }, { status: 'running' }],
    });

    expect(result).toEqual({});
  });

  test('バックグラウンドのタスクがすべて完了しているとき、差し戻すこと', async () => {
    const result = await runHook({
      lastAssistantMessage: REPORT,
      backgroundTasks: [{ status: 'completed' }, { status: 'failed' }],
    });

    expect(result).toMatchObject({ decision: 'block' });
  });
});

describe('commit の報告', () => {
  const REPORT = '設定を修正しました。\nこの変更はまだコミットしていません。';

  async function withTranscript(
    prompt: string,
    extraEntries: Record<string, unknown>[] = [],
  ): Promise<string> {
    const path = join(tmpdir(), `unfinished-work-guard-${crypto.randomUUID()}.jsonl`);
    const entries = [{ type: 'user', message: { role: 'user', content: prompt } }, ...extraEntries];
    await Bun.write(path, entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
    return path;
  }

  test.each([
    'previous の結果を見て直して',
    'Gemini Enterprise の資料を読んで',
    'docs/progress.md に記録して',
  ])('依頼文の単語の一部にだけ PR が含まれるとき(%s)、コミットしていないという報告を差し戻さないこと', async (prompt) => {
    const transcriptPath = await withTranscript(prompt);

    const result = await runHook({ lastAssistantMessage: REPORT, transcriptPath });

    expect(result).toEqual({});
  });

  test('会話の圧縮後の要約にだけコミットの話があるとき、コミットしていないという報告を差し戻さないこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直して', [
      {
        type: 'user',
        isCompactSummary: true,
        message: { role: 'user', content: '前の会話の要約: 変更を commit して push した。' },
      },
    ]);

    const result = await runHook({ lastAssistantMessage: REPORT, transcriptPath });

    expect(result).toEqual({});
  });

  test('依頼文でコミットだけを頼んでいるとき、push していないという報告を差し戻さないこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直してコミットして');

    const result = await runHook({
      lastAssistantMessage: '設定を修正してコミットしました。\npush はしていません。',
      transcriptPath,
    });

    expect(result).toEqual({});
  });

  test('依頼文で push は不要と書いているとき、push していないという報告を差し戻さないこと', async () => {
    const transcriptPath = await withTranscript(
      '設定ファイルの typo を直してコミットして。push は不要',
    );

    const result = await runHook({
      lastAssistantMessage: '設定を修正してコミットしました。\npush はしていません。',
      transcriptPath,
    });

    expect(result).toEqual({});
  });

  test('依頼文で PR の作成を頼んでいるとき、push していないという報告を差し戻すこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直して PR を作って');

    const result = await runHook({
      lastAssistantMessage: '設定を修正してコミットしました。\npush はしていません。',
      transcriptPath,
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('- push はしていません。'),
    });
  });

  test('依頼文でコミットを頼んでいて、コミットしていない変更は残っていないと報告したとき、差し戻さないこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直してコミットして');

    const result = await runHook({
      lastAssistantMessage:
        '設定を修正してコミットしました。\nコミットしていない変更は残っていません。',
      transcriptPath,
    });

    expect(result).toEqual({});
  });

  test('依頼文にコミットの話がないとき、コミットしていないという報告を差し戻さないこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直して');

    const result = await runHook({ lastAssistantMessage: REPORT, transcriptPath });

    expect(result).toEqual({});
  });

  test('依頼文でコミットを頼んでいるとき、コミットしていないという報告を差し戻すこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直してコミットして');

    const result = await runHook({ lastAssistantMessage: REPORT, transcriptPath });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('- この変更はまだコミットしていません。'),
    });
  });

  test('依頼文でコミットを頼んでいて、コミットはしていないと報告したとき、差し戻すこと', async () => {
    const transcriptPath = await withTranscript('設定ファイルの typo を直してコミットして');

    const result = await runHook({
      lastAssistantMessage: '設定を修正しました。\nコミットはしていません。',
      transcriptPath,
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('- コミットはしていません。'),
    });
  });
});
