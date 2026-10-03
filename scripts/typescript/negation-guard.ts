#!/usr/bin/env -S bun run --silent
import { defineHook, runHook } from 'cc-hooks-ts';

// 否定指示の直後に対象語の再出現(ironic rebound)が最も強く出るため、
// 割り込みはプロンプト送信直後に置く。arXiv:2511.12381 の測定に基づく
const NEGATIVE_PREDICATES = [
  /しないで/gu,
  /しないよう/gu,
  /するな(?![らりるれ])/gu,
  /しなくて(?:いい|よい|良い)/gu,
  /なくてよい/gu,
  /は不要/gu,
  /は(?:要|い)らない/gu,
  /は禁止/gu,
  /は避けて/gu,
  /はやめて/gu,
  /なし(?:で|に)/gu,
  /(?:入れ|含め|書か|触れ|使わ)ないで/gu,
  /を(?:消|削除|外|除)して/gu,
] as const;

// 述語の直前に残る助詞。「とかは」のように重なるので、剥がれなくなるまで繰り返す
const TRAILING_PARTICLES = /(?:には|とか|など|まわり|周り|[はをにがものへとで])[\s、,]*$/u;

function stripParticles(text: string): string {
  let result = text.trimEnd();
  for (;;) {
    const stripped = result.replace(TRAILING_PARTICLES, '').trimEnd();
    if (stripped === result) {
      return result;
    }
    result = stripped;
  }
}

const TERM_TAIL = /(?:`[^`]+`|「[^」]+」|[一-鿿ぁ-ヿA-Za-z0-9_.+-]+)$/u;
const LEADING_KANA = /^[ぁ-ん]+/u;
const MAX_TERMS = 5;
const MAX_TERM_LENGTH = 20;

// プロンプトに貼られた引用は指示ではない。この区別をしないと、
// 他人のツイートを貼っただけで発火する
function instructionOnly(prompt: string): string {
  const lines = prompt.split('\n');
  const result: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*>/.test(line)) {
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

// 助詞や活用が挟まると、対象語ではなく述語ごと切り出してしまう(「曖昧なパターンで代用」など)。
// 明示的に囲まれていない語は、ひらがなを含まないものだけを採る
function normalizeTerm(raw: string): string | undefined {
  const quoted = /^[`「]/u.test(raw);
  const unwrapped = raw.replace(/^[`「]/u, '').replace(/[`」]$/u, '');
  const term = unwrapped.replace(LEADING_KANA, '').trim();
  if (term.length < 2 || term.length > MAX_TERM_LENGTH) {
    return undefined;
  }
  if (!quoted && /[ぁ-ん]/u.test(term)) {
    return undefined;
  }
  return term;
}

function termBefore(text: string, index: number): string | undefined {
  const tail = TERM_TAIL.exec(stripParticles(text.slice(0, index)));
  return tail === null ? undefined : normalizeTerm(tail[0]);
}

interface Scan {
  negated: boolean;
  terms: string[];
}

function scan(prompt: string): Scan {
  const text = instructionOnly(prompt);
  const terms = new Set<string>();
  let negated = false;

  for (const pattern of NEGATIVE_PREDICATES) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      negated = true;
      const term = termBefore(text, match.index);
      if (term !== undefined) {
        terms.add(term);
      }
    }
  }
  return { negated, terms: [...terms].slice(0, MAX_TERMS) };
}

export function negatedTerms(prompt: string): string[] {
  return scan(prompt).terms;
}

// 全文を肯定形で書く。ここで「〜に触れるな」と書くと、この注入自体が
// 抑止したい再出現を引き起こす
function buildReminder(terms: string[]): string {
  const lines = ['[作業制約] 直前の指示には、成果物の外側の条件が含まれています。'];
  if (terms.length > 0) {
    lines.push(`条件の対象: ${terms.map((term) => `「${term}」`).join(' ')}`);
  }
  lines.push(
    '成果物(本文・コード・コメント・見出し・タイトル・PR 本文)には、指示された対象だけを記述してください。',
    '条件そのものは、この会話の中だけで扱ってください。',
  );
  return lines.join('\n');
}

export function reminderFor(prompt: string): string | undefined {
  const { negated, terms } = scan(prompt);
  return negated ? buildReminder(terms) : undefined;
}

const hook = defineHook({
  trigger: { UserPromptSubmit: true },

  run: (context) => {
    try {
      const reminder = reminderFor(context.input.prompt);
      if (reminder === undefined) {
        return context.success({});
      }
      return context.json({
        event: 'UserPromptSubmit',
        output: {
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: reminder,
          },
          suppressOutput: true,
        },
      });
    } catch (err) {
      process.stderr.write(
        `[negation-guard] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success({});
    }
  },
});

if (import.meta.main) {
  await runHook(hook);
}
