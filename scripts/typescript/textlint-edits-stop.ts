#!/usr/bin/env bun
import { extname } from 'node:path';
import { defineHook } from 'cc-hooks-ts';
import { runStyleCheck } from './style-rules/check.ts';
import { formatReport as formatStyleReport } from './style-rules/report.ts';
import type { Violation } from './style-rules/rules.ts';
import { introducedFindings, lintFile, type TextlintFinding } from './textlint-check/lint.ts';
import { clearRecords, type EditRecord, readRecords, reportPath } from './textlint-check/store.ts';

interface FileFindings {
  filePath: string;
  findings: TextlintFinding[];
  styleViolations: Violation[];
}

function violationKey(violation: Violation): string {
  return `${violation.ruleId}\0${violation.sentence}`;
}

// 書き方の規則は Markdown の文章だけに向けて作ってあり、コードのコメントにかけると誤って差し戻す
async function introducedStyleViolations(
  filePath: string,
  before: string | undefined,
  after: string,
): Promise<Violation[]> {
  if (extname(filePath).toLowerCase() !== '.md') {
    return [];
  }
  const existing = new Set(
    before === undefined ? [] : (await runStyleCheck({ source: before })).map(violationKey),
  );
  return (await runStyleCheck({ source: after })).filter(
    (violation) => !existing.has(violationKey(violation)),
  );
}

async function inspect(record: EditRecord): Promise<FileFindings | undefined> {
  const file = Bun.file(record.filePath);
  if (!(await file.exists())) {
    return undefined;
  }
  const text = await file.text();
  const after = await lintFile(text, record.filePath);
  const before = record.before === undefined ? [] : await lintFile(record.before, record.filePath);
  const findings = introducedFindings(before, after);
  const styleViolations = await introducedStyleViolations(record.filePath, record.before, text);
  return findings.length === 0 && styleViolations.length === 0
    ? undefined
    : { filePath: record.filePath, findings, styleViolations };
}

function formatReport(results: FileFindings[]): string {
  return results
    .flatMap(({ filePath, findings, styleViolations }) => [
      `## ${filePath}`,
      '',
      ...findings.map(
        ({ line, column, message, ruleId }) => `- ${line}:${column} ${message} (${ruleId})`,
      ),
      ...(styleViolations.length === 0 ? [] : ['', formatStyleReport(filePath, styleViolations)]),
      '',
    ])
    .join('\n');
}

const hook = defineHook({
  trigger: {
    Stop: true,
  },

  run: async (context) => {
    const sessionId = context.input.session_id;
    try {
      // 一度差し戻しても止め続けるとターンが終わらない。差し戻しは 1 ターンに一度だけにし、直したときの記録も捨てる
      if (context.input.stop_hook_active) {
        await clearRecords(sessionId);
        return context.success();
      }
      const records = await readRecords(sessionId);
      await clearRecords(sessionId);
      if (records.length === 0) {
        return context.success();
      }

      const results: FileFindings[] = [];
      for (const record of records) {
        const result = await inspect(record);
        if (result !== undefined) {
          results.push(result);
        }
      }
      if (results.length === 0) {
        return context.success();
      }

      // 指摘を会話に全部書くと文脈を圧迫するため、ファイルに書き出して Claude に読ませる
      const path = reportPath(sessionId);
      await Bun.write(path, formatReport(results));
      const count = results.reduce(
        (sum, { findings, styleViolations }) => sum + findings.length + styleViolations.length,
        0,
      );
      return context.json({
        event: 'Stop',
        output: {
          decision: 'block',
          reason:
            `textlint と書き方の規則が、このターンで編集したファイルに増えた指摘を ${count} 件検出しました。` +
            `${path} を Read で読み、該当箇所を Edit で直してください。書き直しは不要です。`,
        },
      });
    } catch (error) {
      // textlint が失敗してもターンの終了を妨げない
      process.stderr.write(
        `[textlint-edits-stop] ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
