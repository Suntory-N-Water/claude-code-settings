import { bundledLanguages, createHighlighter } from 'shiki';

// micromark はフェンス情報を class="language-xxx" として出力する。
// コード内の '<' はエスケープされるため、閉じタグの誤検出は起きない
const CODE_BLOCK_PATTERN = /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

const MERMAID_LANGUAGE = 'mermaid';
export const MERMAID_BLOCK_CLASS = 'mermaid';

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

// '&amp;' を最後に戻さないと、'&amp;lt;' が '<' まで戻ってしまう
function decodeEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function isBundledLanguage(language: string): boolean {
  return Object.hasOwn(bundledLanguages, language);
}

interface CodeBlock {
  start: number;
  end: number;
  language: string | undefined;
  code: string;
}

export function findCodeBlocks(html: string): CodeBlock[] {
  return [...html.matchAll(CODE_BLOCK_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    language: match[1],
    code: decodeEntities(match[2] ?? ''),
  }));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// mermaid.run() は要素の textContent を図の定義として読むため、
// エスケープしたまま <pre> に入れておけばブラウザ側で元の文字列に戻る
function renderMermaidBlock(code: string): string {
  return `<pre class="${MERMAID_BLOCK_CLASS}">${escapeHtml(code)}</pre>`;
}

export async function highlightCodeBlocks(html: string): Promise<string> {
  const blocks = findCodeBlocks(html);
  if (blocks.length === 0) {
    return html;
  }

  const languages = [
    ...new Set(
      blocks
        .map((block) => block.language)
        .filter((language) => language !== undefined)
        .filter(isBundledLanguage),
    ),
  ];
  const highlighter =
    languages.length === 0
      ? undefined
      : await createHighlighter({
          themes: [THEMES.light, THEMES.dark],
          langs: languages,
        });

  let result = '';
  let cursor = 0;
  for (const block of blocks) {
    result += html.slice(cursor, block.start);
    cursor = block.end;
    result += renderBlock(html.slice(block.start, block.end), block, highlighter);
  }
  return result + html.slice(cursor);
}

function renderBlock(
  original: string,
  block: CodeBlock,
  highlighter: Awaited<ReturnType<typeof createHighlighter>> | undefined,
): string {
  if (block.language === MERMAID_LANGUAGE) {
    return renderMermaidBlock(block.code);
  }
  if (
    highlighter === undefined ||
    block.language === undefined ||
    !isBundledLanguage(block.language)
  ) {
    return original;
  }
  // 色は CSS 変数として出力し、明暗の切り替えはページ側の CSS に任せる
  return highlighter.codeToHtml(block.code, {
    lang: block.language,
    themes: THEMES,
    defaultColor: false,
  });
}
