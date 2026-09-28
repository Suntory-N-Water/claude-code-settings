import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'japanese-guard.ts');
const DIR = mkdtempSync(join(tmpdir(), 'japanese-guard-'));
const ENGLISH =
  'I updated the configuration file and verified that everything works.';
const JAPANESE = '設定ファイルを書き換えて、動作を確かめました。';

afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const user = (text: string) => ({ type: 'user', message: { content: text } });
const toolResult = () => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', content: 'ok' }] },
});
const assistant = (...content: object[]) => ({
  type: 'assistant',
  message: { content },
});
const text = (t: string) => ({ type: 'text', text: t });
const toolUse = () => ({ type: 'tool_use', name: 'Bash', input: {} });

let seq = 0;
function writeTranscript(entries: readonly object[]): string {
  const path = join(DIR, `${seq++}.jsonl`);
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n'));
  return path;
}

async function runHook(
  transcriptPath: string,
  stopHookActive = false,
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'japanese-guard-test',
        transcript_path: transcriptPath,
        cwd: DIR,
        stop_hook_active: stopHookActive,
      }),
    ),
    stdout: 'pipe',
    stderr: 'pipe',
    // 最終回答が見つからないケースで、書き込みを待つ 3 秒を払わない
    env: { ...process.env, JAPANESE_GUARD_WAIT: '0' },
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

const answerOf = (finalText: string) =>
  writeTranscript([user('やって'), assistant(text(finalText))]);

describe('判定の対象にする本文', () => {
  test('最終回答が英語のとき、英語の箇所を引用して差し戻すこと', async () => {
    const { exitCode, stdout } = await runHook(answerOf(ENGLISH));

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(`- ${ENGLISH}`),
    });
  });

  test('ツールを呼ぶ前の一言だけが英語のとき、差し戻さないこと', async () => {
    const path = writeTranscript([
      user('やって'),
      assistant(text(ENGLISH), toolUse()),
      toolResult(),
      assistant(text(JAPANESE)),
    ]);

    const { stdout } = await runHook(path);

    expect(stdout).not.toContain('block');
  });

  test('前のターンの最終回答が英語のとき、今のターンは差し戻さないこと', async () => {
    const path = writeTranscript([
      user('やって'),
      assistant(text(ENGLISH)),
      user('続けて'),
      assistant(text(JAPANESE)),
    ]);

    const { stdout } = await runHook(path);

    expect(stdout).not.toContain('block');
  });
});

describe('英語主体の判定', () => {
  test('日本語の文に英単語が数語混じるとき、差し戻さないこと', async () => {
    const { stdout } = await runHook(
      answerOf(
        'Claude Code の settings.json に Stop hook を登録し、japanese-guard が動くことを確認しました。',
      ),
    );

    expect(stdout).not.toContain('block');
  });

  test('英字が 24 文字のとき、差し戻さないこと', async () => {
    const { stdout } = await runHook(answerOf('x'.repeat(24)));

    expect(stdout).not.toContain('block');
  });

  test('英字が 25 文字のとき、差し戻すこと', async () => {
    const { stdout } = await runHook(answerOf('x'.repeat(25)));

    expect(stdout).toContain('block');
  });
});

describe('数えない要素', () => {
  test.each([
    ['コードブロック', `次のとおりです。\n\n\`\`\`\n${ENGLISH}\n\`\`\`\n`],
    ['インラインコード', `次のとおりです。\`${ENGLISH}\``],
    [
      'URL',
      '次のとおりです。https://example.com/docs/configuration/verification-guide',
    ],
    [
      'メールアドレス',
      '次のとおりです。configuration.verification@example-company.com',
    ],
    ['Markdown リンク', `次のとおりです。[${ENGLISH}](https://example.com)`],
  ])('英語が %s の中にだけあるとき、差し戻さないこと', async (_, finalText) => {
    const { stdout } = await runHook(answerOf(finalText));

    expect(stdout).not.toContain('block');
  });
});

describe('差し戻しの回数', () => {
  test('差し戻したあとの再実行のとき、英語でも差し戻さないこと', async () => {
    const { stdout } = await runHook(answerOf(ENGLISH), true);

    expect(stdout).not.toContain('block');
  });
});

describe('失敗時', () => {
  test('transcript が存在しないとき、差し戻さずに正常終了すること', async () => {
    const { exitCode, stdout } = await runHook(join(DIR, 'missing.jsonl'));

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('block');
  });
});
