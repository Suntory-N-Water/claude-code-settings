import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { commentsPathForHtml, OUTPUT_ROOT, readCommentsFile, splitFrontMatter } from './shared.ts';

// 視覚差分の基準。編集のたびに基準を最新へ進めると、1 回の指示で複数箇所を
// 直したときに最後の 1 箇所しか差分に残らない。基準を進めるのは次の指示が
// 来た時点だけにして、その指示の間の変更をまとめて 1 つの差分にする
export function baselinePathForHtml(htmlPath: string): string {
  return htmlPath.replace(/\.html$/, '.snapshot.md');
}

export function pendingPathForHtml(htmlPath: string): string {
  return htmlPath.replace(/\.html$/, '.pending');
}

export async function readBaseline(htmlPath: string): Promise<string | undefined> {
  const file = Bun.file(baselinePathForHtml(htmlPath));
  return (await file.exists()) ? await file.text() : undefined;
}

// 空ファイルを置くだけなので、並列 Edit で同時に呼ばれても競合しない
export async function markPending(htmlPath: string): Promise<void> {
  await Bun.write(pendingPathForHtml(htmlPath), '');
}

async function advanceOne(htmlPath: string): Promise<boolean> {
  const comments = await readCommentsFile(commentsPathForHtml(htmlPath));
  const sourcePath = comments.sourcePath;
  if (sourcePath === undefined) {
    return false;
  }
  const sourceFile = Bun.file(sourcePath);
  if (!(await sourceFile.exists())) {
    return false;
  }
  const { body } = splitFrontMatter(await sourceFile.text());
  await Bun.write(baselinePathForHtml(htmlPath), body);
  return true;
}

// 前の指示の間に変換されたドキュメントの基準を、現在の本文まで進める。
// root は走査の起点。テストから実際の出力先を書き換えずに済ませるための引数
export async function advanceBaselines(root: string = OUTPUT_ROOT): Promise<number> {
  let advanced = 0;
  const glob = new Bun.Glob('**/*.pending');
  for await (const relPath of glob.scan({ cwd: root })) {
    const pendingPath = join(root, relPath);
    const htmlPath = pendingPath.replace(/\.pending$/, '.html');
    try {
      if (await advanceOne(htmlPath)) {
        advanced++;
      }
      await unlink(pendingPath);
    } catch {
      // 基準を進められなくても差分が広くなるだけなので、次のドキュメントへ進む
    }
  }
  return advanced;
}
