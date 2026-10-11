#!/usr/bin/env bun
import { defineHook } from 'cc-hooks-ts';

// minorun365/claude-code-japanese-guard の japanese-guard.py を移植したもの

// 「OK」「Done」程度の短い返事は見逃す
const MIN_LATIN = Number(process.env.JAPANESE_GUARD_MIN_LATIN ?? '25');
const RATIO = Number(process.env.JAPANESE_GUARD_RATIO ?? '3');

const JA = /[ぁ-んァ-ヶ一-龥]/gu;
const LATIN = /[A-Za-z]/g;
// 英語のコマンドや英文の下書きを見せるのは正当な使い方なので数えない
const IGNORE = [
  /```[\s\S]*?```/g,
  /`[^`\n]*`/g,
  // URL より先に消す。URL の規則はリンクの閉じかっこまで消してしまい、リンクとして当たらなくなる
  /\[[^\]]*\]\([^)]*\)/g,
  /https?:\/\/\S+/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

function isEnglish(text: string): boolean {
  const stripped = IGNORE.reduce((acc, pattern) => acc.replace(pattern, ''), text);
  const latin = stripped.match(LATIN)?.length ?? 0;
  const ja = stripped.match(JA)?.length ?? 0;
  return latin >= MIN_LATIN && latin > ja * RATIO;
}

function formatReason(text: string): string {
  return [
    'このターンの本文に、英語で書いた箇所があります。',
    `- ${(text.trim().split('\n')[0] ?? '').slice(0, 80)}`,
    'ユーザーは日本語での応答を求めています。上に挙げた英語の箇所だけを、日本語に書き直して出してください。' +
      '日本語で書けていた部分は、すでにユーザーに届いているので再掲しないこと。' +
      '言い訳や原因の説明は書かず、以降の応答もすべて日本語で書くこと。',
  ].join('\n');
}

const hook = defineHook({
  trigger: {
    Stop: true,
  },

  run: (context) => {
    // 書き直しが再び英語でも差し戻しを続けないよう、1 ターンに一度だけにする
    if (context.input.stop_hook_active) {
      return context.success();
    }

    // Claude Code は最終回答を Stop hook の終了後に transcript へ書き込むため、transcript からは読めない。
    // last_assistant_message は最後のツール呼び出しより後の本文なので、ツール前の途中の一言は含まない
    const text = context.input.last_assistant_message ?? '';
    if (!isEnglish(text)) {
      return context.success();
    }
    return context.json({
      event: 'Stop',
      output: {
        decision: 'block',
        reason: formatReason(text),
      },
    });
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
