import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  advanceBaselines,
  baselinePathForHtml,
  markPending,
  pendingPathForHtml,
  readBaseline,
} from './baseline.ts';
import { commentsPathForHtml, OUTPUT_ROOT, writeCommentsFile } from './shared.ts';

const TEST_DIR = join(OUTPUT_ROOT, '__baseline_test__');

function htmlPathFor(name: string): string {
  return join(TEST_DIR, `${name}.html`);
}

async function writeSource(name: string, content: string): Promise<string> {
  const path = join(TEST_DIR, `${name}.md`);
  await Bun.write(path, content);
  return path;
}

async function writeSourceComments(
  htmlPath: string,
  sourcePath: string | undefined,
): Promise<void> {
  await writeCommentsFile(commentsPathForHtml(htmlPath), {
    version: 1,
    annotations: [],
    ...(sourcePath === undefined ? {} : { sourcePath }),
  });
}

async function pendingExists(htmlPath: string): Promise<boolean> {
  return await Bun.file(pendingPathForHtml(htmlPath)).exists();
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('差分の基準', () => {
  describe('変換した直後', () => {
    it('変換しただけでは基準が変わらないこと', async () => {
      const htmlPath = htmlPathFor('doc');
      await Bun.write(baselinePathForHtml(htmlPath), '既存の本文');

      await markPending(htmlPath);

      expect(await readBaseline(htmlPath)).toBe('既存の本文');
    });

    it('変換したドキュメントに印が付くこと', async () => {
      const htmlPath = htmlPathFor('doc');

      await markPending(htmlPath);

      expect(await pendingExists(htmlPath)).toBe(true);
    });

    it('同じドキュメントを続けて変換しても、基準は最初のままであること', async () => {
      const htmlPath = htmlPathFor('doc');
      await Bun.write(baselinePathForHtml(htmlPath), '最初の本文');
      await markPending(htmlPath);

      await markPending(htmlPath);

      expect(await readBaseline(htmlPath)).toBe('最初の本文');
    });
  });

  describe('基準を進めたとき', () => {
    it('印が付いたドキュメントの基準が現在の本文になること', async () => {
      const htmlPath = htmlPathFor('doc');
      const sourcePath = await writeSource('doc', '現在の本文');
      await writeSourceComments(htmlPath, sourcePath);
      await markPending(htmlPath);

      await advanceBaselines(TEST_DIR);

      expect(await readBaseline(htmlPath)).toBe('現在の本文');
    });

    it('基準を進めた後は印が消えること', async () => {
      const htmlPath = htmlPathFor('doc');
      const sourcePath = await writeSource('doc', '本文');
      await writeSourceComments(htmlPath, sourcePath);
      await markPending(htmlPath);

      await advanceBaselines(TEST_DIR);

      expect(await pendingExists(htmlPath)).toBe(false);
    });

    it('印が付いていないドキュメントの基準は変わらないこと', async () => {
      const htmlPath = htmlPathFor('doc');
      const sourcePath = await writeSource('doc', '新しい本文');
      await writeSourceComments(htmlPath, sourcePath);
      await Bun.write(baselinePathForHtml(htmlPath), '古い本文');

      await advanceBaselines(TEST_DIR);

      expect(await readBaseline(htmlPath)).toBe('古い本文');
    });

    it('front matter は基準に含めないこと', async () => {
      const htmlPath = htmlPathFor('doc');
      const sourcePath = await writeSource('doc', '---\ntitle: "テスト"\n---\n本文のみ');
      await writeSourceComments(htmlPath, sourcePath);
      await markPending(htmlPath);

      await advanceBaselines(TEST_DIR);

      expect(await readBaseline(htmlPath)).toBe('本文のみ');
    });

    it('対象 Markdown の記録がないドキュメントの印は取り除かれること', async () => {
      const htmlPath = htmlPathFor('doc');
      await markPending(htmlPath);

      await advanceBaselines(TEST_DIR);

      expect(await pendingExists(htmlPath)).toBe(false);
    });

    it('対象 Markdown が存在しない場合でも、他のドキュメントの基準は進むこと', async () => {
      const missingHtmlPath = htmlPathFor('missing');
      await writeSourceComments(missingHtmlPath, join(TEST_DIR, 'missing-source.md'));
      await markPending(missingHtmlPath);
      const otherHtmlPath = htmlPathFor('other');
      const otherSourcePath = await writeSource('other', '進んだ本文');
      await writeSourceComments(otherHtmlPath, otherSourcePath);
      await markPending(otherHtmlPath);

      await advanceBaselines(TEST_DIR);

      expect(await readBaseline(otherHtmlPath)).toBe('進んだ本文');
    });
  });
});
