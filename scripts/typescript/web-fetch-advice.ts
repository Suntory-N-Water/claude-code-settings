import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineHook } from 'cc-hooks-ts';
import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';
import { parseGitHubUrlToGhCommand } from '../utils/github';
import { extractPdfMarkdown } from '../utils/pdf';
import { isRawContentURL } from '../utils/url';

const OUTPUT_ROOT = join(homedir(), '.claude', 'web-fetch');
const MAX_FILE_NAME_LENGTH = 245;
const MAX_DESCRIPTION_FILE_NAME_LENGTH = 60;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// 画像はテキスト読解に不要な上、data URI (base64) だと 1 要素で数万トークンになる
function stripImages(html: string): string {
  return html.replaceAll(/<img\b[^>]*>/gi, '');
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (!body.startsWith('#')) {
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    }
    const code =
      body[1]?.toLowerCase() === 'x'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (Number.isNaN(code) || code < 0 || code > 0x10ffff) {
      return whole;
    }
    return String.fromCodePoint(code);
  });
}

function normalizeText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

// 属性の並び順が name/property/content のどれ先でも拾えるよう、タグ単位で属性を読む
function collectMetaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key === undefined || content === undefined || tags.has(key)) {
      continue;
    }
    tags.set(key, normalizeText(content));
  }
  return tags;
}

function extractTitleTag(html: string): string | undefined {
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return raw === undefined ? undefined : normalizeText(raw);
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find(isNonEmptyString);
}

// macOS 以外で使い回しても壊れないよう Windows で禁止される文字もまとめて落とす
function sanitizeFileName(name: string): string {
  const sanitized = name
    // Obsidian のリンク記法と衝突する文字
    .replace(/[#|^[\]]/g, '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ファイル名に使えない制御文字を落とすため
    .replace(/[<>:"/\\?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();
  return sanitized.length === 0 ? 'Untitled' : sanitized;
}

function buildFileNameBase(
  title: string | undefined,
  description: string | undefined,
  urlObj: URL,
): string {
  const fromUrl = `${urlObj.hostname}${urlObj.pathname}`.replace(/\/+$/, '');
  return sanitizeFileName(
    firstNonEmpty(
      title,
      description?.slice(0, MAX_DESCRIPTION_FILE_NAME_LENGTH),
      fromUrl.replaceAll('/', '-'),
    ) ?? '',
  );
}

async function extractMarkdown(
  html: string,
  url: string,
): Promise<{ markdown: string; title: string }> {
  // Defuddle は HTML 文字列も受け取るが非推奨で次のメジャーで削除されるため Document を渡す
  const { document } = parseHTML(stripImages(html));
  const result = await Defuddle(document, url, { markdown: true });
  return { markdown: result.content, title: result.title };
}

function isPdfResponse(response: Response, urlObj: URL): boolean {
  const contentType = response.headers.get('Content-Type')?.toLowerCase();
  if (contentType?.includes('application/pdf') === true) {
    return true;
  }
  // application/octet-stream で PDF を返すサーバーがあるため拡張子でも判定する
  return urlObj.pathname.toLowerCase().endsWith('.pdf');
}

type ExtractedPage = {
  markdown: string;
  title?: string;
  description?: string;
};

async function extractHtmlPage(
  response: Response,
  url: string,
): Promise<ExtractedPage | undefined> {
  let html = await response.text();
  let extracted = await extractMarkdown(html, url);
  // 静的ページでもたまに空のマークダウンが出力されることがある
  // その場合はPlaywrightで動的にHTMLを取得する
  if (extracted.markdown.length === 0) {
    const { fetchDynamicHtml } = await import('../utils/playwright');
    html = await fetchDynamicHtml(url);
    extracted = await extractMarkdown(html, url);
    // Playwrightでも取得できない場合は通常のWebFetchを使う
    if (extracted.markdown.length === 0) {
      return undefined;
    }
  }

  const metaTags = collectMetaTags(html);
  return {
    markdown: extracted.markdown,
    title: firstNonEmpty(
      metaTags.get('og:title'),
      metaTags.get('twitter:title'),
      extractTitleTag(html),
      normalizeText(extracted.title),
    ),
    description: firstNonEmpty(
      metaTags.get('description'),
      metaTags.get('og:description'),
      metaTags.get('twitter:description'),
    ),
  };
}

const hook = defineHook({
  trigger: {
    PreToolUse: {
      WebFetch: true,
    },
  },

  run: async (c) => {
    const url = c.input.tool_input.url;
    const urlObj = new URL(url);
    if (isRawContentURL(urlObj)) {
      return c.success();
    }

    const ghResult = parseGitHubUrlToGhCommand(urlObj);
    if (ghResult) {
      return c.json({
        event: 'PreToolUse',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: [
              'Use the GitHub CLI instead.',
              'Suggested command:',
              '```bash',
              ghResult.command,
              '```',
              ...(isNonEmptyString(ghResult.additionalInformation)
                ? ['Additional information:', ghResult.additionalInformation]
                : []),
            ].join('\n'),
          },
        },
      });
    }

    const response = await fetch(url);
    if (!response.ok) {
      return c.success();
    }
    if (response.headers.get('Content-Type')?.toLowerCase().includes('text/plain') === true) {
      return c.success();
    }

    const page: ExtractedPage | undefined = isPdfResponse(response, urlObj)
      ? await extractPdfMarkdown(await response.arrayBuffer())
      : await extractHtmlPage(response, url);
    // 画像だけの PDF などで本文を取得できない場合は通常のWebFetchに任せる
    if (page === undefined || page.markdown.length === 0) {
      return c.success();
    }
    const { markdown, title, description } = page;

    // タイトルが衝突した場合は上書きする。取得直後に読まれる前提なので履歴は残さない
    const outputPath = join(
      OUTPUT_ROOT,
      c.input.cwd.replaceAll('/', '-'),
      `${buildFileNameBase(title, description, urlObj)}.md`,
    );
    const document = `${markdown.trim()}\n`;
    // Bun.write は親ディレクトリを自動作成する
    await Bun.write(outputPath, document);

    return c.json({
      event: 'PreToolUse',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: [
            `You should not use web fetch for ${url}.`,
            'The page has been saved as markdown. Read or grep this file:',
            outputPath,
            `lines: ${document.trimEnd().split('\n').length}`,
          ].join('\n'),
        },
        suppressOutput: true,
      },
    });
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
