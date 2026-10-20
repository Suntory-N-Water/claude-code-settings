#!/usr/bin/env -S bun run --silent
import { defineHook, runHook } from 'cc-hooks-ts';

const MAX_LENGTH = 40;

function headline(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? '';
  return firstLine.length > MAX_LENGTH ? `${firstLine.slice(0, MAX_LENGTH)}…` : firstLine;
}

const hook = defineHook({
  trigger: {
    UserPromptSubmit: true,
  },

  // herdr の外で起動した Claude Code（WSL で herdr を使わないときなど）では何もしない
  shouldRun: () => process.env.HERDR_ENV === '1' && Boolean(process.env.HERDR_PANE_ID),

  run: async (context) => {
    const paneId = process.env.HERDR_PANE_ID;
    const prompt = headline(context.input.prompt);
    if (paneId === undefined || context.input.agent_id !== undefined || prompt === '') {
      return context.success();
    }

    try {
      // herdr 0.7.3 のサイドバーは custom-status だけを表示し、title は表示しない。
      // 終わったかどうかは herdr が出す working / idle で分かるため、Stop では送らない
      await Bun.spawn(
        [
          'herdr',
          'pane',
          'report-metadata',
          paneId,
          // herdr の公式連携（herdr:claude）とは別の source にして、連携が持つ状態の判定や会話の再開を上書きしない
          '--source',
          'user:claude-pane-status',
          '--agent',
          'claude',
          '--seq',
          String(Date.now()),
          '--title',
          prompt,
          '--custom-status',
          prompt,
        ],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      ).exited;
    } catch {
      // サイドバーの表示が更新されないだけなので、Claude Code の処理は止めない
    }

    return context.success();
  },
});

if (import.meta.main) {
  await runHook(hook);
}
