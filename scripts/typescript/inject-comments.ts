#!/usr/bin/env -S bun run --silent
import { isAbsolute, join, relative, resolve } from 'node:path';
import { defineHook, runHook } from 'cc-hooks-ts';
import { advanceBaselines } from './md-to-html/baseline.ts';
import { pruneOldSessions, readInjectedIds, recordInjectedIds } from './md-to-html/session.ts';
import {
  formatUnresolvedComments,
  OUTPUT_ROOT,
  readCommentsFile,
  type UnresolvedReport,
  unresolvedAnnotations,
} from './md-to-html/shared.ts';

export function isUnder(dir: string, filePath: string): boolean {
  const rel = relative(resolve(dir), resolve(filePath));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// root は走査の起点。テストから実際の出力先を書き換えずに済ませるための引数
export async function collect(
  cwd: string,
  injected: Set<string>,
  root: string = OUTPUT_ROOT,
): Promise<UnresolvedReport> {
  const report: UnresolvedReport = {
    entries: [],
    outOfScopeCount: 0,
    unreadablePaths: [],
  };
  const glob = new Bun.Glob('**/*.comments.json');
  for await (const relPath of glob.scan({ cwd: root })) {
    const commentsPath = join(root, relPath);
    try {
      const comments = await readCommentsFile(commentsPath);
      const unresolved = unresolvedAnnotations(comments);
      if (unresolved.length === 0) {
        continue;
      }
      // sourcePath は変換のたびに保存されるので、無いものは対象を追えない古い残骸
      const sourcePath = comments.sourcePath;
      if (sourcePath === undefined || !isUnder(cwd, sourcePath)) {
        report.outOfScopeCount += unresolved.length;
        continue;
      }
      // 一度全文を出したものは繰り返さない。内容は会話履歴に残っている
      const annotations = unresolved.filter((annotation) => !injected.has(annotation.id));
      if (annotations.length === 0) {
        continue;
      }
      const sourceFile = Bun.file(sourcePath);
      const markdown = (await sourceFile.exists()) ? await sourceFile.text() : undefined;
      report.entries.push({
        commentsPath,
        sourcePath,
        markdown,
        annotations,
      });
    } catch {
      // 1 ファイルの破損で他ドキュメントのコメントまで消さない
      report.unreadablePaths.push(commentsPath);
    }
  }
  return report;
}

const hook = defineHook({
  trigger: { UserPromptSubmit: true },

  run: async (context) => {
    try {
      // 前の指示の間に入った変更をひとまとめの差分にするため、基準はここで進める
      await advanceBaselines();

      const sessionId = context.input.session_id;
      const injected = await readInjectedIds(sessionId);
      const report = await collect(context.input.cwd, injected);
      if (report.entries.length === 0 && report.unreadablePaths.length === 0) {
        return context.success();
      }
      await recordInjectedIds(
        sessionId,
        report.entries.flatMap((entry) => entry.annotations.map((annotation) => annotation.id)),
      );
      await pruneOldSessions();
      return context.json({
        event: 'UserPromptSubmit',
        output: {
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: formatUnresolvedComments(report),
          },
        },
      });
    } catch (err) {
      process.stderr.write(
        `[inject-comments] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  await runHook(hook);
}
