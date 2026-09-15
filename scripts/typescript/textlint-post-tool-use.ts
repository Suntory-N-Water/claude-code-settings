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

function formatReport(filePath: string, findings: TextlintFinding[]): string {
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
    `textlint が今回の編集で増えた指摘を ${findings.length} 件検出しました: ${filePath}`,
    ...details,
    '該当箇所を Edit で直してください。書き直しは不要です。',
  ].join('\n');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const hook = defineHook({
  trigger: {
    PostToolUse: {
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
      if (!(await file.exists())) {
        return context.success();
      }
      const afterText = await file.text();

      // Write は全文を書き出すので、残っている指摘はすべて今回の出力に属する。
      // Edit は書き込み後の本文から逆向きに置換して編集前を復元し、差分だけを見る。
      let beforeText: string | undefined;
      if (!('content' in input)) {
        beforeText = applyEdit(
          afterText,
          input.new_string,
          input.old_string,
          input.replace_all,
        );
        if (beforeText === undefined) {
          // 復元できない置換は差分を判定できないため、誤検出を避けて何もしない。
          return context.success();
        }
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
        event: 'PostToolUse',
        output: {
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: formatReport(filePath, introduced),
          },
        },
      });
    } catch (error) {
      const detail = errorText(error);
      process.stderr.write(`[textlint-post-tool-use] ${detail}\n`);
      return context.nonBlockingError(
        `textlint を実行できませんでした: ${detail}`,
      );
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
