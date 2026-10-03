import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, isUnder } from './inject-comments.ts';
import { readInjectedIds, recordInjectedIds } from './md-to-html/session.ts';
import {
  type Annotation,
  type CommentsFile,
  OUTPUT_ROOT,
  writeCommentsFile,
} from './md-to-html/shared.ts';

describe('コメント注入の対象範囲', () => {
  it('作業ディレクトリ配下のパスが対象になること', () => {
    const result = isUnder('/a/proj', '/a/proj/src/file.md');

    expect(result).toBe(true);
  });

  it('作業ディレクトリ外のパスが対象外になること', () => {
    const result = isUnder('/a/proj', '/a/other/file.md');

    expect(result).toBe(false);
  });

  it('作業ディレクトリと接頭辞が同じだけの別ディレクトリが対象外になること', () => {
    const result = isUnder('/a/proj', '/a/proj-alpha/file.md');

    expect(result).toBe(false);
  });

  it('作業ディレクトリ自身が指定された場合、対象外になること', () => {
    const result = isUnder('/a/proj', '/a/proj');

    expect(result).toBe(false);
  });

  it('親ディレクトリを辿る表記が含まれていても、実際の位置で判定されること', () => {
    const result = isUnder('/a/proj', '/a/proj/sub/../../proj/file.md');

    expect(result).toBe(true);
  });
});

const SESSION_DIR = join(OUTPUT_ROOT, '.sessions');
const CREATED_SESSION_FILES = [
  join(SESSION_DIR, '__test_inject__repeat.json'),
  join(SESSION_DIR, '__test_inject__session_a.json'),
  join(SESSION_DIR, '__test_inject__session_b.json'),
  join(SESSION_DIR, '__test_inject__broken_session.json'),
];

afterAll(async () => {
  for (const path of CREATED_SESSION_FILES) {
    await rm(path, { force: true });
  }
});

function createAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'test-id',
    exact: '',
    prefix: '',
    suffix: '',
    comment: 'テストコメント',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createComments(overrides: Partial<CommentsFile> = {}): CommentsFile {
  return {
    version: 1,
    annotations: [],
    ...overrides,
  };
}

async function writeSourceMarkdown(
  cwd: string,
  name: string,
  content = '# 見出し\n\n本文です。',
): Promise<string> {
  const path = join(cwd, name);
  await Bun.write(path, content);
  return path;
}

async function writeComments(root: string, name: string, comments: CommentsFile): Promise<string> {
  const path = join(root, name);
  await writeCommentsFile(path, comments);
  return path;
}

async function writeBrokenComments(root: string, name: string): Promise<string> {
  const path = join(root, name);
  await Bun.write(path, '{ 壊れた JSON');
  return path;
}

async function promptOnce(cwd: string, sessionId: string, root: string) {
  const injected = await readInjectedIds(sessionId);
  const report = await collect(cwd, injected, root);
  await recordInjectedIds(
    sessionId,
    report.entries.flatMap((entry) => entry.annotations.map((a) => a.id)),
  );
  return report;
}

describe('注入対象の収集', () => {
  let root: string;
  let cwd: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'inject-comments-root-'));
    cwd = await mkdtemp(join(tmpdir(), 'inject-comments-cwd-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('対象 Markdown のパスが記録されていないコメントは、範囲外の件数に数えられること', async () => {
    const annotation = createAnnotation({ id: 'oos-1' });
    await writeComments(
      root,
      'no-source.comments.json',
      createComments({ annotations: [annotation] }),
    );

    const report = await collect(cwd, new Set(), root);

    expect(report.outOfScopeCount).toBe(1);
    expect(report.entries).toEqual([]);
  });

  it('コメントファイルが 1 つ壊れていても、他のファイルのコメントが集まること', async () => {
    await writeBrokenComments(root, 'broken.comments.json');
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const annotation = createAnnotation({ id: 'ok-1' });
    await writeComments(
      root,
      'ok.comments.json',
      createComments({ sourcePath, annotations: [annotation] }),
    );

    const report = await collect(cwd, new Set(), root);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.annotations).toEqual([annotation]);
  });

  it('壊れたコメントファイルのパスが報告されること', async () => {
    const brokenPath = await writeBrokenComments(root, 'broken.comments.json');

    const report = await collect(cwd, new Set(), root);

    expect(report.unreadablePaths).toEqual([brokenPath]);
  });

  it('解決済みのコメントは集められないこと', async () => {
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const resolved = createAnnotation({ id: 'resolved-1', resolved: true });
    const unresolved = createAnnotation({ id: 'unresolved-1' });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [resolved, unresolved] }),
    );

    const report = await collect(cwd, new Set(), root);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.annotations).toEqual([unresolved]);
  });
});

describe('同じコメントを繰り返し出さないこと', () => {
  let root: string;
  let cwd: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'inject-comments-root-'));
    cwd = await mkdtemp(join(tmpdir(), 'inject-comments-cwd-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('初めて見るコメントは、全文が集まること', async () => {
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const annotation = createAnnotation({
      id: 'first-1',
      comment: '初めてのコメント',
    });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [annotation] }),
    );

    const report = await collect(cwd, new Set(), root);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.annotations).toEqual([annotation]);
  });

  it('一度提示したコメントは、同じセッションの次の発言では集まらないこと', async () => {
    const sessionId = '__test_inject__repeat';
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const annotation = createAnnotation({
      id: 'repeat-1',
      comment: '繰り返しのコメント',
    });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [annotation] }),
    );
    await promptOnce(cwd, sessionId, root);

    const secondReport = await promptOnce(cwd, sessionId, root);

    expect(secondReport.entries).toEqual([]);
  });

  it('未提示のコメントがすべて既出の場合、何も集まらないこと', async () => {
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const first = createAnnotation({ id: 'seen-1' });
    const second = createAnnotation({ id: 'seen-2' });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [first, second] }),
    );

    const report = await collect(cwd, new Set(['seen-1', 'seen-2']), root);

    expect(report.entries).toEqual([]);
  });

  it('新しく書かれたコメントは、既出のコメントがあっても集まること', async () => {
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const seen = createAnnotation({ id: 'seen-3', comment: '既出のコメント' });
    const fresh = createAnnotation({
      id: 'fresh-1',
      comment: '新しいコメント',
    });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [seen, fresh] }),
    );

    const report = await collect(cwd, new Set(['seen-3']), root);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.annotations).toEqual([fresh]);
  });

  it('同じ箇所に対する 2 度目の指摘も、別のコメントとして集まること', async () => {
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const first = createAnnotation({
      id: 'dup-1',
      exact: '同じ箇所',
      prefix: '前の文脈',
      suffix: '後の文脈',
      comment: '最初の指摘',
    });
    const second = createAnnotation({
      id: 'dup-2',
      exact: '同じ箇所',
      prefix: '前の文脈',
      suffix: '後の文脈',
      comment: '2 度目の指摘',
    });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [first, second] }),
    );

    const report = await collect(cwd, new Set(), root);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.annotations).toEqual([first, second]);
  });

  it('セッションが変わった場合、未対応のコメントは改めて集まること', async () => {
    const sessionA = '__test_inject__session_a';
    const sessionB = '__test_inject__session_b';
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const annotation = createAnnotation({
      id: 'cross-1',
      comment: 'セッションをまたぐコメント',
    });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [annotation] }),
    );
    await promptOnce(cwd, sessionA, root);

    const reportB = await promptOnce(cwd, sessionB, root);

    expect(reportB.entries).toHaveLength(1);
    expect(reportB.entries[0]?.annotations).toEqual([annotation]);
  });

  it('既出の記録が読めない場合は、未対応のコメントが集まること', async () => {
    const sessionId = '__test_inject__broken_session';
    await mkdir(SESSION_DIR, { recursive: true });
    await Bun.write(join(SESSION_DIR, `${sessionId}.json`), '{ 壊れた JSON');
    const sourcePath = await writeSourceMarkdown(cwd, 'doc.md');
    const annotation = createAnnotation({
      id: 'broken-session-1',
      comment: '読めない記録の後のコメント',
    });
    await writeComments(
      root,
      'doc.comments.json',
      createComments({ sourcePath, annotations: [annotation] }),
    );

    const report = await promptOnce(cwd, sessionId, root);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.annotations).toEqual([annotation]);
  });
});
