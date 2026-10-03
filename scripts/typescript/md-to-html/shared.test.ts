import { describe, expect, it } from 'bun:test';
import {
  type Annotation,
  formatBrokenAnchors,
  formatUnresolvedComments,
  type UnresolvedEntry,
  type UnresolvedReport,
} from './shared.ts';

const SOURCE_PATH = '/Users/x/project/doc.md';
const COMMENTS_PATH = '/Users/x/.claude/output-html/project-doc.comments.json';

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

function createEntry(overrides: Partial<UnresolvedEntry> = {}): UnresolvedEntry {
  return {
    commentsPath: COMMENTS_PATH,
    sourcePath: SOURCE_PATH,
    markdown: ['# タイトル', '', '本文の説明です。'].join('\n'),
    annotations: [],
    ...overrides,
  };
}

function createReport(overrides: Partial<UnresolvedReport> = {}): UnresolvedReport {
  return {
    entries: [],
    outOfScopeCount: 0,
    unreadablePaths: [],
    ...overrides,
  };
}

// 定型文をそのまま期待値に置くと、文言を推敲しただけでテストが壊れる。
// 検証するのは文面に載るデータ(パス・行番号・引用・コメント・id)と、
// 状態によって変わる構造だけにする
describe('未対応コメントの提示', () => {
  it('対象 Markdown のパスと行番号が添えられること', () => {
    const markdown = ['# タイトル', '', '本文の説明です。', '', '重要な指摘事項です。'].join('\n');
    const annotation = createAnnotation({ exact: '重要な指摘事項です' });
    const entry = createEntry({ markdown, annotations: [annotation] });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain(`${SOURCE_PATH}:5`);
  });

  it('コメントの本文が添えられること', () => {
    const annotation = createAnnotation({
      exact: '本文の説明です',
      comment: 'ここの書き方を直してください',
    });
    const entry = createEntry({ annotations: [annotation] });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('ここの書き方を直してください');
  });

  it('解決済みにするための id が添えられること', () => {
    const annotation = createAnnotation({
      id: 'annotation-42',
      exact: '本文の説明です',
    });
    const entry = createEntry({ annotations: [annotation] });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('annotation-42');
  });

  it('複数のコメントがすべて添えられること', () => {
    const entry = createEntry({
      annotations: [
        createAnnotation({ id: 'first', comment: '1 件目の指摘' }),
        createAnnotation({ id: 'second', comment: '2 件目の指摘' }),
      ],
    });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('1 件目の指摘');
    expect(result).toContain('2 件目の指摘');
  });

  it('引用が長い場合、末尾が切り詰められること', () => {
    const longExact = 'あ'.repeat(80);
    const annotation = createAnnotation({ exact: longExact });
    const entry = createEntry({
      sourcePath: undefined,
      markdown: undefined,
      annotations: [annotation],
    });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain(`${'あ'.repeat(60)}…`);
    expect(result).not.toContain(longExact);
  });

  it('対象 Markdown が特定できないコメントには、パスが添えられないこと', () => {
    const annotation = createAnnotation({ exact: '保存時の引用' });
    const entry = createEntry({
      sourcePath: undefined,
      markdown: undefined,
      annotations: [annotation],
    });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('保存時の引用');
    expect(result).not.toContain(SOURCE_PATH);
  });

  it('引用が現在の本文から失われたコメントには、行番号が添えられないこと', () => {
    const annotation = createAnnotation({ exact: '消えてしまった引用' });
    const entry = createEntry({ annotations: [annotation] });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('消えてしまった引用');
    expect(result).not.toMatch(/doc\.md:\d/);
  });

  it('位置がずれたコメントには、現在の本文から取り直した引用が添えられること', () => {
    const markdown = '前の文脈です。変更後の新しい文章です。後の文脈です。';
    const annotation = createAnnotation({
      exact: '削除された古い文章です',
      prefix: '前の文脈です',
      suffix: '後の文脈です',
    });
    const entry = createEntry({ markdown, annotations: [annotation] });
    const report = createReport({ entries: [entry] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('変更後の新しい文章です');
  });

  it('作業ディレクトリ外に未対応がある場合、その件数が添えられること', () => {
    const annotation = createAnnotation({ exact: '本文の説明です' });
    const entry = createEntry({ annotations: [annotation] });
    const report = createReport({ entries: [entry], outOfScopeCount: 3 });

    const result = formatUnresolvedComments(report);

    expect(result).toContain('3 件');
  });

  it('読み込めなかったファイルがある場合、そのパスが添えられること', () => {
    const brokenPath = '/Users/x/.claude/output-html/broken.comments.json';
    const report = createReport({ unreadablePaths: [brokenPath] });

    const result = formatUnresolvedComments(report);

    expect(result).toContain(brokenPath);
  });

  it('提示するコメントがない場合、読み込み失敗の報告だけが出ること', () => {
    const brokenPath = '/Users/x/.claude/output-html/broken.comments.json';
    const report = createReport({ entries: [], unreadablePaths: [brokenPath] });

    const result = formatUnresolvedComments(report);

    expect(result.split('\n')).toHaveLength(1);
  });
});

describe('編集で壊れたコメントの提示', () => {
  it('壊れた件数が伝えられること', () => {
    const entry = createEntry({
      annotations: [createAnnotation({ id: 'a' }), createAnnotation({ id: 'b' })],
    });

    const result = formatBrokenAnchors(entry);

    expect(result).toContain('2 件');
  });

  it('渡されたコメントがすべて並ぶこと', () => {
    const first = createAnnotation({ id: 'a', comment: 'コメントA' });
    const second = createAnnotation({ id: 'b', comment: 'コメントB' });
    const entry = createEntry({ annotations: [first, second] });

    const result = formatBrokenAnchors(entry);

    expect(result).toContain('コメントA');
    expect(result).toContain('コメントB');
  });
});
