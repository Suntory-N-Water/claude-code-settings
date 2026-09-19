#!/usr/bin/env bun
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { TextlintResult } from '@textlint/types';
import { defineHook } from 'cc-hooks-ts';
import {
  collectMessageTargets,
  type MessageTarget,
  stripTrailers,
} from './git-message-targets.ts';

const ROOT = dirname(dirname(import.meta.dir));
const MAX_REPORTED_FINDINGS = 8;
const JAPANESE = /[ぁ-んァ-ヶ一-龠]/u;
// トークナイズと textlint のロードは全ての Bash に払うには重い。
// git commit と gh pr / gh issue を含む見込みのないコマンドはここで落とす
const MAYBE_TARGET = /\bgit\b[\s\S]*\bcommit\b|\bgh\b[\s\S]*\b(?:pr|issue)\b/u;

type Finding = Pick<
  TextlintResult['messages'][number],
  'ruleId' | 'message' | 'line' | 'column'
>;

type Linter = {
  lintText(text: string, filePath: string): Promise<TextlintResult>;
};

let linterPromise: Promise<Linter> | undefined;

function loadLinter(): Promise<Linter> {
  linterPromise ??= (async () => {
    const { createLinter, loadTextlintrc } = await import('textlint');
    const descriptor = await loadTextlintrc({
      configFilePath: join(ROOT, '.textlintrc.json'),
      node_modulesDir: join(ROOT, 'node_modules'),
    });
    return createLinter({ descriptor });
  })();
  return linterPromise;
}

interface ResolvedMessage {
  label: string;
  format: MessageTarget['format'];
  text: string;
}

async function resolveTarget(
  target: MessageTarget,
  cwd: string,
): Promise<ResolvedMessage | undefined> {
  if (target.source.kind === 'text') {
    return {
      label: target.label,
      format: target.format,
      text: target.source.text,
    };
  }
  const path = isAbsolute(target.source.path)
    ? target.source.path
    : resolve(cwd, target.source.path);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  const text = stripTrailers(await file.text());
  return text === ''
    ? undefined
    : { label: target.label, format: target.format, text };
}

export function formatReport(
  reports: readonly { label: string; findings: readonly Finding[] }[],
): string {
  const lines = [
    'textlint が git / gh へ渡すメッセージに指摘を検出しました。言い換えてから実行し直してください。',
  ];
  for (const { label, findings } of reports) {
    lines.push(`[${label}]`);
    const shown = findings.slice(0, MAX_REPORTED_FINDINGS);
    for (const { line, column, message, ruleId } of shown) {
      lines.push(`- ${line}:${column} ${message} (${ruleId})`);
    }
    const omitted = findings.length - shown.length;
    if (omitted > 0) {
      lines.push(`- ほか ${omitted} 件`);
    }
  }
  return lines.join('\n');
}

const hook = defineHook({
  trigger: {
    PreToolUse: {
      Bash: true,
    },
  },

  run: async (context) => {
    const command = context.input.tool_input.command;
    if (!MAYBE_TARGET.test(command) || !JAPANESE.test(command)) {
      return context.success();
    }

    try {
      const resolved: ResolvedMessage[] = [];
      for (const target of collectMessageTargets(command)) {
        const message = await resolveTarget(target, context.input.cwd);
        if (message !== undefined && JAPANESE.test(message.text)) {
          resolved.push(message);
        }
      }
      if (resolved.length === 0) {
        return context.success();
      }

      const linter = await loadLinter();
      const reports: { label: string; findings: Finding[] }[] = [];
      for (const { label, format, text } of resolved) {
        const { messages } = await linter.lintText(
          text,
          join(ROOT, format === 'markdown' ? 'message.md' : 'message.txt'),
        );
        if (messages.length > 0) {
          reports.push({ label, findings: messages });
        }
      }
      if (reports.length === 0) {
        return context.success();
      }

      return context.json({
        event: 'PreToolUse',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: formatReport(reports),
          },
        },
      });
    } catch (error) {
      // 検査の失敗でコミットや PR の発行を止めない
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[textlint-git-message] ${detail}\n`);
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
