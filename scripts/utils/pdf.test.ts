import { describe, expect, it } from 'bun:test';
import { type PdfLine, pdfLinesToMarkdown } from './pdf';

const PAGE_HEIGHT = 800;
const FULL_RIGHT = 500;

function line(
  text: string,
  overrides: Partial<Omit<PdfLine, 'text'>> = {},
): PdfLine {
  const top = overrides.top ?? 100;
  const size = overrides.size ?? 10;
  return {
    page: 0,
    text,
    indented: false,
    size,
    left: 50,
    right: FULL_RIGHT,
    top,
    bottom: top + size,
    pageHeight: PAGE_HEIGHT,
    ...overrides,
  };
}

describe('PDF の行を Markdown に変換する', () => {
  describe('段落のつなぎ方', () => {
    it.each([
      [
        '日本語どうし',
        '公用文の原則が適用',
        'されることを目指す。',
        '公用文の原則が適用されることを目指す。',
      ],
      [
        '英語どうし',
        'The dominant models are',
        'based on attention.',
        'The dominant models are based on attention.',
      ],
      [
        '単語の途中のハイフン',
        'sequence transduc-',
        'tion models.',
        'sequence transduc-tion models.',
      ],
    ])('%s をつなぐとき、読める文としてつながること', (_, first, second, expected) => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line(first, { top: 100 }),
        line(second, { top: 120, right: 200 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(expected);
    });
  });

  describe('新しい段落を始める条件', () => {
    it.each([
      ['前の行が右端まで届いていない', { right: 300 }, {}, '次の段落'],
      ['次の行が字下げされている', {}, { indented: true }, '次の段落'],
      ['次の行がカタカナの項目記号で始まる', {}, {}, 'ア 次の項目'],
      ['次の行が括弧付きの番号で始まる', {}, {}, '（１）次の項目'],
      ['次の行が中黒で始まる', {}, {}, '・次の項目'],
    ])('%s とき、新しい段落になること', (_, prevOverrides: Partial<PdfLine>, nextOverrides: Partial<PdfLine>, nextText) => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('前の段落', { top: 100, ...prevOverrides }),
        line(nextText, { top: 120, ...nextOverrides }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(`前の段落\n\n${nextText}`);
    });
  });

  describe('左右を狭めた段落', () => {
    it('右端のそろった長い行が続くとき、ページの右端に届かなくても同じ段落になること', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('The dominant sequence transduction', {
          top: 100,
          left: 100,
          right: 400,
        }),
        line('models are based on attention', {
          top: 120,
          left: 100,
          right: 400,
        }),
        line('・本文', { top: 140 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(
        'The dominant sequence transduction models are based on attention\n\n・本文',
      );
    });

    it('前の行が句点で終わるとき、次の行とつながらないこと', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('要旨の段落はここで終わる。', { top: 100, left: 100, right: 400 }),
        line('次の段落はここから始まる', { top: 120, left: 100, right: 400 }),
        line('・本文', { top: 140 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(
        '要旨の段落はここで終わる。\n\n次の段落はここから始まる\n\n・本文',
      );
    });
  });

  describe('ヘッダー・フッター', () => {
    function pagesWithHeader(pageCount: number): PdfLine[] {
      return Array.from({ length: pageCount }, (_, page) => [
        line('公用文作成の考え方', { page, top: 20, right: 150 }),
        line(`本文${page}`, { page, top: 100, right: 150 }),
      ]).flat();
    }

    it('余白にある同じ行が 5 ページ以上に出てくるとき、除かれること', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = pagesWithHeader(5);

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe('本文0\n\n本文1\n\n本文2\n\n本文3\n\n本文4');
    });

    it('余白にある同じ行が 4 ページまでしか出てこないとき、本文として残ること', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = pagesWithHeader(4);

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(
        [0, 1, 2, 3]
          .map((page) => `公用文作成の考え方\n\n本文${page}`)
          .join('\n\n'),
      );
    });

    it.each([
      ['(１)'],
      ['- 3 -'],
      ['<12>'],
      ['ii'],
    ])('ページ番号 %s は、1 ページにしか出てこなくても除かれること', (pageNumber) => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('本文', { top: 100, right: 150 }),
        line(pageNumber, { top: 780, right: 80 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe('本文');
    });
  });

  describe('振り仮名と同じ高さの行', () => {
    it('振り仮名は除かれ、振り仮名で分かれた語が 1 語につながること', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('例）忸', { left: 50, right: 80 }),
        line('じく', { size: 5, left: 75, right: 85, top: 94 }),
        line('怩', { left: 80, right: 90 }),
        line('たる思い', { left: 90, right: 130 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe('例）忸怩たる思い');
    });

    it('同じ高さにある行どうしの間隔が広いとき、空白を挟んでつながること', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('大別', { left: 50, right: 70 }),
        line('具体例', { left: 150, right: 180 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe('大別 具体例');
    });
  });

  describe('見出し', () => {
    const body = 'あ'.repeat(80);

    it('本文より大きい文字の行は、文字の大きい順に上位の見出しになること', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const lines = [
        line('公用文作成の考え方', { size: 16, top: 50, right: 200 }),
        line('前書き', { size: 12, top: 80, right: 100 }),
        line(body, { top: 100, right: 300 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(`# 公用文作成の考え方\n\n## 前書き\n\n${body}`);
    });

    it('文字が大きくても長すぎる行は、見出しにならないこと', () => {
      // Arrange
      const sut = pdfLinesToMarkdown;
      const longLine = 'い'.repeat(51);
      const lines = [
        line(longLine, { size: 16, top: 50, right: 300 }),
        line(body, { top: 100, right: 300 }),
      ];

      // Act
      const result = sut(lines);

      // Assert
      expect(result).toBe(`${longLine}\n\n${body}`);
    });
  });

  it('本文が 1 行だけのページが続くとき、各ページの行が別々の段落になること', () => {
    // Arrange
    const sut = pdfLinesToMarkdown;
    const lines = [0, 1, 2].map((page) =>
      line(`本文${page}`, { page, top: 100, right: 150 }),
    );

    // Act
    const result = sut(lines);

    // Assert
    expect(result).toBe('本文0\n\n本文1\n\n本文2');
  });
});
