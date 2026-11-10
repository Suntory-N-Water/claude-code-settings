#!/usr/bin/env -S bun run --silent
import { defineHook, runHook } from 'cc-hooks-ts';

const REMINDER = [
  '',
  '\u001b[36m作業前の確認 👀\u001b[0m',
  '- Context 使用量が 25 % を越えたら、会話をリセットする',
  '- リセット前に `/mattpocock-skills:handoff` で引き継ぎ文書を作成する',
  '- 指示を詰め込むのではなく、模範解答を提示する',
  '- タスクは `/mattpocock-skills:grill-me` で計画をたててから指示をする',
  '- 指示には目的と完了条件を書く',
  '- 「〜しないで」ではなく「〜だけ書いて」と肯定形で指示する',
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
