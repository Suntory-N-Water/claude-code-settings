import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { app } from './server.ts';
import { type Annotation, type CommentsFile, OUTPUT_ROOT } from './shared.ts';

const TEST_DIR = join(OUTPUT_ROOT, '__server_test__');
const TEST_DOC = '__server_test__/doc.html';

interface AnnotationInput {
  exact: string;
  prefix: string;
  suffix: string;
  comment: string;
}

const VALID_INPUT: AnnotationInput = {
  exact: '本文の一部',
  prefix: '前の文脈',
  suffix: '後の文脈',
  comment: 'これはコメントです',
};

async function postCommentTo(
  doc: string | undefined,
  body: AnnotationInput | Partial<AnnotationInput>,
): Promise<Response> {
  const query = doc === undefined ? '' : `?doc=${encodeURIComponent(doc)}`;
  return await app.request(`/api/comments${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postComment(body: AnnotationInput = VALID_INPUT): Promise<Response> {
  return postCommentTo(TEST_DOC, body);
}

async function getComments(doc: string = TEST_DOC): Promise<Response> {
  return await app.request(`/api/comments?doc=${encodeURIComponent(doc)}`);
}

async function patchComment(id: string, doc: string = TEST_DOC): Promise<Response> {
  return await app.request(
    `/api/comments?doc=${encodeURIComponent(doc)}&id=${encodeURIComponent(id)}`,
    { method: 'PATCH' },
  );
}

async function deleteComment(id: string, doc: string = TEST_DOC): Promise<Response> {
  return await app.request(
    `/api/comments?doc=${encodeURIComponent(doc)}&id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
}

async function storedAnnotations(doc: string = TEST_DOC): Promise<Annotation[]> {
  const res = await getComments(doc);
  const comments = (await res.json()) as CommentsFile;
  return comments.annotations;
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('コメント保存 API', () => {
  describe('コメントの追加', () => {
    it('コメントを追加した場合、保存内容から読み出せること', async () => {
      const res = await postComment();

      expect(res.status).toBe(201);
      const created = (await res.json()) as Annotation;
      const stored = await storedAnnotations();

      expect(created.exact).toBe(VALID_INPUT.exact);
      expect(created.prefix).toBe(VALID_INPUT.prefix);
      expect(created.suffix).toBe(VALID_INPUT.suffix);
      expect(created.comment).toBe(VALID_INPUT.comment);
      expect(stored).toEqual([created]);
    });

    it('コメントを続けて追加した場合、先に追加したコメントが残っていること', async () => {
      const firstRes = await postComment({ ...VALID_INPUT, comment: '1件目' });
      const first = (await firstRes.json()) as Annotation;

      const secondRes = await postComment({
        ...VALID_INPUT,
        comment: '2件目',
      });
      const second = (await secondRes.json()) as Annotation;

      const stored = await storedAnnotations();
      expect(stored).toEqual([first, second]);
    });

    it('必須項目が欠けている場合、保存されないこと', async () => {
      const baselineRes = await postComment();
      const baseline = (await baselineRes.json()) as Annotation;

      const invalidRes = await postCommentTo(TEST_DOC, {
        exact: VALID_INPUT.exact,
        prefix: VALID_INPUT.prefix,
        suffix: VALID_INPUT.suffix,
        // comment が欠けている
      });

      expect(invalidRes.status).toBe(400);
      const stored = await storedAnnotations();
      expect(stored).toEqual([baseline]);
    });
  });

  describe('コメントの解決', () => {
    it('解決済みにした場合、そのコメントだけに解決の印が付くこと', async () => {
      const aRes = await postComment({ ...VALID_INPUT, comment: 'A' });
      const a = (await aRes.json()) as Annotation;
      const bRes = await postComment({ ...VALID_INPUT, comment: 'B' });
      const b = (await bRes.json()) as Annotation;

      const patchRes = await patchComment(a.id);

      expect(patchRes.status).toBe(200);
      const stored = await storedAnnotations();
      const storedA = stored.find((x) => x.id === a.id);
      const storedB = stored.find((x) => x.id === b.id);
      expect(storedA?.resolved).toBe(true);
      expect(storedB?.resolved).toBeUndefined();
    });

    it('存在しない id を解決済みにしようとした場合、既存のコメントが変化しないこと', async () => {
      const createdRes = await postComment();
      const created = (await createdRes.json()) as Annotation;

      const patchRes = await patchComment('存在しない-id');

      expect(patchRes.status).toBe(404);
      const stored = await storedAnnotations();
      expect(stored).toEqual([created]);
    });

    it('解決済みにする処理と並行してコメントが追加された場合、追加が失われないこと', async () => {
      const existingRes = await postComment({
        ...VALID_INPUT,
        comment: '既存',
      });
      const existing = (await existingRes.json()) as Annotation;

      const [patchRes, postRes] = await Promise.all([
        patchComment(existing.id),
        postComment({ ...VALID_INPUT, comment: '新規' }),
      ]);

      expect(patchRes.status).toBe(200);
      expect(postRes.status).toBe(201);
      const added = (await postRes.json()) as Annotation;
      const stored = await storedAnnotations();
      const storedExisting = stored.find((x) => x.id === existing.id);
      const storedAdded = stored.find((x) => x.id === added.id);
      expect(storedExisting?.resolved).toBe(true);
      expect(storedAdded).toEqual(added);
    });
  });

  describe('コメントの削除', () => {
    it('削除した場合、そのコメントだけが取り除かれること', async () => {
      const aRes = await postComment({ ...VALID_INPUT, comment: 'A' });
      const a = (await aRes.json()) as Annotation;
      const bRes = await postComment({ ...VALID_INPUT, comment: 'B' });
      const b = (await bRes.json()) as Annotation;

      const deleteRes = await deleteComment(a.id);

      expect(deleteRes.status).toBe(200);
      const stored = await storedAnnotations();
      expect(stored).toEqual([b]);
    });

    it('存在しない id を削除しようとした場合、既存のコメントが変化しないこと', async () => {
      const createdRes = await postComment();
      const created = (await createdRes.json()) as Annotation;

      const deleteRes = await deleteComment('存在しない-id');

      expect(deleteRes.status).toBe(404);
      const stored = await storedAnnotations();
      expect(stored).toEqual([created]);
    });
  });

  describe('対象ドキュメントの指定', () => {
    it('doc の指定がない場合、処理されないこと', async () => {
      const baselineRes = await postComment();
      const baseline = (await baselineRes.json()) as Annotation;

      const res = await postCommentTo(undefined, {
        ...VALID_INPUT,
        comment: '別のコメント',
      });

      expect(res.status).toBe(400);
      const stored = await storedAnnotations();
      expect(stored).toEqual([baseline]);
    });

    it('親ディレクトリを辿るパスが指定された場合、処理されないこと', async () => {
      const baselineRes = await postComment();
      const baseline = (await baselineRes.json()) as Annotation;

      const res = await postCommentTo('../evil.html', {
        ...VALID_INPUT,
        comment: '別のコメント',
      });

      expect(res.status).toBe(400);
      const stored = await storedAnnotations();
      expect(stored).toEqual([baseline]);
    });

    it('HTML 以外のパスが指定された場合、処理されないこと', async () => {
      const baselineRes = await postComment();
      const baseline = (await baselineRes.json()) as Annotation;

      const res = await postCommentTo('__server_test__/doc.txt', {
        ...VALID_INPUT,
        comment: '別のコメント',
      });

      expect(res.status).toBe(400);
      const stored = await storedAnnotations();
      expect(stored).toEqual([baseline]);
    });
  });

  describe('mermaid の配信', () => {
    it('エントリを JavaScript として返すこと', async () => {
      const res = await app.request('/_assets/mermaid/mermaid.esm.min.mjs');

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
    });
  });
});
