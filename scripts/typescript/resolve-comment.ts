#!/usr/bin/env -S bun run --silent
import { join } from 'node:path';
import {
  docParamForHtml,
  ensureServer,
  htmlPathForComments,
  OUTPUT_ROOT,
  readCommentsFile,
} from './md-to-html/shared.ts';

// 注入文には id しか出さないため、どのドキュメントの id かは全走査で特定する
async function buildDocIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const glob = new Bun.Glob('**/*.comments.json');
  for await (const relPath of glob.scan({ cwd: OUTPUT_ROOT })) {
    const commentsPath = join(OUTPUT_ROOT, relPath);
    let comments: Awaited<ReturnType<typeof readCommentsFile>>;
    try {
      comments = await readCommentsFile(commentsPath);
    } catch {
      continue;
    }
    const doc = docParamForHtml(htmlPathForComments(commentsPath));
    for (const annotation of comments.annotations) {
      index.set(annotation.id, doc);
    }
  }
  return index;
}

async function resolveOne(id: string, port: number, index: Map<string, string>): Promise<boolean> {
  const doc = index.get(id);
  if (doc === undefined) {
    process.stderr.write(`id が見つかりません: ${id}\n`);
    return false;
  }
  const url =
    `http://127.0.0.1:${port}/api/comments` +
    `?doc=${encodeURIComponent(doc)}&id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'PATCH' });
  if (!res.ok) {
    process.stderr.write(`解決済みにできませんでした (${res.status}): ${id}\n`);
    return false;
  }
  process.stdout.write(`解決済みにしました: ${id}\n`);
  return true;
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    process.stderr.write('使い方: resolve-comment.ts <id> [<id> ...]\n');
    process.exit(1);
  }
  const port = await ensureServer();
  if (port === undefined) {
    process.stderr.write('コメント保存サーバを起動できませんでした\n');
    process.exit(1);
  }
  const index = await buildDocIndex();
  let allOk = true;
  for (const id of ids) {
    const ok = await resolveOne(id, port, index);
    allOk = allOk && ok;
  }
  process.exit(allOk ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
