import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'japanese-guard.ts');
const ENGLISH = 'I updated the configuration file and verified that everything works.';

async function runHook(
  lastAssistantMessage: string | undefined,
  stopHookActive = false,
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'japanese-guard-test',
        // 最終回答がまだ書き込まれていない transcript を再現するため、存在しないパスを渡す
        transcript_path: join(import.meta.dir, 'missing.jsonl'),
        cwd: import.meta.dir,
        stop_hook_active: stopHookActive,
        last_assistant_message: lastAssistantMessage,
      }),
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

describe('判定の対象にする本文', () => {
  test('最終回答が英語のとき、英語の箇所を引用して差し戻すこと', async () => {
    const { exitCode, stdout } = await runHook(ENGLISH);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(`- ${ENGLISH}`),
    });
  });

  test('英語の最終回答が日本語の画面文言を引用しているとき、差し戻すこと', async () => {
    const { stdout } = await runHook(
      'The "アウト" was too big: every drink card showed it as a filled red label. ' +
        'The caption now breaks after the comma: "23:00 に寝たとき、" / "体に残るカフェイン".',
    );

    expect(stdout).toContain('block');
  });

  test('last_assistant_message が無いとき、差し戻さずに正常終了すること', async () => {
    const { exitCode, stdout } = await runHook(undefined);

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('block');
  });
});

describe('英語主体の判定', () => {
  test('日本語の文に英単語が数語混じるとき、差し戻さないこと', async () => {
    const { stdout } = await runHook(
      'Claude Code の settings.json に Stop hook を登録し、japanese-guard が動くことを確認しました。',
    );

    expect(stdout).not.toContain('block');
  });

  test('英字が 24 文字のとき、差し戻さないこと', async () => {
    const { stdout } = await runHook('x'.repeat(24));

    expect(stdout).not.toContain('block');
  });

  test('英字が 25 文字のとき、差し戻すこと', async () => {
    const { stdout } = await runHook('x'.repeat(25));

    expect(stdout).toContain('block');
  });
});

describe('数えない要素', () => {
  test.each([
    ['コードブロック', `次のとおりです。\n\n\`\`\`\n${ENGLISH}\n\`\`\`\n`],
    ['インラインコード', `次のとおりです。\`${ENGLISH}\``],
    ['URL', '次のとおりです。https://example.com/docs/configuration/verification-guide'],
    ['メールアドレス', '次のとおりです。configuration.verification@example-company.com'],
    ['Markdown リンク', `次のとおりです。[${ENGLISH}](https://example.com)`],
  ])('英語が %s の中にだけあるとき、差し戻さないこと', async (_, finalText) => {
    const { stdout } = await runHook(finalText);

    expect(stdout).not.toContain('block');
  });
});

describe('差し戻しの回数', () => {
  test('差し戻したあとの再実行のとき、英語でも差し戻さないこと', async () => {
    const { stdout } = await runHook(ENGLISH, true);

    expect(stdout).not.toContain('block');
  });
});
