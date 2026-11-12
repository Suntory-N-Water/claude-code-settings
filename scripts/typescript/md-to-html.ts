#!/usr/bin/env -S bun run --silent
import { dirname, extname } from 'node:path';
import { defineHook, runHook } from 'cc-hooks-ts';
import { collectMarkdownWriteTargets } from './md-to-html/bash-targets.ts';
import type { Conversion } from './md-to-html/convert.ts';
import { OUTPUT_ROOT } from './md-to-html/shared.ts';

// 変換に使う micromark と shiki は読み込むだけで約 40MB を使う。
// フックは Markdown 以外の Edit・Write・Bash でも毎回起動するため、変換の対象と決まってから読み込む
const TARGET_EXTENSION = '.md';
const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.github',
  '.vscode',
  '.idea',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.next',
  '.cache',
  'coverage',
  'tmp',
]);

function isUnderExcludedDir(filePath: string): boolean {
  return dirname(filePath)
    .split('/')
    .some((segment) => EXCLUDED_DIR_NAMES.has(segment));
}

function isConvertible(filePath: string): boolean {
  return (
    extname(filePath).toLowerCase() === TARGET_EXTENSION &&
    !isUnderExcludedDir(filePath) &&
    !filePath.startsWith(OUTPUT_ROOT)
  );
}

// Bash から拾ったパスは書き込み位置に現れただけで、本当に書かれたとは限らない。
// スクリプト本文由来の候補には読み取り専用のパスも含まれるため、
// このコマンドの実行中に更新されたものだけを変換対象にする
const RECENT_CHANGE_WINDOW_MS = 5 * 60 * 1000;

async function changedRecently(filePath: string): Promise<boolean> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return false;
  }
  return Date.now() - file.lastModified <= RECENT_CHANGE_WINDOW_MS;
}

export async function bashTargets(command: string, cwd: string): Promise<string[]> {
  const candidates = collectMarkdownWriteTargets(command, cwd);
  const changed = await Promise.all(candidates.map(changedRecently));
  return candidates.filter((_path, index) => changed[index] === true);
}

const hook = defineHook({
  trigger: {
    PostToolUse: {
      Write: true,
      Edit: true,
      Bash: true,
    },
  },

  run: async (context) => {
    const input = context.input;
    const filePaths = (
      input.tool_name === 'Bash'
        ? await bashTargets(input.tool_input.command, input.cwd)
        : [input.tool_input.file_path]
    ).filter(isConvertible);
    if (filePaths.length === 0) {
      return context.success();
    }

    const { convert } = await import('./md-to-html/convert.ts');
    const conversions: Conversion[] = [];
    for (const filePath of filePaths) {
      const conversion = await convert(filePath);
      if (conversion !== undefined) {
        conversions.push(conversion);
      }
    }
    if (conversions.length === 0) {
      return context.success();
    }
    return context.json({
      event: 'PostToolUse',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: conversions.map((conversion) => conversion.contextText).join('\n\n'),
        },
        systemMessage: conversions.map((conversion) => conversion.systemMessage).join('\n'),
      },
    });
  },
});

if (import.meta.main) {
  await runHook(hook);
}
