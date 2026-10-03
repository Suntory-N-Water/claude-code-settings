import { spawn } from 'node:child_process';
import { rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { locateAnnotation } from './locate.ts';

export const OUTPUT_ROOT = join(homedir(), '.claude', 'output-html');
export const PREFERRED_PORT = 8790;
export const SERVER_STATE_PATH = join(OUTPUT_ROOT, '.server.json');
export const HEALTH_SERVICE_NAME = 'md-to-html-comments-server';

export interface ServerState {
  port: number;
  pid: number;
}

export interface Annotation {
  id: string;
  exact: string;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  resolved?: boolean;
}

export interface CommentsFile {
  version: 1;
  // 元 Markdown の絶対パス。出力ディレクトリ名は '/' を '-' に潰していて
  // 復元できないため、変換時にここへ保存して注入時に参照する
  sourcePath?: string;
  annotations: Annotation[];
}

export function commentsPathForHtml(htmlPath: string): string {
  return htmlPath.replace(/\.html$/, '.comments.json');
}

export function splitFrontMatter(source: string): {
  body: string;
  title: string | undefined;
} {
  if (!/^---\r?\n/.test(source)) {
    return { body: source, title: undefined };
  }
  const lines = source.split('\n');
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trim() !== '---') {
      continue;
    }
    const frontMatter = lines.slice(1, index).join('\n');
    const rawTitle = frontMatter.match(/^title:\s*(.+)$/m)?.[1]?.trim();
    const title = rawTitle?.replace(/^(["'])(.*)\1$/, '$2');
    return { body: lines.slice(index + 1).join('\n'), title };
  }
  return { body: source, title: undefined };
}

export function htmlPathForComments(commentsPath: string): string {
  return commentsPath.replace(/\.comments\.json$/, '.html');
}

// サーバ API の doc パラメータは OUTPUT_ROOT 起点の相対パス
export function docParamForHtml(htmlPath: string): string {
  return htmlPath.slice(OUTPUT_ROOT.length + 1);
}

// JSON が壊れている場合は throw する。空とみなして返すと、書き戻し側が
// 既存コメントを消し去るため、読めないことは呼び出し側で扱わせる
export async function readCommentsFile(path: string): Promise<CommentsFile> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { version: 1, annotations: [] };
  }
  const data = (await file.json()) as Partial<CommentsFile>;
  const comments: CommentsFile = {
    version: 1,
    annotations: Array.isArray(data.annotations) ? data.annotations : [],
  };
  if (typeof data.sourcePath === 'string') {
    comments.sourcePath = data.sourcePath;
  }
  return comments;
}

// 直接上書きすると、書き込み中にプロセスが落ちたとき切り詰められた JSON が残る。
// 同一ディレクトリの一時ファイルへ書いてから rename して置き換える。
// 一時ファイル名にはプロセス内で一意な値も混ぜる(pid だけだと、同じプロセスの
// 並行リクエスト同士が同じ一時ファイルを奪い合って rename に失敗する)
export async function writeCommentsFile(path: string, comments: CommentsFile): Promise<void> {
  const tempPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await Bun.write(tempPath, JSON.stringify(comments, null, 2));
  await rename(tempPath, path);
}

// 読み込みと書き戻しの間に別のリクエストが割り込むと、後から書き戻した側が
// 相手の変更を消す。同じコメントファイルを触る処理はここで直列化する
const updateQueues = new Map<string, Promise<unknown>>();

export function updateCommentsFile<T>(
  path: string,
  update: (comments: CommentsFile) => Promise<T> | T,
): Promise<T> {
  const run = async (): Promise<T> => {
    const comments = await readCommentsFile(path);
    const result = await update(comments);
    await writeCommentsFile(path, comments);
    return result;
  };
  const previous = updateQueues.get(path) ?? Promise.resolve();
  const next = previous.then(run, run);
  // 直前の更新が失敗しても後続を止めない。待ち行列の保持用なので値は捨てる
  updateQueues.set(
    path,
    next.catch(() => undefined),
  );
  return next;
}

export function unresolvedAnnotations(comments: CommentsFile): Annotation[] {
  return comments.annotations.filter((annotation) => annotation.resolved !== true);
}

export interface UnresolvedEntry {
  commentsPath: string;
  sourcePath: string | undefined;
  // 注入のたびに現在の本文と照合するため、保存時ではなく今の内容を渡す
  markdown: string | undefined;
  annotations: Annotation[];
}

const QUOTE_LIMIT = 60;
const RESOLVE_COMMAND = 'bun run --silent ~/.claude/scripts/typescript/resolve-comment.ts';

export interface UnresolvedReport {
  entries: UnresolvedEntry[];
  // 作業ディレクトリ外の未対応コメント。別プロジェクトのファイルを編集対象として
  // 提示しないよう、詳細は出さず件数だけ知らせる
  outOfScopeCount: number;
  // 読み込めなかったコメントファイル。黙って落とすとコメントが届かなくなる
  unreadablePaths: string[];
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > QUOTE_LIMIT ? `${collapsed.slice(0, QUOTE_LIMIT)}…` : collapsed;
}

function formatAnnotation(entry: UnresolvedEntry, annotation: Annotation, order: number): string[] {
  const path = entry.sourcePath;
  if (path === undefined || entry.markdown === undefined) {
    return [
      `${order}. 引用「${truncate(annotation.exact)}」`,
      '   位置: 対象 Markdown を特定できません(コメントファイルのパスから推測してください)',
      `   コメント: ${annotation.comment}`,
      `   id: ${annotation.id}`,
    ];
  }
  const located = locateAnnotation(entry.markdown, annotation);
  if (located.status === 'lost') {
    return [
      `${order}. @${path}`,
      `   保存時の引用「${truncate(annotation.exact)}」`,
      '   注意: この引用は現在の本文に見つかりません。コメント後に本文が変更されアンカーが失われています',
      `   コメント: ${annotation.comment}`,
      `   id: ${annotation.id}`,
    ];
  }
  const lines = [`${order}. @${path}:${located.line}`, `   引用「${located.quote}」`];
  if (located.status === 'shifted') {
    lines.push(
      '   注意: 保存時の引用は現在の本文に一致しません。前後の文脈から現在の該当箇所を引用しています',
    );
  }
  lines.push(`   コメント: ${annotation.comment}`);
  lines.push(`   id: ${annotation.id}`);
  return lines;
}

export function formatUnresolvedComments(report: UnresolvedReport): string {
  const total = report.entries.reduce((sum, entry) => sum + entry.annotations.length, 0);
  const lines: string[] = [];
  if (total > 0) {
    lines.push(`ユーザーが HTML ビュー上で書いた未対応のコメントが ${total} 件あります。`);
    for (const entry of report.entries) {
      lines.push('');
      lines.push(`コメントファイル: ${entry.commentsPath}`);
      entry.annotations.forEach((annotation, index) => {
        lines.push(...formatAnnotation(entry, annotation, index + 1));
      });
    }
    lines.push('');
    lines.push(
      `対応が完了したコメントは \`${RESOLVE_COMMAND} <id> [<id> ...]\` を実行して解決済みにしてください。複数の id をまとめて渡せます。resolved を付けるまで毎プロンプト再掲されます。`,
    );
    lines.push(
      'コメントファイルを直接編集してはいけません。読み込みと書き戻しの間にブラウザからコメントが追加されると、その追加が消えます。削除もユーザーが行います。',
    );
    if (report.outOfScopeCount > 0) {
      lines.push(
        `なお現在の作業ディレクトリ外にも未対応コメントが ${report.outOfScopeCount} 件あります。該当プロジェクトで作業するときに提示されます。`,
      );
    }
  }
  for (const path of report.unreadablePaths) {
    lines.push(`⚠ ${path} を読み込めませんでした。このファイルのコメントは提示されていません。`);
  }
  return lines.join('\n');
}

// 編集によって位置を特定できなくなったコメントだけを知らせる。未対応コメントの
// 全文は UserPromptSubmit 側が毎プロンプト注入するので、ここでは繰り返さない
export function formatBrokenAnchors(entry: UnresolvedEntry): string {
  const lines = [`⚠ この編集でコメントのアンカーが壊れました (${entry.annotations.length} 件)`];
  entry.annotations.forEach((annotation, index) => {
    lines.push(...formatAnnotation(entry, annotation, index + 1));
  });
  return lines.join('\n');
}

// ポートを奪った別プロセスを自サーバと誤認しないよう、ヘルスチェックで
// サービス名まで確認する
export async function isOwnServer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(400),
    });
    if (!res.ok) {
      return false;
    }
    const data = (await res.json()) as { service?: string };
    return data.service === HEALTH_SERVICE_NAME;
  } catch {
    return false;
  }
}

export async function findHealthyPort(): Promise<number | undefined> {
  const state = await readServerState();
  if (state !== undefined && (await isOwnServer(state.port))) {
    return state.port;
  }
  if (state?.port !== PREFERRED_PORT && (await isOwnServer(PREFERRED_PORT))) {
    return PREFERRED_PORT;
  }
  return undefined;
}

export async function ensureServer(): Promise<number | undefined> {
  const running = await findHealthyPort();
  if (running !== undefined) {
    return running;
  }
  const serverPath = join(import.meta.dir, 'server.ts');
  const child = spawn(process.execPath, ['run', '--silent', serverPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  for (let attempt = 0; attempt < 15; attempt++) {
    await Bun.sleep(100);
    const port = await findHealthyPort();
    if (port !== undefined) {
      return port;
    }
  }
  return undefined;
}

export async function readServerState(): Promise<ServerState | undefined> {
  try {
    const file = Bun.file(SERVER_STATE_PATH);
    if (!(await file.exists())) {
      return undefined;
    }
    const data = (await file.json()) as Partial<ServerState>;
    if (typeof data.port !== 'number' || typeof data.pid !== 'number') {
      return undefined;
    }
    return { port: data.port, pid: data.pid };
  } catch {
    return undefined;
  }
}
