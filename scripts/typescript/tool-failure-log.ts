#!/usr/bin/env -S bun run --silent
/**
 * @fileoverview
 *   ツール実行失敗を $CLAUDE_PROJECT_DIR/.claude/tool-failure-log/YYYY-MM.jsonl に1行追記する。
 *
 *   発火タイミング: PostToolUseFailure (主要ツールのみ列挙して型を narrow)
 *   tool_input は ToolSchema 型に基づきツールごとに記録対象フィールドを選択する。
 *   原処理を阻害しない。エラーは stderr に1行出して success() を返す。
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { defineHook, runHook } from 'cc-hooks-ts';
import { join } from 'pathe';

const LOG_DIR = join(homedir(), '.claude', 'tool-failure-log');

function monthString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const hook = defineHook({
  trigger: {
    PostToolUseFailure: {
      Bash: true,
      Edit: true,
      Write: true,
      Read: true,
      Glob: true,
      Grep: true,
      WebFetch: true,
      WebSearch: true,
    },
  },

  run: (context) => {
    try {
      const { tool_name, tool_input, error } = context.input;

      const input = (() => {
        switch (tool_name) {
          case 'Bash': {
            return {
              command: tool_input.command,
              description: tool_input.description,
              timeout: tool_input.timeout,
            };
          }
          case 'Edit': {
            return { file_path: tool_input.file_path };
          }
          case 'Write': {
            return { file_path: tool_input.file_path };
          }
          case 'Read': {
            return {
              file_path: tool_input.file_path,
              offset: tool_input.offset,
              limit: tool_input.limit,
            };
          }
          case 'Glob': {
            return { pattern: tool_input.pattern, path: tool_input.path };
          }
          case 'Grep': {
            return {
              pattern: tool_input.pattern,
              path: tool_input.path,
              output_mode: tool_input.output_mode,
            };
          }
          case 'WebFetch': {
            return { url: tool_input.url, prompt: tool_input.prompt };
          }
          case 'WebSearch': {
            return { query: tool_input.query };
          }
          default:
            return undefined;
        }
      })();

      const record = {
        ts: new Date().toISOString(),
        tool: tool_name,
        error,
        input,
      };

      if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
      }
      const logFile = join(LOG_DIR, `${monthString()}.jsonl`);
      appendFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf-8');

      return context.success();
    } catch (err) {
      process.stderr.write(
        `[tool-failure-log] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  await runHook(hook);
}
