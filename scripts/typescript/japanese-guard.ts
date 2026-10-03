#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { defineHook } from 'cc-hooks-ts';

// minorun365/claude-code-japanese-guard の japanese-guard.py を移植したもの

// 「OK」「Done」程度の短い返事は見逃す
const MIN_LATIN = Number(process.env.JAPANESE_GUARD_MIN_LATIN ?? '25');
const RATIO = Number(process.env.JAPANESE_GUARD_RATIO ?? '3');
const WAIT_MS = Number(process.env.JAPANESE_GUARD_WAIT ?? '3') * 1000;
const MAX_QUOTED = 5;

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

type Block = { type?: string; text?: string };
type Entry = {
  type?: string;
  isMeta?: boolean;
  message?: { content?: string | Block[] };
};

function isEnglish(text: string): boolean {
  const stripped = IGNORE.reduce((acc, pattern) => acc.replace(pattern, ''), text);
  const latin = stripped.match(LATIN)?.length ?? 0;
  const ja = stripped.match(JA)?.length ?? 0;
  return latin >= MIN_LATIN && latin > ja * RATIO;
}

function blocksOf(entry: Entry): Block[] {
  const content = entry.message?.content;
  return Array.isArray(content)
    ? content.filter((c): c is Block => typeof c === 'object' && c !== null)
    : [];
}

// type が user でも、ツール結果やメタ情報はユーザーの発言ではない
function isUserTurn(entry: Entry): boolean {
  if (entry.type !== 'user' || entry.isMeta) {
    return false;
  }
  const content = entry.message?.content;
  if (typeof content === 'string') {
    return true;
  }
  return Array.isArray(content) && !blocksOf(entry).some((c) => c.type === 'tool_result');
}

function readEntries(path: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

function turnEndedInText(entries: readonly Entry[]): boolean {
  for (const entry of [...entries].reverse()) {
    if (entry.type === 'assistant') {
      return blocksOf(entry).at(-1)?.type === 'text';
    }
    // ツール結果が最後なら、最終回答はまだ書き込まれていない
    if (entry.type === 'user') {
      return false;
    }
  }
  return false;
}

// Stop hook は最終回答が transcript へ書き込まれる前に呼ばれることがあり、
// そのまま読むと英語でも素通りする
async function waitForFinal(path: string): Promise<Entry[]> {
  const deadline = Date.now() + WAIT_MS;
  let entries = readEntries(path);
  while (!turnEndedInText(entries) && Date.now() < deadline) {
    await Bun.sleep(100);
    entries = readEntries(path);
  }
  return entries;
}

// ツールを呼ぶ前の途中の一言は画面で小さく出るだけなので、最後のツール呼び出しより後の本文だけを見る
function englishPassages(entries: readonly Entry[]): string[] {
  const start = entries.map(isUserTurn).lastIndexOf(true) + 1;
  let final: string[] = [];
  for (const entry of entries.slice(start)) {
    if (entry.type !== 'assistant') {
      continue;
    }
    for (const block of blocksOf(entry)) {
      if (block.type === 'tool_use') {
        final = [];
      } else if (block.type === 'text') {
        final.push(block.text ?? '');
      }
    }
  }
  return final.filter(isEnglish).map((text) => (text.trim().split('\n')[0] ?? '').slice(0, 80));
}

function formatReason(hits: readonly string[]): string {
  return [
    'このターンの本文に、英語で書いた箇所があります。',
    ...hits.slice(0, MAX_QUOTED).map((h) => `- ${h}`),
    'ユーザーは日本語での応答を求めています。上に挙げた英語の箇所だけを、日本語に書き直して出してください。' +
      '日本語で書けていた部分は、すでにユーザーに届いているので再掲しないこと。' +
      '言い訳や原因の説明は書かず、以降の応答もすべて日本語で書くこと。',
  ].join('\n');
}

const hook = defineHook({
  trigger: {
    Stop: true,
  },

  run: async (context) => {
    // 書き直しが再び英語でも差し戻しを続けないよう、1 ターンに一度だけにする
    if (context.input.stop_hook_active) {
      return context.success();
    }

    try {
      const hits = englishPassages(await waitForFinal(context.input.transcript_path));
      if (hits.length === 0) {
        return context.success();
      }
      return context.json({
        event: 'Stop',
        output: {
          decision: 'block',
          reason: formatReason(hits),
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[japanese-guard] ${detail}\n`);
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
