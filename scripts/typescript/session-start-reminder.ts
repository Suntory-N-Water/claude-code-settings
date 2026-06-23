#!/usr/bin/env -S bun run --silent
/**
 * @fileoverview
 *   Claude Code セッション開始時に、人間向けの確認事項を表示する。
 */

import { defineHook, runHook } from 'cc-hooks-ts';

const REMINDER = [
  '',
  '\u001b[36m作業前の確認 👀\u001b[0m',
  '- Context 使用量が 50 % を越えたら、会話をリセットする',
  '- リセット前に引き継ぎ文書を作成する',
  '- 指示を詰め込むのではなく、模範解答を提示する',
  '- タスクは `grill-me` で計画をたててから指示をする',
].join('\n');

const hook = defineHook({
  trigger: {
    SessionStart: true,
  },

  run: (context) =>
    context.json({
      event: 'SessionStart',
      output: {
        systemMessage: REMINDER,
      },
    }),
});

if (import.meta.main) {
  await runHook(hook);
}
