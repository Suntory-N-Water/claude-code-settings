import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'japanese-guard.ts');
const ENGLISH = 'I updated the configuration file and verified that everything works.';
const JAPANESE = 'ビルドが通り、テストもすべて成功したので、ページを公開します。';
// 2 行で英字が 60 文字を超える途中報告
const ENGLISH_MULTILINE =
  'I have finished reading the configuration files.\n' +
  'Next I will update the build script, run the tests again, and report the results.';
// 1 行で英字が 60 文字以上 250 文字未満の前置き
const ENGLISH_ONE_LINE =
  'Register the page in the index after the existing entry, then publish it and check the build log.';
const WRAP_UP = 'mcp__ccd_turn__wrap_up';

const tempDir = mkdtempSync(join(tmpdir(), 'japanese-guard-test-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

type Entry = Record<string, unknown>;

const userPrompt = (text: string): Entry => ({ type: 'user', message: { role: 'user', content: text } });
const assistantText = (text: string): Entry => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const toolUse = (name = 'Bash', input: unknown = {}): Entry => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu', name, input }] },
});
const toolResult = (): Entry => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu', content: 'ok' }] },
});
const thinking = (text: string, thinkingDisplay: string): Entry => ({
  type: 'assistant',
  thinkingDisplay,
  message: { role: 'assistant', content: [{ type: 'thinking', thinking: text }] },
});

function writeTranscript(entries: Entry[]): string {
  const path = join(tempDir, `${crypto.randomUUID()}.jsonl`);
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n'));
  return path;
}

async function spawnHook(payload: object): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(['bun', 'run', SCRIPT], {
    stdin: new TextEncoder().encode(
      JSON.stringify({ session_id: 'japanese-guard-test', cwd: import.meta.dir, ...payload }),
    ),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  return { exitCode: await proc.exited, stdout };
}

function runHook(
  lastAssistantMessage: string | undefined,
  stopHookActive = false,
): Promise<{ exitCode: number; stdout: string }> {
  return spawnHook({
    hook_event_name: 'Stop',
    // 最終回答がまだ書き込まれていない transcript を再現するため、存在しないパスを渡す
    transcript_path: join(import.meta.dir, 'missing.jsonl'),
    stop_hook_active: stopHookActive,
    last_assistant_message: lastAssistantMessage,
  });
}

// Claude Code は最終回答を Stop hook の終了後に transcript へ書き込むため、transcript には最終回答を含めない
function runStopWithTranscript(entries: Entry[], lastAssistantMessage: string) {
  return spawnHook({
    hook_event_name: 'Stop',
    transcript_path: writeTranscript(entries),
    stop_hook_active: false,
    last_assistant_message: lastAssistantMessage,
  });
}

function runPreToolUse(toolInput: unknown) {
  return spawnHook({
    hook_event_name: 'PreToolUse',
    transcript_path: join(import.meta.dir, 'missing.jsonl'),
    tool_name: WRAP_UP,
    tool_input: toolInput,
    tool_use_id: 'tu',
  });
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

describe('ツール呼び出しの間の途中報告', () => {
  test('ツール呼び出しの間に複数行の英語の途中報告があるとき、最終回答が日本語でも差し戻すこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), assistantText(ENGLISH_MULTILINE), toolUse(), toolResult()],
      JAPANESE,
    );

    expect(stdout).toContain('（途中の報告）I have finished reading the configuration files.');
  });

  test('ツール呼び出しの前に、英字 60 文字以上 250 文字未満の 1 行の前置きがあるとき、差し戻さないこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), assistantText(ENGLISH_ONE_LINE), toolUse(), toolResult()],
      JAPANESE,
    );

    expect(stdout).not.toContain('block');
  });

  test('1 行の途中報告の英字が 250 文字以上あるとき、差し戻すこと', async () => {
    // ENGLISH_ONE_LINE は英字 80 文字なので、4 回つなげると 320 文字になる
    const longLine = Array(4).fill(ENGLISH_ONE_LINE).join(' ');

    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), assistantText(longLine), toolUse(), toolResult()],
      JAPANESE,
    );

    expect(stdout).toContain('（途中の報告）Register the page');
  });

  test('表示が updates の thinking に、複数行の英語の途中報告があるとき、差し戻すこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), thinking(ENGLISH_MULTILINE, 'updates'), toolUse(), toolResult()],
      JAPANESE,
    );

    expect(stdout).toContain('（途中の報告）I have finished reading the configuration files.');
  });

  test('表示が updates 以外の thinking に英語があるとき、差し戻さないこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), thinking(ENGLISH_MULTILINE, 'summarized'), toolUse(), toolResult()],
      JAPANESE,
    );

    expect(stdout).not.toContain('block');
  });

  test('前のターンにだけ英語の途中報告があるとき、差し戻さないこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [
        userPrompt('調べて'),
        assistantText(ENGLISH_MULTILINE),
        toolUse(),
        toolResult(),
        assistantText(JAPANESE),
        userPrompt('公開して'),
        toolUse(),
        toolResult(),
      ],
      JAPANESE,
    );

    expect(stdout).not.toContain('block');
  });
});

describe('複数の応答に分かれた最終回答', () => {
  test('transcript にある前の部分が英語で、last_assistant_message が日本語のとき、差し戻すこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), toolUse(), toolResult(), assistantText(ENGLISH)],
      JAPANESE,
    );

    expect(stdout).toContain(`- ${ENGLISH}`);
  });
});

describe('wrap_up に渡すまとめ文・質問文・ボタンの文言', () => {
  test('transcript の wrap_up 呼び出しのまとめ文が英語のとき、Stop hook が差し戻すこと', async () => {
    const { stdout } = await runStopWithTranscript(
      [userPrompt('公開して'), toolUse(WRAP_UP, { recap: ENGLISH, ask: 'Should I publish it now?' }), toolResult()],
      '（応答なし）',
    );

    expect(stdout).toContain(`（wrap_up のまとめ文・質問文・ボタン）${ENGLISH}`);
  });

  test.each([
    ['まとめ文と質問文が英語', { recap: ENGLISH, ask: 'Should I publish it now?' }],
    [
      'ボタンの配列が JSON 文字列で、その中の文言が英語',
      { recap: '公開の準備ができました。', actions: JSON.stringify([{ label: 'Go', message: ENGLISH }]) },
    ],
  ])('PreToolUse で %s のとき、拒否すること', async (_, toolInput) => {
    const { stdout } = await runPreToolUse(toolInput);

    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
    });
  });

  test('PreToolUse で wrap_up の文言がすべて日本語のとき、拒否しないこと', async () => {
    const { stdout } = await runPreToolUse({
      recap: JAPANESE,
      ask: '公開しますか？',
      actions: [{ label: '公開する', message: '公開してください。' }],
    });

    expect(stdout).not.toContain('deny');
  });
});

describe('差し戻しの回数', () => {
  test('差し戻したあとの再実行のとき、英語でも差し戻さないこと', async () => {
    const { stdout } = await runHook(ENGLISH, true);

    expect(stdout).not.toContain('block');
  });
});
