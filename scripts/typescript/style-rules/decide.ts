import { extname } from 'node:path';
import { runStyleCheck, severeViolations } from './check.ts';
import { formatReport, formatStopReport } from './report.ts';
import { isFileScopedRuleId, type Violation } from './rules.ts';
import { toSentences } from './sanitize.ts';
import {
  mergeEntry,
  replaceKeys,
  type SessionStore,
  type StoredEntry,
  sessionStore,
  type WarningStore,
  warningStore,
} from './session-store.ts';

const TARGET_EXTENSION = '.md';
// 一時ディレクトリは作業メモと引き継ぎ書の置き場であり、清書の対象ではない
const EXCLUDED_PATH_SEGMENTS = [
  '/node_modules/',
  '/.git/',
  '/plugins/cache/',
  '/scratchpad/',
  '/tmp/',
  '/var/folders/',
];

export interface WriteInput {
  filePath: string;
  // Edit は差し替えた断片だけを渡す。語の指摘を今回書いた範囲に限るため
  writtenText: string;
  sessionId: string;
}

export interface StopInput {
  sessionId: string;
  stopHookActive: boolean;
}

// 語レベルと違い文書レベルの判定はファイル全体を見るため、無関係な箇所を
// 編集しても同じ指摘が当たり続ける。error は Stop hook で追うので対象外
function suppressible(violation: Violation): boolean {
  return violation.severity === 'warning' && isFileScopedRuleId(violation.ruleId);
}

// 件数を含む matched は文を足すたび変わる。対象文が変われば sentence も変わる
function warningKey(violation: Violation): string {
  return `${violation.ruleId}\n${violation.sentence}`;
}

// 記録は追記せず今回の検出結果で置き換える。書き直して消えた指摘が
// 元に戻された時、もう一度報告するため
async function dropReported(
  input: WriteInput,
  violations: Violation[],
  warnings: WarningStore,
): Promise<Violation[]> {
  const entries = await warnings.read(input.sessionId);
  const reported = new Set(entries.find((entry) => entry.filePath === input.filePath)?.keys ?? []);
  const keys = [...new Set(violations.filter(suppressible).map(warningKey))];
  if (keys.length !== reported.size || keys.some((key) => !reported.has(key))) {
    await warnings.write(input.sessionId, replaceKeys(entries, input.filePath, keys));
  }
  return violations.filter(
    (violation) => !suppressible(violation) || !reported.has(warningKey(violation)),
  );
}

async function inspectWrite(
  input: WriteInput,
  store: SessionStore,
  warnings: WarningStore,
): Promise<string | undefined> {
  if (extname(input.filePath).toLowerCase() !== TARGET_EXTENSION) {
    return undefined;
  }
  if (EXCLUDED_PATH_SEGMENTS.some((segment) => input.filePath.includes(segment))) {
    return undefined;
  }
  const file = Bun.file(input.filePath);
  if (!(await file.exists())) {
    return undefined;
  }

  const violations = await runStyleCheck({
    source: await file.text(),
    writtenText: input.writtenText,
  });
  const shown = await dropReported(input, violations, warnings);
  if (shown.length === 0) {
    return undefined;
  }

  const severe = severeViolations(shown);
  if (severe.length > 0) {
    await store.prune();
    const entries = mergeEntry(
      await store.read(input.sessionId),
      input.filePath,
      severe.map((violation) => violation.sentence),
    );
    await store.write(input.sessionId, entries);
  }
  return formatReport(input.filePath, shown);
}

// PostToolUse で記録した該当文がまだファイルに残っているかだけを見る。
// 書き直されれば文ごと消えるので、再検査せずに解消を判定できる
async function unresolved(entry: StoredEntry): Promise<StoredEntry | undefined> {
  const file = Bun.file(entry.filePath);
  if (!(await file.exists())) {
    return undefined;
  }
  const current = new Set(toSentences(await file.text()).map((sentence) => sentence.text));
  const sentences = entry.sentences.filter((sentence) => current.has(sentence));
  return sentences.length === 0 ? undefined : { filePath: entry.filePath, sentences };
}

async function inspectStop(input: StopInput, store: SessionStore): Promise<string | undefined> {
  const entries = await store.read(input.sessionId);
  if (entries.length === 0) {
    return undefined;
  }

  // 一度止めても直らなかった時点で降参する。記録を消さないと次のターンも止め続ける
  if (input.stopHookActive) {
    await store.write(input.sessionId, []);
    return undefined;
  }

  const remaining = (await Promise.all(entries.map(unresolved))).filter(
    (entry) => entry !== undefined,
  );
  await store.write(input.sessionId, remaining);
  return remaining.length === 0 ? undefined : formatStopReport(remaining);
}

// 検査の失敗で書き込みやターンの終了を妨げない。理由は debug log にだけ残す
async function quiet(
  label: string,
  inspect: () => Promise<string | undefined>,
): Promise<string | undefined> {
  try {
    return await inspect();
  } catch (err) {
    process.stderr.write(`[${label}] ${err instanceof Error ? err.message : String(err)}\n`);
    return undefined;
  }
}

export function decideWrite(
  input: WriteInput,
  store: SessionStore = sessionStore,
  warnings: WarningStore = warningStore,
): Promise<string | undefined> {
  return quiet('style-check', () => inspectWrite(input, store, warnings));
}

export function decideStop(
  input: StopInput,
  store: SessionStore = sessionStore,
): Promise<string | undefined> {
  return quiet('style-check-stop', () => inspectStop(input, store));
}
