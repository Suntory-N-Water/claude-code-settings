#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { defineHook } from 'cc-hooks-ts';
import type { Token } from 'kuromoji';
import { loadTokenizer } from './style-rules/tokenizer.ts';

// Claude Code は Stop のたびにこの hook の終了を待つため、LLM 判定は入れない。
// 動詞を検証・実行系に限るのは、「ロジックは変更していません」「X は含めていません」のような
// 作業範囲の説明まで拾うと、やり残しのないターンまで差し戻すことになるため。
// 活用形の文字列ではなく形態素解析の基本形で比べるのは、「確認はしていません」のように
// 名詞と「する」の間に助詞が入った形を、活用形の列挙では拾えないため
const ACTION_VERBS = new Set([
  '調べる',
  '確かめる',
  '試す',
  '動かす',
  '走らせる',
  '測る',
  '作る',
  '直す',
  '手を付ける',
  '手をつける',
]);
// 「動作確認」「テスト実行」のような複合語も拾うため、「する」「できる」の前の名詞は末尾が一致すれば作業とみなす
const ACTION_NOUNS = [
  '確認',
  '検証',
  '実行',
  'テスト',
  '計測',
  '比較',
  'コミット',
  'push',
  'プッシュ',
  'ステージ',
  '記録',
  '保存',
  '反映',
  '適用',
  '修正',
  '対応',
  '実装',
  '更新',
  '作成',
  '着手',
  '調査',
  'ビルド',
  'デプロイ',
  'インストール',
  '導入',
  '再起動',
  '整形',
  '実施',
  '計算',
  '集計',
  '再生成',
];
const LIGHT_VERBS = new Set(['する', 'できる']);
const PARTICLES_BEFORE_LIGHT_VERB = new Set(['は', 'も', 'を']);
const NEGATED_PROGRESSIVE = /て(?:い|お)?(?:ません|ない)/u;
const NEGATED_PROGRESSIVE_HEAD = new RegExp(`^${NEGATED_PROGRESSIVE.source}`, 'u');
const UNDONE = [
  /(?:まだ|これから)(?:\S{0,20})(?:行っ|やっ|進め)て(?:い|お)?ません/u,
  /未(?:実施|実行|確認|検証|着手|対応|調査|コミット|テスト|反映|適用|検討)(?:です|のまま|で)/u,
];
// Fable 5.1 のプロンプトガイドが挙げる早期終了の 2 型(次の作業を宣言して終える、依頼済みの作業の許可を求める)
const ANNOUNCE =
  /(?:続けて|次に|次は|このあと|この後|引き続き|そろったら|揃ったら|届いたら|終わったら|終わり次第|完了したら|出たら|承認をいただいてから).{0,60}(?:します|進めます|行います|進みます|まとめます|報告します|待ちます)。?$/u;
const HANDBACK = [
  /(?:必要|希望|ご希望)(?:で|が)?あれば/u,
  /(?:してよいですか|て(?:も)?よいですか|進めてよいですか|よろしいですか|しますか|進めますか|やりますか|どうしますか)[？?]?$/u,
  /(?:続けるか|進めるか|止めるか).{0,30}(?:指示|教えて|決めて)/u,
];
// 宣言のあとに「以上です」のような締めの 1 文が付く場合があるため、末尾の 2 文を見る
const ANNOUNCE_WINDOW = 2;
const FINISHED_TASK_STATUS = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled']);
// Claude Code のシステムプロンプトは、頼まれていない commit/push をしないよう指示している。
// 依頼文に出てこないのに差し戻すと、正しく報告した Claude に毎回やり直しをさせることになる
const VCS_ACTION = /コミット|commit|push|プッシュ|ステージ|stage/iu;
const VCS_REQUEST = /コミット|commit|push|プッシュ|PR|プルリク/iu;
const MAX_QUOTES = 5;

function sentences(text: string): string[] {
  const body = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, 'X')
    // かぎかっこの中は例文や他人の発言の引用で、Claude 自身の作業の報告ではない
    .replace(/「[^」\n]*」/gu, 'X')
    .split('\n')
    .filter((line) => !/^\s*[>|]/.test(line))
    .join('\n');
  return body
    .split(/(?<=[。？?])|\n/u)
    .map((s) => s.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim())
    .filter((s) => s.length > 0);
}

function nounBefore(preceding: Token[]): string {
  const reversed = [...preceding].reverse();
  const nounStart = reversed.findIndex(
    (t) => !PARTICLES_BEFORE_LIGHT_VERB.has(t.surface_form) && t.pos_detail_1 !== '空白',
  );
  if (nounStart === -1) {
    return '';
  }
  const rest = reversed.slice(nounStart);
  const nounEnd = rest.findIndex((t) => t.pos !== '名詞' && t.pos !== '接頭詞');
  return (nounEnd === -1 ? rest : rest.slice(0, nounEnd))
    .reverse()
    .map((t) => t.surface_form)
    .join('')
    .toLowerCase();
}

function isAction(verb: Token, preceding: Token[]): boolean {
  if (LIGHT_VERBS.has(verb.basic_form)) {
    const noun = nounBefore(preceding);
    return ACTION_NOUNS.some((action) => noun.endsWith(action));
  }
  const object = preceding
    .slice(-2)
    .map((t) => t.surface_form)
    .join('');
  return ACTION_VERBS.has(verb.basic_form) || ACTION_VERBS.has(`${object}${verb.basic_form}`);
}

function negatesAction(tokens: Token[]): boolean {
  return tokens.some((token, i) => {
    if (token.pos !== '動詞' || token.pos_detail_1 !== '自立') {
      return false;
    }
    const rest = tokens
      .slice(i + 1)
      .map((t) => t.surface_form)
      .join('');
    return NEGATED_PROGRESSIVE_HEAD.test(rest) && isAction(token, tokens.slice(0, i));
  });
}

export async function findUndone(text: string, request: string): Promise<string[]> {
  const vcsRequested = VCS_REQUEST.test(request);
  const all = sentences(text);
  const tail = new Set(all.slice(-ANNOUNCE_WINDOW));
  // 辞書の読み込みに約 110ms かかるため、「〜ていない」を含む文がないターンでは読み込まない
  const tokenizer = all.some((s) => NEGATED_PROGRESSIVE.test(s))
    ? await loadTokenizer()
    : undefined;
  const hits = all.filter((s) => {
    if (tail.has(s) && ANNOUNCE.test(s)) {
      return true;
    }
    if (HANDBACK.some((p) => p.test(s))) {
      return true;
    }
    const undone =
      UNDONE.some((p) => p.test(s)) ||
      (tokenizer !== undefined && negatesAction(tokenizer.tokenize(s)));
    if (!undone) {
      return false;
    }
    return vcsRequested || !VCS_ACTION.test(s);
  });
  return [...new Set(hits)].slice(0, MAX_QUOTES);
}

function promptText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content) && content.every((c) => c?.type === 'text')) {
    return content.map((c) => c.text ?? '').join('\n');
  }
  return undefined;
}

// 割り込みで挟んだ質問だけを見ると元の依頼の範囲を取りこぼすので、セッション中の依頼文をすべて連結する
export function userRequests(transcriptPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }
  const prompts: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"type":"user"')) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) {
        continue;
      }
      const text = promptText(entry.message?.content);
      if (text !== undefined) {
        prompts.push(text);
      }
    } catch {}
  }
  return prompts.join('\n');
}

function formatReason(quotes: string[]): string {
  return [
    'このターンの最後の本文に、作業を実行していない、またはユーザーに作業を戻している箇所があります。',
    ...quotes.map((q) => `- ${q.slice(0, 120)}`),
    '上の箇所それぞれについて、次の 1 か 2 を行ってください。',
    '1. 依頼の範囲内で、このセッションのツールで実行できる作業なら、いま実行し、結果だけを報告する。',
    '2. 依頼の範囲外の作業、権限や環境の制約で実行できない作業、ユーザーの判断が必要な作業なら、' +
      'その理由と、誰が何をすれば完了するかを 1 文で書く。',
    'すでにユーザーに届いた本文は再掲しないこと。',
  ].join('\n');
}

const hook = defineHook({
  trigger: {
    Stop: true,
  },

  run: async (context) => {
    // 2 回目も差し戻すと、正当な理由を書いた報告まで無限に差し戻すことになるため、1 ターンに一度だけにする
    if (context.input.stop_hook_active) {
      return context.success();
    }
    // バックグラウンドのタスクが動いている間は、完了通知で Claude Code が Claude を再開するので、待って終えるのが正しい
    const running = (context.input.background_tasks ?? []).some(
      (task) => !FINISHED_TASK_STATUS.has(task.status),
    );
    if (running) {
      return context.success();
    }
    try {
      // Claude Code は最終回答を Stop hook の終了後に transcript へ書き込むため、本文は last_assistant_message から読む
      const text = context.input.last_assistant_message ?? '';
      const quotes = await findUndone(text, userRequests(context.input.transcript_path));
      if (quotes.length === 0) {
        return context.success();
      }
      return context.json({
        event: 'Stop',
        output: {
          decision: 'block',
          reason: formatReason(quotes),
        },
      });
    } catch (err) {
      process.stderr.write(
        `[unfinished-work-guard] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
