export type LineKind = 'prose' | 'heading' | 'list' | 'table' | 'quote';

export interface Sentence {
  text: string;
  kind: LineKind;
  lineNumber: number;
}

const FENCE = /^\s{0,3}(?:```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/;
const TABLE = /^\s*\|/;
const QUOTE = /^\s*>/;

function classify(line: string): LineKind {
  if (HEADING.test(line)) {
    return 'heading';
  }
  if (LIST.test(line)) {
    return 'list';
  }
  if (TABLE.test(line)) {
    return 'table';
  }
  if (QUOTE.test(line)) {
    return 'quote';
  }
  return 'prose';
}

const MARKER: Record<LineKind, RegExp | null> = {
  heading: HEADING,
  list: LIST,
  quote: QUOTE,
  table: null,
  prose: null,
};

function stripMarker(line: string, kind: LineKind): string {
  if (kind === 'table') {
    return line.replaceAll('|', ' ');
  }
  const marker = MARKER[kind];
  return marker === null ? line : line.replace(marker, '');
}

// 検査は日本語の地の文だけを見る。記号やパスが残っているとダッシュ規則と
// 体言止め判定が誤爆するため、照合の前に落とす
function stripInline(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w~@.-]*\/[\w~@./-]+/g, ' ')
    .replace(/[\w-]+\.[a-z]{1,5}\b/g, ' ')
    .replace(/\*\*|__|\*|~~/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

interface SanitizedLine {
  kind: LineKind;
  text: string;
  lineNumber: number;
}

function sanitizeLines(source: string): SanitizedLine[] {
  const lines = source.split('\n');
  const result: SanitizedLine[] = [];
  let inFence = false;
  let inComment = false;
  let cursor = 0;

  // 先頭のフロントマターだけを飛ばす。本文中の `---` は水平線なので対象外
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    cursor = end === -1 ? lines.length : end + 1;
  }

  for (let index = cursor; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (inComment) {
      inComment = !line.includes('-->');
      continue;
    }
    if (line.includes('<!--') && !line.includes('-->')) {
      inComment = true;
      continue;
    }
    const kind = classify(line);
    const text = stripInline(stripMarker(line, kind));
    // 水平線と表の区切り行は記号だけが残る。ダッシュ規則が誤爆するので落とす
    if (!/[\p{L}\p{N}]/u.test(text)) {
      continue;
    }
    result.push({ kind, text, lineNumber: index + 1 });
  }
  return result;
}

const SENTENCE_BOUNDARY = /(?<=[。！？])/;

export function toSentences(source: string): Sentence[] {
  const result: Sentence[] = [];
  for (const line of sanitizeLines(source)) {
    for (const part of line.text.split(SENTENCE_BOUNDARY)) {
      const text = part.trim();
      if (text !== '') {
        result.push({ text, kind: line.kind, lineNumber: line.lineNumber });
      }
    }
  }
  return result;
}

export function sanitizedText(source: string): string {
  return sanitizeLines(source)
    .map((line) => line.text)
    .join('\n');
}

const JAPANESE = /[぀-ヿ一-鿿]/;

export function containsJapanese(text: string): boolean {
  return JAPANESE.test(text);
}
