#!/usr/bin/env bun
import { extname, resolve } from 'node:path';
import { defineHook } from 'cc-hooks-ts';
import { CODE_EXTENSIONS } from './textlint-check/lint.ts';
import { recordFirstEdit } from './textlint-check/store.ts';

// textlint は 1 回の起動で約 380MB を使い、並列の編集ではその分だけ同時に起動する。
// 編集のたびには編集前の本文を記録するだけにして、指摘は応答の終わりの textlint-edits-stop.ts がまとめて確かめる
const IGNORED_PATH_SEGMENTS = [
  '/node_modules/',
  '/.git/',
  '/plugins/cache/',
  '/scratchpad/',
  '/tmp/',
  '/var/folders/',
];

function isTarget(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (ext !== '.md' && !CODE_EXTENSIONS.has(ext)) {
    return false;
  }
  const normalized = filePath.replaceAll('\\', '/');
  return !IGNORED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

export function applyEdit(
  source: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string | undefined {
  if (oldString.length === 0) {
    return undefined;
  }
  const first = source.indexOf(oldString);
  if (first === -1) {
    return undefined;
  }
  if (replaceAll) {
    return source.split(oldString).join(newString);
  }
  if (source.indexOf(oldString, first + oldString.length) !== -1) {
    return undefined;
  }
  return `${source.slice(0, first)}${newString}${source.slice(first + oldString.length)}`;
}

const hook = defineHook({
  trigger: {
    PostToolUse: {
      Write: true,
      Edit: true,
    },
  },

  run: async (context) => {
    const input = context.input.tool_input;
    const filePath = resolve(context.input.cwd, input.file_path);
    if (!isTarget(filePath)) {
      return context.success();
    }

    try {
      if ('content' in input) {
        await recordFirstEdit(context.input.session_id, { filePath });
        return context.success();
      }
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return context.success();
      }
      // Edit は書き込み後の本文から逆向きに置換して編集前を復元する
      const before = applyEdit(
        await file.text(),
        input.new_string,
        input.old_string,
        input.replace_all,
      );
      if (before === undefined) {
        // 復元できない置換は差分を判定できないため、誤検出を避けて記録しない
        return context.success();
      }
      await recordFirstEdit(context.input.session_id, { filePath, before });
      return context.success();
    } catch (error) {
      process.stderr.write(
        `[textlint-post-tool-use] ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
