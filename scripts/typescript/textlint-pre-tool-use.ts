#!/usr/bin/env bun
import { dirname, extname, join, resolve } from 'node:path';
import type { TextlintResult } from '@textlint/types';
import { defineHook } from 'cc-hooks-ts';

const ROOT = dirname(dirname(import.meta.dir));
const MAX_REPORTED_FINDINGS = 12;
const IGNORED_PATH_SEGMENTS = [
  '/node_modules/',
  '/.git/',
  '/plugins/cache/',
  '/scratchpad/',
  '/tmp/',
  '/var/folders/',
];

type TextlintFinding = Pick<
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

function isTarget(filePath: string): boolean {
  if (extname(filePath).toLowerCase() !== '.md') {
    return false;
  }
  const normalized = filePath.replaceAll('\\', '/');
  return !IGNORED_PATH_SEGMENTS.some((segment) => normalized.includes(segment));
}

export function applyEdit(
  source: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): string | undefined {
  if (oldString.length === 0) {
    return undefined;
  }
  const first = source.indexOf(oldString);
  if (first === -1) {
    return undefined;
  }
  if (replaceAll) {
    return source.split(oldString).join(newString);
  }
  if (source.indexOf(oldString, first + oldString.length) !== -1) {
    // Edit は置換対象が複数あると実行できない。Claude Code 側のエラーに任せる。
    return undefined;
  }
  return `${source.slice(0, first)}${newString}${source.slice(first + oldString.length)}`;
}

function findingKey(finding: TextlintFinding): string {
  return `${finding.ruleId}\0${finding.message}`;
}

export function introducedFindings(
  before: readonly TextlintFinding[],
  after: readonly TextlintFinding[],
): TextlintFinding[] {
  const remaining = new Map<string, number>();
  for (const finding of before) {
    const key = findingKey(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const introduced: TextlintFinding[] = [];
  for (const finding of after) {
    const key = findingKey(finding);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      introduced.push(finding);
    }
  }
  return introduced;
}

function formatReason(filePath: string, findings: TextlintFinding[]): string {
  const details = findings
    .slice(0, MAX_REPORTED_FINDINGS)
    .map(
      ({ line, column, ruleId, message }) =>
        `- ${line}:${column} ${message} (${ruleId})`,
    );
  const omitted = findings.length - details.length;
  if (omitted > 0) {
    details.push(`- ほか ${omitted} 件`);
  }
  return [
    `textlint が今回増えた指摘を ${findings.length} 件検出しました: ${filePath}`,
    ...details,
    '指摘を直してから、もう一度編集してください。',
  ].join('\n');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const hook = defineHook({
  trigger: {
    PreToolUse: {
      Write: true,
      Edit: true,
    },
  },

  run: async (context) => {
    const input = context.input.tool_input;
    const filePath = resolve(context.input.cwd, input.file_path);
    if (!isTarget(filePath)) {
      return context.success();
    }

    try {
      const file = Bun.file(filePath);
      const beforeText = (await file.exists()) ? await file.text() : undefined;
      let afterText: string | undefined;

      if ('content' in input) {
        afterText = input.content;
      } else if (beforeText !== undefined) {
        afterText = applyEdit(
          beforeText,
          input.old_string,
          input.new_string,
          input.replace_all,
        );
      }

      if (afterText === undefined) {
        return context.success();
      }

      const linter = await loadLinter();
      const beforeFindings =
        beforeText === undefined
          ? []
          : (await linter.lintText(beforeText, filePath)).messages;
      const afterFindings = (await linter.lintText(afterText, filePath))
        .messages;
      const introduced = introducedFindings(beforeFindings, afterFindings);

      if (introduced.length === 0) {
        return context.success();
      }

      return context.json({
        event: 'PreToolUse',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: formatReason(filePath, introduced),
          },
        },
      });
    } catch (error) {
      const detail = errorText(error);
      process.stderr.write(`[textlint-pre-tool-use] ${detail}\n`);
      return context.nonBlockingError(
        `textlint を実行できなかったため、この編集は続行します: ${detail}`,
      );
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
