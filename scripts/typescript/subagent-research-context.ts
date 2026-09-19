#!/usr/bin/env -S bun run --silent
import { homedir } from 'node:os';
import { defineHook, runHook } from 'cc-hooks-ts';
import { join } from 'pathe';
import { projectTag } from './project-tag';

const LOG_ROOT = join(homedir(), '.claude', 'subagent-log');
const TARGET_AGENT_TYPES = new Set(['Explore', 'general-purpose']);

function researchContext(projectDir: string): string {
  const logDir = join(LOG_ROOT, projectTag(projectDir));
  return [
    '実装について調査するよう依頼されている場合は、次の手順を必ず守ること:',
    `1. 過去のサブエージェント調査ログは \`${logDir}\` にある。新しい調査を始める前に \`grep -ril "<調査語>" ${logDir}\` で検索する`,
    '2. 1 語で見つからなければ、表記ゆれ・関連語(英語と日本語、略称、関数名やファイル名の一部)を 2〜3 語試す',
    `3. 語が思いつかないときは \`ls ${logDir}\` でファイル名の一覧を見る。ファイル名は \`日付_調査内容.md\` の形式`,
    '4. ヒットしたログを読み、不足している分だけを新たに調査する',
    '5. ディレクトリが存在しない場合は過去ログなしとして、そのまま調査を始める',
  ].join('\n');
}

const hook = defineHook({
  trigger: {
    SubagentStart: true,
  },

  run: (context) => {
    if (!TARGET_AGENT_TYPES.has(context.input.agent_type)) {
      return context.success();
    }

    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? context.input.cwd;

    return context.json({
      event: 'SubagentStart',
      output: {
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: researchContext(projectDir),
        },
      },
    });
  },
});

if (import.meta.main) {
  await runHook(hook);
}
