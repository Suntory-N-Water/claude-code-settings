#!/usr/bin/env -S bun run --silent
/**
 * @fileoverview
 *   Explore / general-purpose サブエージェントが応答完了したとき、
 *   最終応答を $CLAUDE_PROJECT_DIR/.claude/subagent-log/ に Markdown で保存する。
 *
 *   ファイル名には親 transcript から逆引きした Agent ツールの description を使う。
 *
 *   発火タイミング: SubagentStop
 *   原処理を阻害しない。エラーは stderr に1行出して success() を返す。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { defineHook, runHook } from 'cc-hooks-ts';
import { basename, dirname, join, resolve } from 'pathe';

const LOG_SUBDIR = join('.claude', 'subagent-log');
const TARGET_AGENT_TYPES = new Set(['Explore', 'general-purpose']);
const SLUG_MAX_LEN = 60;

function sanitize(text: string): string {
  let normalized = text.trim();
  normalized = normalized.replace(/[/\\:*?"<>|]/g, '-');
  normalized = normalized.replace(/[\s\n\r\t]+/g, '-');
  normalized = normalized.replace(/-+/g, '-');
  normalized = normalized.replace(/^-+|-+$/g, '');
  return normalized;
}

function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function uniquePath(dir: string, baseName: string): string {
  const desired = join(dir, `${baseName}.md`);
  if (!existsSync(desired)) {
    return desired;
  }
  for (let suffix = 2; ; suffix++) {
    const candidate = join(dir, `${baseName}_${suffix}.md`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
}

function deriveParentTranscriptPath(
  agentTranscriptPath: string,
): string | undefined {
  // <project>/<session-id>/subagents/agent-<id>.jsonl
  // → <project>/<session-id>.jsonl
  const subagentsDir = dirname(agentTranscriptPath);
  if (basename(subagentsDir) !== 'subagents') {
    return undefined;
  }
  const sessionDir = dirname(subagentsDir);
  const sessionId = basename(sessionDir);
  const parentPath = join(dirname(sessionDir), `${sessionId}.jsonl`);
  if (!existsSync(parentPath)) {
    return undefined;
  }
  return parentPath;
}

function extractDescription(
  input: BetaToolUseBlock['input'],
): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const desc = Reflect.get(input, 'description');
  return typeof desc === 'string' ? desc : undefined;
}

function extractPromptField(
  input: BetaToolUseBlock['input'],
): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  const prompt = Reflect.get(input, 'prompt');
  return typeof prompt === 'string' ? prompt : undefined;
}

function findDescriptionInParent(
  parentPath: string,
  subagentPrompt: string,
): string | undefined {
  const content = readFileSync(parentPath, 'utf-8');

  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let entry: SDKMessage;
    try {
      entry = JSON.parse(line) satisfies SDKMessage;
    } catch {
      continue;
    }

    if (entry.type !== 'assistant') {
      continue;
    }

    for (const block of entry.message.content) {
      if (block.type !== 'tool_use' || block.name !== 'Agent') {
        continue;
      }
      const prompt = extractPromptField(block.input);
      if (prompt === subagentPrompt) {
        return extractDescription(block.input);
      }
    }
  }

  return undefined;
}

function readTranscript(path: string): SDKMessage[] {
  const content = readFileSync(path, 'utf-8');
  const entries: SDKMessage[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push(JSON.parse(line) as SDKMessage);
    } catch {
      // 壊れた行は無視
    }
  }
  return entries;
}

function extractPromptText(entries: SDKMessage[]): string | undefined {
  for (const entry of entries) {
    if (entry.type !== 'user') {
      continue;
    }
    const content = entry.message.content;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }
    const texts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) {
      return texts.join('\n\n');
    }
  }
  return undefined;
}

function firstLine(text: string): string | undefined {
  return text.split('\n').at(0)?.trim();
}

function extractLastAssistantText(entries: SDKMessage[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== 'assistant') {
      continue;
    }
    const texts: string[] = [];
    for (const block of entry.message.content) {
      if (block.type === 'text' && block.text) {
        texts.push(block.text);
      }
    }
    if (texts.length > 0) {
      return texts.join('\n\n');
    }
  }
  return undefined;
}

const hook = defineHook({
  trigger: {
    SubagentStop: true,
  },

  run: (context) => {
    try {
      const projectDir = process.env.CLAUDE_PROJECT_DIR;
      if (!projectDir) {
        return context.success();
      }

      const { agent_type, agent_transcript_path, last_assistant_message } =
        context.input;

      if (!TARGET_AGENT_TYPES.has(agent_type)) {
        return context.success();
      }

      if (!existsSync(agent_transcript_path)) {
        return context.success();
      }

      const entries = readTranscript(agent_transcript_path);

      const response =
        last_assistant_message ?? extractLastAssistantText(entries);
      if (!response) {
        return context.success();
      }

      const promptText = extractPromptText(entries);

      // description を親 transcript から取得し、fallback としてプロンプト1行目を使う
      let headline: string | undefined;
      if (promptText) {
        const parentPath = deriveParentTranscriptPath(agent_transcript_path);
        if (parentPath) {
          headline = findDescriptionInParent(parentPath, promptText);
        }
      }
      if (!headline && promptText) {
        headline = firstLine(promptText);
      }
      if (!headline) {
        return context.success();
      }

      const slug = sanitize(headline).slice(0, SLUG_MAX_LEN);
      if (!slug) {
        return context.success();
      }

      const logDir = resolve(projectDir, LOG_SUBDIR);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      const baseName = `${todayString()}_${slug}`;
      const outPath = uniquePath(logDir, baseName);

      const body = [`# ${headline}`, '', response.trim(), ''].join('\n');

      writeFileSync(outPath, body, 'utf-8');
      return context.success();
    } catch (err) {
      process.stderr.write(
        `[subagent-archive] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  await runHook(hook);
}
