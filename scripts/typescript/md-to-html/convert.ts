import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { markPending, readBaseline } from './baseline.ts';
import { renderDiffHtml } from './diff.ts';
import { highlightCodeBlocks } from './highlight.ts';
import { locateAnnotation } from './locate.ts';
import { renderPage } from './page.ts';
import {
  type Annotation,
  commentsPathForHtml,
  docParamForHtml,
  ensureServer,
  formatBrokenAnchors,
  OUTPUT_ROOT,
  readCommentsFile,
  splitFrontMatter,
  unresolvedAnnotations,
  writeCommentsFile,
} from './shared.ts';

export const TARGET_EXTENSION = '.md';
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// micromark は属性値を HTML エンティティ + パーセントエンコードで出力するため、
// ファイルパスに戻すには両方を復元する必要がある
function decodeAttributeValue(value: string): string {
  const unescaped = value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

async function toDataUri(src: string, baseDir: string): Promise<string | undefined> {
  if (/^(https?:|data:)/i.test(src)) {
    return undefined;
  }
  const decoded = decodeAttributeValue(src);
  const mime = IMAGE_MIME_BY_EXT[extname(decoded).toLowerCase()];
  if (!mime) {
    return undefined;
  }
  const absolutePath = isAbsolute(decoded) ? decoded : resolve(baseDir, decoded);
  const file = Bun.file(absolutePath);
  if (!(await file.exists())) {
    return undefined;
  }
  const bytes = await file.bytes();
  return `data:${mime};base64,${bytes.toBase64()}`;
}

async function embedLocalImages(html: string, baseDir: string): Promise<string> {
  const matches = [...html.matchAll(/(<img[^>]*?src=")([^"]*)(")/g)];
  let result = '';
  let cursor = 0;
  for (const match of matches) {
    const [whole, prefix, src, suffix] = match;
    result += html.slice(cursor, match.index);
    cursor = match.index + whole.length;
    const dataUri = await toDataUri(src ?? '', baseDir);
    result += dataUri === undefined ? whole : `${prefix}${dataUri}${suffix}`;
  }
  return result + html.slice(cursor);
}

// 列の多い表や長い英単語を含む表が本文幅を超えたとき、ページ全体ではなく表だけを
// 横スクロールさせるために包む。micromark は生の HTML をエスケープするため、
// ここに現れる <table> は GFM の表だけ
function renderMarkdown(body: string): string {
  return micromark(body, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })
    .replaceAll('<table>', '<div class="table-scroll"><table>')
    .replaceAll('</table>', '</table></div>');
}

async function saveSourcePath(port: number, outPath: string, sourcePath: string): Promise<boolean> {
  const doc = encodeURIComponent(docParamForHtml(outPath));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/source?doc=${doc}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourcePath }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// 差分は data URI 埋め込み前の HTML 同士で取る(埋め込み後だと画像パスの差だけで
// 巨大な差分になるため)。基準が無い初回と、基準から変わっていない場合は出さない
export function renderBodyDiff(
  previousBody: string | undefined,
  body: string,
  currentHtml: string,
): string | undefined {
  if (previousBody === undefined || previousBody === body) {
    return undefined;
  }
  return renderDiffHtml(renderMarkdown(previousBody), currentHtml);
}

const DAMAGE_RANK = { found: 0, shifted: 1, lost: 2 } as const;

// 未対応コメントの全文は UserPromptSubmit 側が注入する。ここでは
// 「この編集でコメントの位置が見つからなくなった」という、そこには無い情報だけを出す
export function brokenByEdit(
  previousBody: string | undefined,
  body: string,
  annotations: Annotation[],
): Annotation[] {
  if (previousBody === undefined) {
    return [];
  }
  return annotations.filter(
    (annotation) =>
      DAMAGE_RANK[locateAnnotation(body, annotation).status] >
      DAMAGE_RANK[locateAnnotation(previousBody, annotation).status],
  );
}

async function transpileClient(): Promise<string> {
  const source = await Bun.file(join(import.meta.dir, 'client.ts')).text();
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
}

export function pageTitle(source: string, filePath: string): string | undefined {
  const { body, title: frontMatterTitle } = splitFrontMatter(source);
  const firstLine = body
    .split('\n')
    .find((line) => line.trim() !== '')
    ?.trim();
  const headingTitle = firstLine?.match(/^#\s+(.+)/)?.[1];
  if (firstLine === undefined) {
    return undefined;
  }
  return frontMatterTitle ?? headingTitle ?? basename(filePath, TARGET_EXTENSION);
}

export interface Conversion {
  contextText: string;
  systemMessage: string;
}

export async function convert(filePath: string): Promise<Conversion | undefined> {
  try {
    const mdFile = Bun.file(filePath);
    if (!(await mdFile.exists())) {
      return undefined;
    }

    const source = await mdFile.text();
    const title = pageTitle(source, filePath);
    if (title === undefined) {
      return undefined;
    }
    const { body } = splitFrontMatter(source);

    const rawContentHtml = renderMarkdown(body);
    // 差分はハイライト前の HTML 同士で取る(色付けの span が差分に入るため)
    const contentHtml = await highlightCodeBlocks(
      await embedLocalImages(rawContentHtml, dirname(filePath)),
    );

    const outDir = join(OUTPUT_ROOT, dirname(filePath).replaceAll('/', '-'));
    const outBase = basename(filePath, TARGET_EXTENSION);
    const outPath = join(outDir, `${outBase}.html`);

    // 前の指示の時点の Markdown と比較して視覚差分を生成する
    const previousBody = await readBaseline(outPath);
    const diffHtml = renderBodyDiff(previousBody, body, rawContentHtml);

    const page = renderPage({
      title,
      contentHtml,
      diffHtml,
      clientJs: await transpileClient(),
    });
    // Bun.write は親ディレクトリを自動作成する
    await Bun.write(outPath, page);
    await markPending(outPath);

    // 更新時もコメント保存サーバを維持する(ブラウザ側の保存 API が依存)
    const port = await ensureServer();

    const commentsPath = commentsPathForHtml(outPath);
    const savedViaServer = port !== undefined && (await saveSourcePath(port, outPath, filePath));
    if (!savedViaServer) {
      // サーバが起動できないときだけ直接書く。sourcePath が欠けると注入時に
      // 対象 Markdown を特定できなくなるので、競合リスクより欠落を避ける
      const current = await readCommentsFile(commentsPath);
      current.sourcePath = filePath;
      await writeCommentsFile(commentsPath, current);
    }
    const comments = await readCommentsFile(commentsPath);

    const relPath = docParamForHtml(outPath).split('/').map(encodeURIComponent).join('/');
    const viewUrl =
      port === undefined ? Bun.pathToFileURL(outPath).href : `http://localhost:${port}/${relPath}`;

    const contextLines = [`Markdown を HTML に変換しました: ${outPath}`, `閲覧 URL: ${viewUrl}`];
    const unresolved = unresolvedAnnotations(comments);
    if (unresolved.length > 0) {
      const broken = brokenByEdit(previousBody, body, unresolved);
      if (broken.length === 0) {
        contextLines.push(
          `未対応コメントが ${unresolved.length} 件あります (内容は次のプロンプトで注入されます)`,
        );
      } else {
        contextLines.push(
          '',
          formatBrokenAnchors({
            commentsPath,
            sourcePath: filePath,
            markdown: source,
            annotations: broken,
          }),
        );
      }
    }
    return {
      contextText: contextLines.join('\n'),
      systemMessage: `Markdown を HTML に変換しました: ${viewUrl}`,
    };
  } catch (err) {
    process.stderr.write(`[md-to-html] ${err instanceof Error ? err.message : String(err)}\n`);
    return undefined;
  }
}
