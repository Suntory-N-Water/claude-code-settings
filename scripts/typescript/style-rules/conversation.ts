import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Violation } from './rules.ts';
import { containsJapanese, toSentences } from './sanitize.ts';
import { type ReportedStore, reportedStore, storeRoot } from './session-store.ts';
import { readTurnText } from './transcript.ts';
import { checkWords } from './word-check.ts';

export interface ConversationInput {
  sessionId: string;
  transcriptPath: string;
  // transcript は非同期に書かれ、Stop の時点では最後の返答がまだ入っていない。
  // ツール呼び出しの合間の発言は transcript にしか無いため、両方を見る
  lastAssistantMessage?: string;
  // 一度差し戻しても直らなければ降参する。止め続けるとターンが終わらない
  stopHookActive: boolean;
}

const MAX_SHOWN = 5;
// 画面では ANSI がそのまま文字として出るため、色は使えない。記号で見分ける
// 直前の返答を書き直させると同じ内容が二度出て文脈を圧迫する。以降の言い換えだけを求める
const REWRITE_INSTRUCTION = [
  '🛑 style-check: 直前の返答に検出語があります。直前の返答はそのままにして、',
  'これ以降の返答で該当語を言い換えてください。検出語だけの同義語置換は禁止。',
].join('');
// 会話は 1 ターンごとに終わるが、記録は差し戻しで同じターンが再検査されても
// 同じ指摘を繰り返さないために残す
const MAX_REPORTED = 50;

export function conversationLogPath(root: string = storeRoot): string {
  return join(root, 'conversation-log.jsonl');
}

function violationKey(violation: Violation): string {
  return `${violation.ruleId}\n${violation.sentence}`;
}

export function formatConversationReport(violations: Violation[]): string {
  // 1 文に複数の指摘が当たる。文ごとにまとめないと同じ文が何度も並ぶ
  const grouped = new Map<string, Violation[]>();
  for (const violation of violations) {
    grouped.set(violation.sentence, [...(grouped.get(violation.sentence) ?? []), violation]);
  }

  const shown = [...grouped.entries()].slice(0, MAX_SHOWN);
  const lines = [REWRITE_INSTRUCTION, ''];
  for (const [sentence, hits] of shown) {
    lines.push(sentence);
    for (const hit of hits) {
      lines.push(`  ${hit.matched}: ${hit.good}`);
    }
  }
  const omitted = grouped.size - shown.length;
  if (omitted > 0) {
    lines.push('', `ほか ${omitted} 文の検出語も同じように言い換える。`);
  }
  return lines.join('\n');
}

async function appendLog(root: string, sessionId: string, violations: Violation[]): Promise<void> {
  const timestamp = new Date().toISOString();
  const body = violations
    .map((violation) =>
      JSON.stringify({
        timestamp,
        sessionId,
        ruleId: violation.ruleId,
        severity: violation.severity,
        matched: violation.matched,
        sentence: violation.sentence,
      }),
    )
    .join('\n');
  await mkdir(root, { recursive: true });
  await appendFile(conversationLogPath(root), `${body}\n`);
}

async function turnText(input: ConversationInput): Promise<string> {
  const recorded = await readTurnText(input.transcriptPath);
  const last = input.lastAssistantMessage ?? '';
  if (last === '' || recorded.includes(last)) {
    return recorded;
  }
  return recorded === '' ? last : `${recorded}\n\n${last}`;
}

async function inspect(
  input: ConversationInput,
  reported: ReportedStore,
  root: string,
): Promise<string | undefined> {
  const text = await turnText(input);
  if (text === '' || !containsJapanese(text)) {
    return undefined;
  }

  const known = new Set(await reported.read(input.sessionId));
  const violations = checkWords(toSentences(text)).filter(
    (violation) => !known.has(violationKey(violation)),
  );
  if (violations.length === 0) {
    return undefined;
  }

  for (const violation of violations) {
    known.add(violationKey(violation));
  }
  await reported.write(input.sessionId, [...known].slice(-MAX_REPORTED));
  await appendLog(root, input.sessionId, violations);

  const severe = violations.filter((violation) => violation.severity === 'severe');
  // 差し戻しは 1 ターンに一度だけにする。止め続けるとターンが終わらない
  if (severe.length === 0 || input.stopHookActive) {
    return undefined;
  }
  return formatConversationReport(severe);
}

// 検査の失敗でターンの終了を妨げない。理由は debug log にだけ残す
export async function decideConversation(
  input: ConversationInput,
  reported: ReportedStore = reportedStore,
  root: string = storeRoot,
): Promise<string | undefined> {
  try {
    return await inspect(input, reported, root);
  } catch (err) {
    process.stderr.write(
      `[conversation-check] ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }
}
