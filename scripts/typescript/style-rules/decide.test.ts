import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { decideStop, decideWrite } from './decide.ts';
import {
  createSessionStore,
  createWarningStore,
  type SessionStore,
  type WarningStore,
} from './session-store.ts';

const SEVERE = '型定義は鍵となる。';
const ANOTHER_SEVERE = '多角的な検討を行う。';
const POLITE_SEVERE = '型定義は根本的な部分です。';
const WARNING = 'この関数の契約を決める。';
const CLEAN = 'この関数は設定ファイルを読み込む。';
// 「ます」が 3 連続する。文体の混在と体言止めは同時に起こさない
const REPEATED_ENDING = [
  'これは設定を読み込みます。',
  '次に一覧を作ります。',
  '最後に結果を並べます。',
].join('\n');
const REPEATED_ENDING_REPORT = '「ます」で終わる文が 3 連続';
const SESSION_ID = 'test-session';

// 一時ディレクトリは検査対象から外れているため、テスト用のファイルはここに置けない
let workspace: string;
let store: SessionStore;
let warnings: WarningStore;

beforeEach(async () => {
  workspace = await mkdtemp(join(import.meta.dir, '.test-'));
  store = createSessionStore(join(workspace, 'store'));
  warnings = createWarningStore(join(workspace, 'store'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeMarkdown(name: string, text: string): Promise<string> {
  const path = join(workspace, name);
  await Bun.write(path, text);
  return path;
}

function write(filePath: string, writtenText: string) {
  return decideWrite(
    { filePath, writtenText, sessionId: SESSION_ID },
    store,
    warnings,
  );
}

describe('書き込み直後の検査', () => {
  describe('検査する対象', () => {
    test('.md 以外のファイルは検査しないこと', async () => {
      const filePath = await writeMarkdown('note.txt', SEVERE);

      const reason = await write(filePath, SEVERE);

      expect(reason).toBeUndefined();
    });

    test('作業メモの置き場は検査しないこと', async () => {
      const filePath = await writeMarkdown('scratchpad/note.md', SEVERE);

      const reason = await write(filePath, SEVERE);

      expect(reason).toBeUndefined();
    });

    test('取り込んだファイルは検査しないこと', async () => {
      const filePath = await writeMarkdown('node_modules/pkg/note.md', SEVERE);

      const reason = await write(filePath, SEVERE);

      expect(reason).toBeUndefined();
    });

    test('書き込み直後にファイルが消えている時、何もしないこと', async () => {
      const reason = await write(join(workspace, 'missing.md'), SEVERE);

      expect(reason).toBeUndefined();
    });
  });

  describe('検査の結果', () => {
    test('違反が無い時、そのまま通すこと', async () => {
      const filePath = await writeMarkdown('clean.md', CLEAN);

      const reason = await write(filePath, CLEAN);

      expect(reason).toBeUndefined();
    });

    test('違反がある時、該当文と書き直し方を添えて差し戻すこと', async () => {
      const filePath = await writeMarkdown('a.md', SEVERE);

      const reason = await write(filePath, SEVERE);

      expect(reason).toContain(filePath);
      expect(reason).toContain(`[error] ${SEVERE}`);
      expect(reason).toContain('  鍵となる: ');
    });

    test('差し替えた断片に含まれる語だけを報告すること', async () => {
      const filePath = await writeMarkdown('a.md', [SEVERE, CLEAN].join('\n'));

      const reason = await write(filePath, CLEAN);

      expect(reason).toBeUndefined();
    });

    test('検査中に例外が起きても、書き込みを妨げないこと', async () => {
      const blocked = createSessionStore(await writeMarkdown('blocker', 'x'));
      const filePath = await writeMarkdown('a.md', SEVERE);

      // decideWrite は例外の内容を stderr に直接書くため、
      // 差し替えないとテスト出力に想定内の診断行が混ざる
      const original = process.stderr.write;
      process.stderr.write = (() => true) as typeof process.stderr.write;
      const reason = await decideWrite(
        { filePath, writtenText: SEVERE, sessionId: SESSION_ID },
        blocked,
        warnings,
      ).finally(() => {
        process.stderr.write = original;
      });

      expect(reason).toBeUndefined();
    });
  });

  describe('繰り返す警告の抑制', () => {
    test('同じ文書レベルの警告が続けて検出された時、2 回目は報告しないこと', async () => {
      const filePath = await writeMarkdown('a.md', REPEATED_ENDING);
      expect(await write(filePath, REPEATED_ENDING)).toContain(
        REPEATED_ENDING_REPORT,
      );

      const reason = await write(filePath, REPEATED_ENDING);

      expect(reason).toBeUndefined();
    });

    test('重大な指摘がある時、2 回目以降も報告すること', async () => {
      const body = [REPEATED_ENDING, POLITE_SEVERE].join('\n');
      const filePath = await writeMarkdown('a.md', body);
      await write(filePath, body);

      const reason = await write(filePath, body);

      expect(reason).toContain(`[error] ${POLITE_SEVERE}`);
      expect(reason).not.toContain(REPEATED_ENDING_REPORT);
    });

    test('対象文が書き換わって別の警告になった時、報告すること', async () => {
      const filePath = await writeMarkdown('a.md', REPEATED_ENDING);
      await write(filePath, REPEATED_ENDING);
      const rewritten = [
        '入力を検証します。',
        '結果を保存します。',
        '通知を送ります。',
      ].join('\n');
      await Bun.write(filePath, rewritten);

      const reason = await write(filePath, rewritten);

      expect(reason).toContain(REPEATED_ENDING_REPORT);
    });

    test('一度消えた警告が書き戻されて再び現れた時、報告すること', async () => {
      const filePath = await writeMarkdown('a.md', REPEATED_ENDING);
      await write(filePath, REPEATED_ENDING);
      const broken = REPEATED_ENDING.replace(
        '次に一覧を作ります。',
        '次に一覧を作りました。',
      );
      await Bun.write(filePath, broken);
      expect(await write(filePath, broken)).toBeUndefined();
      await Bun.write(filePath, REPEATED_ENDING);

      const reason = await write(filePath, REPEATED_ENDING);

      expect(reason).toContain(REPEATED_ENDING_REPORT);
    });

    test('語レベルの警告は、書いた範囲に含まれるたびに報告すること', async () => {
      const filePath = await writeMarkdown('a.md', WARNING);
      await write(filePath, WARNING);

      const reason = await write(filePath, WARNING);

      expect(reason).toContain('契約');
    });

    test('別のファイルの警告は互いの抑制に影響しないこと', async () => {
      const first = await writeMarkdown('a.md', REPEATED_ENDING);
      const second = await writeMarkdown('b.md', REPEATED_ENDING);
      await write(first, REPEATED_ENDING);

      const reason = await write(second, REPEATED_ENDING);

      expect(reason).toContain(REPEATED_ENDING_REPORT);
    });

    test('警告を抑制しても、重大な指摘の記録は残ること', async () => {
      const body = [REPEATED_ENDING, POLITE_SEVERE].join('\n');
      const filePath = await writeMarkdown('a.md', body);
      await write(filePath, body);

      await write(filePath, body);

      expect(await store.read(SESSION_ID)).toEqual([
        { filePath, sentences: [POLITE_SEVERE] },
      ]);
    });
  });

  describe('ターン終了時への持ち越し', () => {
    test('重大な指摘があった時、該当文がセッションに記録されること', async () => {
      const filePath = await writeMarkdown('a.md', SEVERE);

      await write(filePath, SEVERE);

      expect(await store.read(SESSION_ID)).toEqual([
        { filePath, sentences: [SEVERE] },
      ]);
    });

    test('警告だけの時、記録が残らないこと', async () => {
      const filePath = await writeMarkdown('a.md', WARNING);

      await write(filePath, WARNING);

      expect(await store.read(SESSION_ID)).toEqual([]);
    });

    test('同じファイルに 2 回書き込んだ時、該当文が重複せずに積まれること', async () => {
      const filePath = await writeMarkdown('a.md', SEVERE);
      await write(filePath, SEVERE);
      const updated = [SEVERE, ANOTHER_SEVERE].join('\n');
      await Bun.write(filePath, updated);

      await write(filePath, updated);

      expect(await store.read(SESSION_ID)).toEqual([
        { filePath, sentences: [SEVERE, ANOTHER_SEVERE] },
      ]);
    });

    test('別のファイルの記録は別に積まれること', async () => {
      const first = await writeMarkdown('a.md', SEVERE);
      const second = await writeMarkdown('b.md', ANOTHER_SEVERE);
      await write(first, SEVERE);

      await write(second, ANOTHER_SEVERE);

      expect(await store.read(SESSION_ID)).toHaveLength(2);
    });
  });
});

describe('ターン終了時の確認', () => {
  function stop(stopHookActive = false) {
    return decideStop({ sessionId: SESSION_ID, stopHookActive }, store);
  }

  test('記録が無い時、そのまま終了できること', async () => {
    const reason = await stop();

    expect(reason).toBeUndefined();
  });

  test('記録した該当文がファイルに残っている時、終了させず書き直しを求めること', async () => {
    const filePath = await writeMarkdown('a.md', SEVERE);
    await write(filePath, SEVERE);

    const reason = await stop();

    expect(reason).toContain(filePath);
    expect(reason).toContain(`  ${SEVERE}`);
  });

  test('該当文が書き直されて消えている時、そのまま終了でき、記録も消えること', async () => {
    const filePath = await writeMarkdown('a.md', SEVERE);
    await write(filePath, SEVERE);
    await Bun.write(filePath, CLEAN);

    const reason = await stop();

    expect(reason).toBeUndefined();
    expect(await store.read(SESSION_ID)).toEqual([]);
  });

  test('記録したファイルごと消えている時、そのまま終了できること', async () => {
    const filePath = await writeMarkdown('a.md', SEVERE);
    await write(filePath, SEVERE);
    await rm(filePath);

    const reason = await stop();

    expect(reason).toBeUndefined();
  });

  test('差し戻し文面に載りきらない数の指摘がある時、載らなかった文も示されること', async () => {
    const body = Array.from(
      { length: 10 },
      (_, index) => `項目 ${index + 1} の設定は鍵となる。`,
    ).join('\n\n');
    const lastSentence = '項目 10 の設定は鍵となる。';
    const filePath = await writeMarkdown('a.md', body);
    expect(await write(filePath, body)).not.toContain(lastSentence);

    const reason = await stop();

    expect(reason).toContain(lastSentence);
  });

  test('一度止めても直らなかった時、記録を捨てて終了させること', async () => {
    const filePath = await writeMarkdown('a.md', SEVERE);
    await write(filePath, SEVERE);

    const reason = await stop(true);

    expect(reason).toBeUndefined();
    expect(await store.read(SESSION_ID)).toEqual([]);
  });
});
