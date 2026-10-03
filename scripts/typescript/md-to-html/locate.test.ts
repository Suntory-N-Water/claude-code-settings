import { describe, expect, it } from 'bun:test';
import { locateAnnotation } from './locate.ts';
import type { Annotation } from './shared.ts';

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

describe('コメントの位置特定', () => {
  describe('本文が変わっていないとき', () => {
    it('引用がそのまま見つかる場合、その行番号を返すこと', () => {
      const markdown = [
        '# タイトル',
        '',
        '最初の段落です。',
        '',
        'これはテスト対象の文章です。',
      ].join('\n');
      const annotation = createAnnotation({
        exact: 'これはテスト対象の文章です。',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 5,
        quote: 'これはテスト対象の文章です。',
      });
    });

    it('引用が強調やリンクの記法をまたぐ場合でも、記法を無視して見つかること', () => {
      const markdown = [
        '# タイトル',
        '',
        'これは[重要](https://example.com/hoge)な内容を含む文章です。',
      ].join('\n');
      const annotation = createAnnotation({ exact: '重要な内容' });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 3,
        quote: '重要な内容',
      });
    });

    it('引用の途中に強調がある場合、記号を含まない引用を返すこと', () => {
      const markdown = ['# タイトル', '', 'これは **強調** を含む文章です。'].join('\n');
      const annotation = createAnnotation({
        exact: 'これは 強調 を含む文章です',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 3,
        quote: 'これは 強調 を含む文章です。',
      });
    });

    it('引用が見出しやリスト項目の場合、行頭の記号を無視して見つかること', () => {
      const markdown = ['# 重要な見出しです', '', '本文。'].join('\n');
      const annotation = createAnnotation({ exact: '重要な見出しです' });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 1,
        quote: '重要な見出しです',
      });
    });

    it('引用の末尾の句読点まで含めて現在の本文から引用し直すこと', () => {
      const markdown = ['# タイトル', '', 'これはテスト対象の文章です。続きの文。'].join('\n');
      const annotation = createAnnotation({
        exact: 'これはテスト対象の文章です',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 3,
        quote: 'これはテスト対象の文章です。',
      });
    });

    it('引用が複数行にまたがる場合、先頭行の行番号を返すこと', () => {
      const markdown = ['# タイトル', '', 'これは一行目の文章で', '二行目に続きます。'].join('\n');
      const annotation = createAnnotation({
        exact: '一行目の文章で二行目に続きます',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 3,
        quote: '一行目の文章で 二行目に続きます。',
      });
    });

    it('同じ文が複数箇所にある場合、前後の文脈が最も一致する箇所を返すこと', () => {
      const markdown = [
        '前置きAです。',
        '同じ文章です。',
        '中間のBです。',
        '同じ文章です。',
        '後書きCです。',
      ].join('\n');
      const annotation = createAnnotation({
        exact: '同じ文章です',
        prefix: '中間のBです',
        suffix: '後書きCです',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 4,
        quote: '同じ文章です。',
      });
    });

    it('front matter に同じ文字列がある場合、本文側の位置を返すこと', () => {
      const markdown = [
        '---',
        'title: サンプルタイトル',
        '---',
        '',
        'サンプルタイトルについて説明します。',
      ].join('\n');
      const annotation = createAnnotation({ exact: 'サンプルタイトル' });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'found',
        line: 5,
        quote: 'サンプルタイトル',
      });
    });
  });

  describe('コメントを書いた後に本文が変わったとき', () => {
    it('引用が変わっても前後の文脈が残っている場合、現在の該当箇所を返すこと', () => {
      const markdown = ['前の文脈です。', '変更後の新しい文章です。', '後の文脈です。'].join('\n');
      const annotation = createAnnotation({
        exact: '削除された古い文章です',
        prefix: '前の文脈です',
        suffix: '後の文脈です',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'shifted',
        line: 2,
        quote: '変更後の新しい文章です。',
      });
    });

    it('前後の文脈が複数箇所にある場合、挟まれた範囲が最も短い箇所を返すこと', () => {
      const markdown = [
        '文脈Aです。長い長い長い長い長い長い中間文章。文脈Bです。',
        '文脈Aです。短い中間。文脈Bです。',
      ].join('\n');
      const annotation = createAnnotation({
        exact: '元の引用文',
        prefix: '文脈Aです',
        suffix: '文脈Bです',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({
        status: 'shifted',
        line: 2,
        quote: '短い中間。',
      });
    });

    it('挟まれた範囲が元の引用に対して極端に長い場合、位置を特定できないと返すこと', () => {
      const longMiddle = '中'.repeat(300);
      const markdown = `文脈Aです。${longMiddle}文脈Bです。`;
      const annotation = createAnnotation({
        exact: '短い元の引用',
        prefix: '文脈Aです',
        suffix: '文脈Bです',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({ status: 'lost' });
    });

    it('引用も前後の文脈も失われた場合、位置を特定できないと返すこと', () => {
      const markdown = 'まったく関係のない文章です。';
      const annotation = createAnnotation({
        exact: '存在しない引用文',
        prefix: '存在しない前文脈',
        suffix: '存在しない後文脈',
      });

      const result = locateAnnotation(markdown, annotation);

      expect(result).toEqual({ status: 'lost' });
    });
  });
});
