#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { defineHook } from 'cc-hooks-ts';

// minorun365/claude-code-japanese-guard の japanese-guard.py を移植したもの

type WrapUpInput = {
  recap?: string;
  ask?: string;
  // デスクトップアプリはボタンの配列を JSON 文字列で渡すことがある
  actions?: string | { label?: string; message?: string }[];
};

declare module 'cc-hooks-ts' {
  interface ToolSchema {
    mcp__ccd_turn__wrap_up: {
      input: WrapUpInput;
    };
  }
}

// 「OK」「Done」程度の短い返事は見逃す
const MIN_LATIN = Number(process.env.JAPANESE_GUARD_MIN_LATIN ?? '25');
// 複数行の途中報告は本文と同じ大きさで画面に出るので見るが、短い作業メモまで差し戻さないよう閾値を上げる
const MIN_LATIN_MID = Number(process.env.JAPANESE_GUARD_MIN_LATIN_MID ?? '60');
// ツール前の 1 行の前置きは画面に小さく出るだけなので、長い段落のときだけ見る。
// 差し戻すと、日本語の最終回答のあとに前置きだけを書き直した応答がもう 1 通出て、かえって読みにくくなる
const MIN_LATIN_MID_LONG = Number(process.env.JAPANESE_GUARD_MIN_LATIN_MID_LONG ?? '250');
const RATIO = Number(process.env.JAPANESE_GUARD_RATIO ?? '3');
const MAX_QUOTES = 5;

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

const WRAP_UP_REASON =
  'wrap_up ツールに渡したまとめ文（recap）・質問文（ask）・ボタンの文言（actions）が英語です。ユーザーは日本語での応答を求めています。' +
  'すべて日本語で書き直して、もう一度呼んでください。';

type Block = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
};

type Entry = {
  type?: string;
  isMeta?: boolean;
  thinkingDisplay?: string;
  message?: { content?: unknown };
};

function isEnglish(text: string, minLatin = MIN_LATIN): boolean {
  const stripped = IGNORE.reduce((acc, pattern) => acc.replace(pattern, ''), text);
  const latin = stripped.match(LATIN)?.length ?? 0;
  const ja = stripped.match(JA)?.length ?? 0;
  return latin >= minLatin && latin > ja * RATIO;
}

function isMidReportEnglish(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim());
  return isEnglish(text, lines.length >= 2 ? MIN_LATIN_MID : MIN_LATIN_MID_LONG);
}

// MCP ツールの名前には接続名の接頭辞が付き、接続名は環境で変わりうるため末尾で見る
function isWrapUp(name: string | undefined): boolean {
  return (name ?? '').endsWith('wrap_up');
}

function wrapUpText(input: unknown): string {
  const { recap, ask, actions } = (input ?? {}) as WrapUpInput;
  let list: unknown = actions;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  const labels = (Array.isArray(list) ? list : []).flatMap((action) =>
    action && typeof action === 'object' ? [action.label, action.message] : [],
  );
  return [recap, ask, ...labels].filter((p): p is string => typeof p === 'string' && p !== '').join('\n');
}

function head(text: string, label = ''): string {
  return label + (text.trim().split('\n')[0] ?? '').slice(0, 80);
}

function blocks(entry: Entry): Block[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : [];
}

function isUserTurn(entry: Entry): boolean {
  if (entry.type !== 'user' || entry.isMeta) {
    return false;
  }
  if (typeof entry.message?.content === 'string') {
    return true;
  }
  return Array.isArray(entry.message?.content) && !blocks(entry).some((b) => b.type === 'tool_result');
}

function readEntries(transcriptPath: string): Entry[] {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line) as Entry];
    } catch {
      return [];
    }
  });
}

function transcriptPassages(entries: Entry[]): string[] {
  const start = entries.length - [...entries].reverse().findIndex(isUserTurn);
  const turn = start > entries.length ? entries : entries.slice(start);
  const hits: string[] = [];
  let pending: string[] = [];
  for (const entry of turn) {
    if (entry.type !== 'assistant') {
      continue;
    }
    for (const block of blocks(entry)) {
      if (block.type === 'tool_use') {
        // ツール呼び出しの前に書いた本文は最終回答にならなかったので、途中報告として見る
        hits.push(...pending.filter(isMidReportEnglish).map((t) => head(t, '（途中の報告）')));
        pending = [];
        if (isWrapUp(block.name)) {
          // wrap_up のまとめ文を最終回答の代わりにしたターンでは本文がほとんど残らないため、本文だけを見ると英語のまとめ文を見逃す
          const text = wrapUpText(block.input);
          if (isEnglish(text)) {
            hits.push(head(text, '（wrap_up のまとめ文・質問文・ボタン）'));
          }
        }
      } else if (block.type === 'text') {
        pending.push(block.text ?? '');
      } else if (block.type === 'thinking' && entry.thinkingDisplay === 'updates') {
        // thinking の表示を updates にしていると、thinking ブロックが途中報告として画面に出る
        const text = block.thinking ?? '';
        if (text.trim() && isMidReportEnglish(text)) {
          hits.push(head(text, '（途中の報告）'));
        }
      }
    }
  }
  // 最終回答が複数の応答に分かれたとき、last_assistant_message には最後の 1 件しか入らないため、書き込み済みの前半もここで見る
  hits.push(...pending.filter((t) => isEnglish(t)).map((t) => head(t)));
  return hits;
}

function formatReason(quotes: string[]): string {
  return [
    'このターンの本文に、英語で書いた箇所があります。',
    ...quotes.slice(0, MAX_QUOTES).map((q) => `- ${q}`),
    'ユーザーは日本語での応答を求めています。上に挙げた英語の箇所だけを、日本語に書き直して出してください。' +
      '日本語で書けていた部分は、すでにユーザーに届いているので再掲しないこと。' +
      '言い訳や原因の説明は書かず、以降の応答もすべて日本語で書くこと。',
  ].join('\n');
}

const hook = defineHook({
  trigger: {
    Stop: true,
    PreToolUse: {
      mcp__ccd_turn__wrap_up: true,
    },
  },

  run: (context) => {
    const { input } = context;
    if (input.hook_event_name === 'PreToolUse') {
      // Stop hook で差し戻す時点では、デスクトップアプリが英語のまとめ文をすでに表示しているため、wrap_up の実行前に拒否する
      if (!isWrapUp(input.tool_name) || !isEnglish(wrapUpText(input.tool_input))) {
        return context.success();
      }
      return context.json({
        event: 'PreToolUse',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: WRAP_UP_REASON,
          },
        },
      });
    }

    // 書き直しが再び英語でも差し戻しを続けないよう、1 ターンに一度だけにする
    if (input.stop_hook_active) {
      return context.success();
    }

    // Claude Code は最終回答を Stop hook の終了後に transcript へ書き込むため、最終回答は last_assistant_message から読む。
    // 途中報告と wrap_up の呼び出しは Stop hook の時点で transcript に書き込まれているので、transcript から読む
    const hits = transcriptPassages(readEntries(input.transcript_path));
    const message = input.last_assistant_message ?? '';
    if (isEnglish(message) && !hits.includes(head(message))) {
      hits.push(head(message));
    }
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
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
