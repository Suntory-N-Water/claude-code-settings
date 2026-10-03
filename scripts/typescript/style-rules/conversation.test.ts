import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationLogPath, decideConversation } from './conversation.ts';
import { createReportedStore, type ReportedStore } from './session-store.ts';

const SEVERE = '型定義は鍵となる。';
const WARNING_ONLY = 'ここで関数の契約を決める。';
const CLEAN = 'この関数は設定ファイルを読み込む。';
const SESSION_ID = 'test-session';

let workspace: string;
let root: string;
let reported: ReportedStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(import.meta.dir, '.conversation-'));
  root = join(workspace, 'store');
  reported = createReportedStore(root);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function transcript(...texts: string[]): Promise<string> {
  const path = join(workspace, 'transcript.jsonl');
  const entries = [
    { type: 'user', message: { role: 'user', content: '質問' } },
    ...texts.map((text) => ({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    })),
  ];
  await Bun.write(
    path,
    entries.map((entry) => JSON.stringify(entry)).join('\n'),
  );
  return path;
}

function check(
  transcriptPath: string,
  lastAssistantMessage?: string,
  stopHookActive = false,
) {
  return decideConversation(
    {
      sessionId: SESSION_ID,
      transcriptPath,
      lastAssistantMessage,
      stopHookActive,
    },
    reported,
    root,
  );
}

interface LogRecord {
  timestamp: string;
  sessionId: string;
  ruleId: string;
  severity: string;
  matched: string;
  sentence: string;
}

async function logRecords(): Promise<LogRecord[]> {
  const file = Bun.file(conversationLogPath(root));
  if (!(await file.exists())) {
    return [];
  }
  return (await file.text())
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogRecord);
}

test('検出語が無い時、何も報告せず記録もしないこと', async () => {
  const path = await transcript(CLEAN);

  expect(await check(path)).toBeUndefined();
  expect(await logRecords()).toEqual([]);
});

test('error の検出語がある時、該当文を差し戻し、記録にも残すこと', async () => {
  const path = await transcript(SEVERE);

  const message = await check(path);

  expect(message).toContain(SEVERE);
  expect(message).toContain('鍵となる:');
  expect(await logRecords()).toEqual([
    {
      timestamp: expect.any(String),
      sessionId: SESSION_ID,
      ruleId: 'empty-adjective-emphasis',
      severity: 'severe',
      matched: '鍵となる',
      sentence: SEVERE,
    },
  ]);
});

test('一度差し戻しても直らなかった時、記録だけ残して終了させること', async () => {
  const path = await transcript(SEVERE);

  const message = await check(path, undefined, true);

  expect(message).toBeUndefined();
  expect(await logRecords()).toHaveLength(1);
});

test('warning だけの時、差し戻さないが記録には残すこと', async () => {
  const path = await transcript(WARNING_ONLY);

  expect(await check(path)).toBeUndefined();
  expect((await logRecords()).map((record) => record.severity)).toEqual([
    'warning',
  ]);
});

test('同じ指摘は同じセッションで一度しか報告も記録もしないこと', async () => {
  const path = await transcript(SEVERE);
  await check(path);

  expect(await check(path)).toBeUndefined();
  expect(await logRecords()).toHaveLength(1);
});

test('差し戻し文面の上限を超える指摘がある時、残りの件数を示すこと', async () => {
  const sentences = Array.from(
    { length: 7 },
    (_, index) => `項目 ${index + 1} の設定は鍵となる。`,
  );
  const path = await transcript(sentences.join('\n'));

  const message = await check(path);

  expect(message).toContain(sentences[0]);
  expect(message).not.toContain(sentences[6]);
  expect(message).toContain('ほか 2 文');
});

test('1 文に複数の指摘が当たる時、その文を一度だけ示すこと', async () => {
  const sentence = '鍵となる設計を多角的に検討した。';
  const path = await transcript(sentence);

  const message = await check(path);

  expect(message?.split(sentence)).toHaveLength(2);
  expect(message).toContain('鍵となる:');
  expect(message).toContain('多角的:');
});

test('transcript にまだ返答が無い時、最後の返答を検査すること', async () => {
  const path = await transcript();

  const message = await check(path, SEVERE);

  expect(message).toContain(SEVERE);
});

test('最後の返答が transcript にもある時、同じ指摘を二重に出さないこと', async () => {
  const path = await transcript(SEVERE);

  await check(path, SEVERE);

  expect(await logRecords()).toHaveLength(1);
});

test('ツールの合間の発言と最後の返答の両方を検査すること', async () => {
  const path = await transcript('調べます。多角的に確認しました。');

  const message = await check(path, SEVERE);

  expect(message).toContain('多角的');
  expect(message).toContain('鍵となる');
});

test('コードブロックの中は検査しないこと', async () => {
  const path = await transcript(['```ts', `// ${SEVERE}`, '```'].join('\n'));

  expect(await check(path)).toBeUndefined();
});

test('英語だけの返答は検査しないこと', async () => {
  const path = await transcript('This is the key part of the design.');

  expect(await check(path)).toBeUndefined();
});

test('記録先が壊れていてもターンを止めないこと', async () => {
  const path = await transcript(SEVERE);
  const broken: ReportedStore = {
    read: () => Promise.reject(new Error('boom')),
    write: () => Promise.resolve(),
  };

  const message = await decideConversation(
    { sessionId: SESSION_ID, transcriptPath: path, stopHookActive: false },
    broken,
    root,
  );

  expect(message).toBeUndefined();
});
