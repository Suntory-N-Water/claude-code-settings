import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineHook } from 'cc-hooks-ts';

const SKILL_NAME = 'general-dev-skills:test-driven-design';
const SLASH_COMMAND_TAG = `<command-name>/${SKILL_NAME}</command-name>`;
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
      userTexts(line.message?.content).some((text) => text.includes(SLASH_COMMAND_TAG))
    ) {
      return true;
    }
    if (
      line.type === 'assistant' &&
      Array.isArray(line.message?.content) &&
      line.message.content.some(
        (block) =>
          block.type === 'tool_use' && block.name === 'Skill' && block.input?.skill === SKILL_NAME,
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
          permissionDecisionReason: `Invoke the ${SKILL_NAME} skill with the Skill tool before editing test files, then retry this edit.`,
        },
      },
    });
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
