import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineHook } from 'cc-hooks-ts';

const SKILL_NAME = 'test-driven-design';
// 個人環境と社内環境で同じスキルを別名のプラグイン経由で入れているため、プラグイン名は問わない
const SKILL_PATTERN = new RegExp(`^(?:[\\w.-]+:)?${SKILL_NAME}$`);
const SLASH_COMMAND_PATTERN = new RegExp(
  `<command-name>/(?:[\\w.-]+:)?${SKILL_NAME}</command-name>`,
);
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

type ContentBlock = { type?: string; text?: string; name?: string; input?: { skill?: string } };
type TranscriptLine = {
  type?: string;
  message?: { content?: string | ContentBlock[] };
};

function userTexts(content: string | ContentBlock[] | undefined): string[] {
  if (typeof content === 'string') {
    return [content];
  }
  return (content ?? []).flatMap((block) =>
    block.type === 'text' && block.text !== undefined ? [block.text] : [],
  );
}

function hasInvokedSkill(transcriptPath: string): boolean {
  if (!existsSync(transcriptPath)) {
    return false;
  }
  for (const raw of readFileSync(transcriptPath, 'utf-8').split('\n')) {
    let line: TranscriptLine;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      line.type === 'user' &&
      userTexts(line.message?.content).some((text) => SLASH_COMMAND_PATTERN.test(text))
    ) {
      return true;
    }
    if (
      line.type === 'assistant' &&
      Array.isArray(line.message?.content) &&
      line.message.content.some(
        (block) =>
          block.type === 'tool_use' &&
          block.name === 'Skill' &&
          SKILL_PATTERN.test(block.input?.skill ?? ''),
      )
    ) {
      return true;
    }
  }
  return false;
}

// サブエージェント内で起動したスキルはサブエージェント側の transcript にだけ記録されるため、両方を見ないと deny が繰り返される
function transcriptPaths(transcriptPath: string, agentId: string | undefined): string[] {
  if (agentId === undefined) {
    return [transcriptPath];
  }
  return [
    transcriptPath,
    join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`),
  ];
}

const hook = defineHook({
  trigger: {
    PreToolUse: {
      Edit: true,
      Write: true,
    },
  },

  run: (c) => {
    if (
      !TEST_FILE_PATTERN.test(c.input.tool_input.file_path) ||
      transcriptPaths(c.input.transcript_path, c.input.agent_id).some(hasInvokedSkill)
    ) {
      return c.success();
    }
    return c.json({
      event: 'PreToolUse',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: [
            'テスト設計の手順を踏まずにテストファイルを編集することはできません。',
            `ほかの作業より先に ${SKILL_NAME} スキル(<plugin>:${SKILL_NAME})を Skill ツールで起動し、テストケースごとに検出する不具合を添えた一覧をユーザーに示してください。`,
            'ユーザーが承認するまでは、この編集の再試行も、実装・動作確認・コミットなど依頼の残りの作業も行わずに返答を終えてください。',
            '承認後は、追加したテストが失敗することを確かめてから完了を報告します。',
          ].join(''),
        },
      },
    });
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
