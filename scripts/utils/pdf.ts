export type PdfLine = {
  page: number;
  text: string;
  indented: boolean;
  size: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  pageHeight: number;
};

type StextJson = {
  blocks: {
    type: string;
    lines?: {
      wmode: number;
      bbox: { x: number; y: number; w: number; h: number };
      font: { size: number };
      text: string;
    }[];
  }[];
};

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;
const LIST_MARKER =
  /^(?:[・※●○◎■□◆◇▶•*-]|[（(][0-9０-９a-zA-Zア-ン一二三四五六七八九十]+[)）]|[0-9０-９]+[.．、)）\s]|[ア-ン]\s|[①-⑳])/u;
const MARGIN_RATIO = 0.1;
// 章ごとにヘッダーが変わる文書もあるため、全ページ数に対する割合ではなく固定のページ数で判定する。
// 出現ページ数がこれ未満の行は、余白にあっても本文の一部として残す
const MIN_RUNNING_LINE_PAGES = 5;
const PAGE_NUMBER = /^[-－‐―\s(（<〈[［]*(?:[0-9０-９]+|[ivxlcIVXLCⅰ-ⅻⅠ-Ⅻ]+)[-－‐―\s)）>〉\]］]*$/u;
// 右端がこの幅 (文字サイズの倍数) 以内に収まる行は、右端まで届いているとみなす
const RIGHT_EDGE_TOLERANCE = 2;
const MIN_LINES_FOR_EDGE = 3;
// これより短い行は、次の行と右端が揃っていても著者名の並びなどの短い項目とみなし、つながない
const NARROW_PARAGRAPH_RATIO = 0.5;
// 同じ段落でも行ごとに報告される文字サイズが 1pt 程度ぶれる
const SIZE_TOLERANCE = 0.15;
// 論文の余白にある arXiv ID のように 90 度回転した行は、縦に細長い範囲として出てくる
const ROTATED_ASPECT_RATIO = 2;
// 振り仮名は本文の半分程度の文字サイズで、本文とは別の行として出てくる
const RUBY_SIZE_RATIO = 0.6;
// 同じ高さの行どうしの間隔がこの幅 (文字サイズの倍数) を超える場合は、表の列などの別の要素とみなす
const SAME_ROW_GAP = 1.5;
const HEADING_SIZE_RATIO = 1.15;
const MAX_HEADING_LENGTH = 50;
const MAX_HEADING_LEVEL = 4;

// 日本語は行末で折り返しても単語の区切りではないため、空白を挟まずにつなぐ
function joinText(before: string, after: string): string {
  if (CJK.test(before.at(-1) ?? '') && CJK.test(after[0] ?? '')) {
    return `${before}${after}`;
  }
  // 英単語の途中で折り返したハイフンは、元のハイフンと区別できないため残したまま空白なしでつなぐ
  if (/[a-z]-$/i.test(before) && /^[a-z]/.test(after)) {
    return `${before}${after}`;
  }
  return `${before} ${after}`;
}

// 字間を空けた見出しや振り仮名の付いた語は、1 文字ずつ別の行として出てくるため、同じ高さの行はつなぐ
function mergeSameRowLines(lines: PdfLine[]): PdfLine[] {
  const merged: PdfLine[] = [];
  for (const line of lines) {
    const prev = merged.at(-1);
    const size = Math.min(line.size, prev?.size ?? line.size);
    if (
      prev === undefined ||
      prev.page !== line.page ||
      Math.abs(line.top - prev.top) >= size * 0.5 ||
      line.left < prev.right - size * 0.5
    ) {
      merged.push({ ...line });
      continue;
    }
    prev.text =
      line.left - prev.right > size * SAME_ROW_GAP
        ? `${prev.text} ${line.text}`
        : joinText(prev.text, line.text);
    prev.right = Math.max(prev.right, line.right);
    prev.bottom = Math.max(prev.bottom, line.bottom);
  }
  return merged;
}

function removeRunningLines(lines: PdfLine[]): PdfLine[] {
  const inMargin = (line: PdfLine) =>
    line.top < line.pageHeight * MARGIN_RATIO || line.bottom > line.pageHeight * (1 - MARGIN_RATIO);
  // ページ番号はページごとに数字だけが変わるため、数字を伏せて同じ行とみなす
  const keyOf = (line: PdfLine) => line.text.replace(/[0-9０-９]+/g, '#').replace(/\s/g, '');

  const pagesByKey = new Map<string, Set<number>>();
  for (const line of lines.filter(inMargin)) {
    const pages = pagesByKey.get(keyOf(line)) ?? new Set();
    pages.add(line.page);
    pagesByKey.set(keyOf(line), pages);
  }
  return lines.filter(
    (line) =>
      !inMargin(line) ||
      (!PAGE_NUMBER.test(line.text) &&
        (pagesByKey.get(keyOf(line))?.size ?? 0) < MIN_RUNNING_LINE_PAGES),
  );
}

function detectBodySize(lines: PdfLine[]): number {
  const charsBySize = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size);
    charsBySize.set(size, (charsBySize.get(size) ?? 0) + line.text.length);
  }
  return [...charsBySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

function detectHeadingLevels(lines: PdfLine[], bodySize: number): Map<number, number> {
  const sizes = [
    ...new Set(
      lines
        .filter(
          (line) =>
            line.size >= bodySize * HEADING_SIZE_RATIO && line.text.length <= MAX_HEADING_LENGTH,
        )
        .map((line) => Math.round(line.size)),
    ),
  ].sort((a, b) => b - a);
  return new Map(sizes.map((size, i) => [size, Math.min(i + 1, MAX_HEADING_LEVEL)]));
}

export function pdfLinesToMarkdown(allLines: PdfLine[]): string {
  const bodySize = detectBodySize(allLines);
  const lines = removeRunningLines(
    mergeSameRowLines(allLines.filter((line) => line.size >= bodySize * RUBY_SIZE_RATIO)),
  );
  const headingLevels = detectHeadingLevels(lines, bodySize);

  // 行が右端まで届いていれば、次の行は同じ段落の折り返しとみなす。
  // 図や注記は本文より右へはみ出すことがあるため、本文と同じ文字サイズの行だけで右端を決める
  const leftEdgeByPage = new Map<number, number>();
  const rightEdgeByPage = new Map<number, number>();
  const minRightByPage = new Map<number, number>();
  const bodyLineCountByPage = new Map<number, number>();
  for (const line of lines) {
    if (Math.round(line.size) !== bodySize) {
      continue;
    }
    bodyLineCountByPage.set(line.page, (bodyLineCountByPage.get(line.page) ?? 0) + 1);
    minRightByPage.set(
      line.page,
      Math.min(minRightByPage.get(line.page) ?? line.right, line.right),
    );
    leftEdgeByPage.set(line.page, Math.min(leftEdgeByPage.get(line.page) ?? line.left, line.left));
    rightEdgeByPage.set(line.page, Math.max(rightEdgeByPage.get(line.page) ?? 0, line.right));
  }
  const continues = (prev: PdfLine, line: PdfLine) => {
    if (
      line.indented ||
      LIST_MARKER.test(line.text) ||
      (line.page !== prev.page && line.page !== prev.page + 1) ||
      Math.abs(line.size - prev.size) > Math.max(line.size, prev.size) * SIZE_TOLERANCE
    ) {
      return false;
    }
    const tolerance = prev.size * RIGHT_EDGE_TOLERANCE;
    const pageLeft = leftEdgeByPage.get(prev.page) ?? 0;
    const pageRight = rightEdgeByPage.get(prev.page) ?? 0;
    // 本文が 1〜2 行しかなく右端もそろっているページでは、最も長い行が本文の幅いっぱいとは限らない。
    // その行自身を右端とみなすと、短い行どうしが必ずつながってしまう
    const edgeReliable =
      (bodyLineCountByPage.get(prev.page) ?? 0) >= MIN_LINES_FOR_EDGE ||
      (minRightByPage.get(prev.page) ?? pageRight) < pageRight - tolerance;
    if (!edgeReliable) {
      return false;
    }
    if (prev.right >= pageRight - tolerance) {
      return true;
    }
    // 要旨や引用のように左右を狭めた段落は、ページの右端ではなく次の行の右端と揃っているかで判定する。
    // ページをまたぐ場合と句点で終わる場合は、段落の最終行である可能性が高いためつながない
    return (
      line.page === prev.page &&
      !/[。．]$/u.test(prev.text) &&
      line.left <= prev.left + prev.size &&
      prev.right >= line.right - tolerance &&
      prev.right - prev.left >= (pageRight - pageLeft) * NARROW_PARAGRAPH_RATIO
    );
  };

  const blocks: string[] = [];
  let prev: PdfLine | undefined;
  let paragraph = '';
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push(paragraph);
    }
    paragraph = '';
    prev = undefined;
  };

  for (const line of lines) {
    const level = headingLevels.get(Math.round(line.size));
    if (level !== undefined && line.text.length <= MAX_HEADING_LENGTH) {
      flush();
      blocks.push(`${'#'.repeat(level)} ${line.text}`);
      continue;
    }
    if (prev !== undefined && continues(prev, line)) {
      paragraph = joinText(paragraph, line.text);
    } else {
      flush();
      paragraph = line.text;
    }
    prev = line;
  }
  flush();
  return blocks.join('\n\n');
}

export async function extractPdfMarkdown(
  data: ArrayBuffer,
): Promise<{ markdown: string; title?: string }> {
  // WASM の初期化が重いため PDF のときだけ読み込む
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(data, 'application/pdf');
  try {
    const pageCount = doc.countPages();
    const lines: PdfLine[] = [];
    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      const [, pageTop, , pageBottom] = page.getBounds();
      const stext = page.toStructuredText('preserve-whitespace');
      const json = JSON.parse(stext.asJSON()) as StextJson;
      stext.destroy();
      page.destroy();

      for (const raw of json.blocks.flatMap((block) => block.lines ?? [])) {
        const text = raw.text.trim();
        const rotated =
          raw.wmode === 0 && text.length > 2 && raw.bbox.h > raw.bbox.w * ROTATED_ASPECT_RATIO;
        if (text.length === 0 || rotated) {
          continue;
        }
        lines.push({
          page: i,
          text,
          indented: /^[\s　]/u.test(raw.text),
          size: raw.font.size,
          left: raw.bbox.x,
          right: raw.bbox.x + raw.bbox.w,
          top: raw.bbox.y,
          bottom: raw.bbox.y + raw.bbox.h,
          pageHeight: pageBottom - pageTop,
        });
      }
    }

    const markdown = pdfLinesToMarkdown(lines);
    const metaTitle = doc.getMetaData('info:Title')?.trim();
    if (metaTitle !== undefined && metaTitle.length > 0) {
      return { markdown, title: metaTitle };
    }
    // 最も上位の見出しを表題とみなす
    const headings = [...markdown.matchAll(/^(#+) (.+)$/gm)];
    const topLevel = Math.min(...headings.map((m) => m[1]?.length ?? 0));
    return {
      markdown,
      title: headings.find((m) => m[1]?.length === topLevel)?.[2],
    };
  } finally {
    doc.destroy();
  }
}
