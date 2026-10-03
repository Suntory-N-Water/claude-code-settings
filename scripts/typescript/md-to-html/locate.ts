import type { Annotation } from './shared.ts';

// exact/prefix/suffix は HTML レンダリング後のテキストから切り出されるため、
// Markdown ソースには残る記法文字(**, [](), 行頭の # や - など)が含まれない。
// 両者から空白・記号をすべて落とした射影同士で照合し、元オフセットへ写像で戻す
const DROPPED = /[\s\p{P}\p{S}]/u;

interface Projection {
  text: string;
  // text[i] に対応する元 Markdown の行番号(1 始まり)と絶対オフセット
  lineOf: number[];
  offsetOf: number[];
}

// front matter の値(title など)が本文と同じ文字列を持つと誤ヒットするため、
// 行番号だけ数えて中身は照合対象から外す
function frontMatterLength(markdown: string): number {
  if (!/^---\r?\n/.test(markdown)) {
    return 0;
  }
  return markdown.match(/^---\r?\n[\s\S]*?\r?\n---[^\S\n]*(?:\n|$)/)?.[0].length ?? 0;
}

function project(markdown: string): Projection {
  const chars: string[] = [];
  const lineOf: number[] = [];
  const offsetOf: number[] = [];
  const bodyStart = frontMatterLength(markdown);
  let line = 1;
  let inUrl = false;
  for (let index = 0; index < markdown.length; index++) {
    const char = markdown[index] as string;
    if (char === '\n') {
      line++;
      inUrl = false;
      continue;
    }
    if (index < bodyStart) {
      continue;
    }
    // リンク・画像の URL は本文に出ないので、括弧ごと読み飛ばす
    if (inUrl) {
      if (char === ')') {
        inUrl = false;
      }
      continue;
    }
    if (char === ']' && markdown[index + 1] === '(') {
      inUrl = true;
      index++;
      continue;
    }
    if (DROPPED.test(char)) {
      continue;
    }
    chars.push(char);
    lineOf.push(line);
    offsetOf.push(index);
  }
  return { text: chars.join(''), lineOf, offsetOf };
}

function projectQuote(quote: string): string {
  return [...quote.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')]
    .filter((char) => !DROPPED.test(char))
    .join('');
}

function commonSuffixLength(a: string, b: string): number {
  let count = 0;
  while (
    count < a.length &&
    count < b.length &&
    a[a.length - 1 - count] === b[b.length - 1 - count]
  ) {
    count++;
  }
  return count;
}

function commonPrefixLength(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) {
    count++;
  }
  return count;
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    found.push(index);
    index = haystack.indexOf(needle, index + 1);
  }
  return found;
}

function bestCandidate(
  text: string,
  candidates: number[],
  exactLength: number,
  prefix: string,
  suffix: string,
): number {
  let best = candidates[0] as number;
  let bestScore = -1;
  for (const candidate of candidates) {
    const before = text.slice(Math.max(0, candidate - prefix.length), candidate);
    const afterStart = candidate + exactLength;
    const after = text.slice(afterStart, afterStart + suffix.length);
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

const QUOTE_LIMIT = 60;

// 射影は位置合わせのために記法を読み飛ばすが、引用は生の Markdown を切り出すため
// 範囲の途中にある記法がそのまま残る。範囲の外で始まったリンクは開き括弧を
// 伴わない形で現れるので、閉じ側だけの場合も落とす
function stripMarkup(raw: string): string {
  return raw
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\]\([^)\n]*\)?/g, '')
    .replace(/!?\[/g, '')
    .replace(/\*\*|__|`/g, '');
}

function excerpt(markdown: string, projection: Projection, start: number, end: number): string {
  const from = projection.offsetOf[start] as number;
  // 末尾の句読点や閉じ記号は射影から落ちているので、同じ行にある限り拾い直す
  const limit = projection.offsetOf[end + 1] ?? markdown.length;
  let to = (projection.offsetOf[end] as number) + 1;
  while (to < limit && markdown[to] !== '\n') {
    to++;
  }
  const raw = stripMarkup(markdown.slice(from, to)).replace(/\s+/g, ' ').trim();
  return raw.length > QUOTE_LIMIT ? `${raw.slice(0, QUOTE_LIMIT)}…` : raw;
}

export type LocateResult =
  | { status: 'found'; line: number; quote: string }
  | { status: 'shifted'; line: number; quote: string }
  | { status: 'lost' };

export function locateAnnotation(markdown: string, annotation: Annotation): LocateResult {
  const projection = project(markdown);
  const exact = projectQuote(annotation.exact);
  const prefix = projectQuote(annotation.prefix);
  const suffix = projectQuote(annotation.suffix);

  if (exact.length > 0) {
    const candidates = allIndexesOf(projection.text, exact);
    if (candidates.length > 0) {
      const start = bestCandidate(projection.text, candidates, exact.length, prefix, suffix);
      const end = start + exact.length - 1;
      return {
        status: 'found',
        line: projection.lineOf[start] as number,
        quote: excerpt(markdown, projection, start, end),
      };
    }
  }

  // exact が変わっていても、前後の文脈が残っていれば位置は特定できる。
  // prefix は文書内で一意とは限らないので、挟まれた区間が最短の組を選ぶ
  if (prefix.length > 0 && suffix.length > 0) {
    let best: { start: number; end: number } | undefined;
    for (const prefixAt of allIndexesOf(projection.text, prefix)) {
      const start = prefixAt + prefix.length;
      const suffixAt = projection.text.indexOf(suffix, start);
      if (suffixAt <= start) {
        continue;
      }
      if (best === undefined || suffixAt - start < best.end - best.start) {
        best = { start, end: suffixAt };
      }
    }
    // 元の引用より極端に長い区間は、別の場所の prefix/suffix を拾っている
    const spanLimit = Math.max(exact.length * 3, 200);
    if (best !== undefined && best.end - best.start <= spanLimit) {
      return {
        status: 'shifted',
        line: projection.lineOf[best.start] as number,
        quote: excerpt(markdown, projection, best.start, best.end - 1),
      };
    }
  }

  return { status: 'lost' };
}
