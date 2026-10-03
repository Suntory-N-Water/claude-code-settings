#!/usr/bin/env -S bun run --silent
import { dirname, isAbsolute, normalize } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import * as v from 'valibot';
import {
  type Annotation,
  commentsPathForHtml,
  HEALTH_SERVICE_NAME,
  isOwnServer,
  OUTPUT_ROOT,
  PREFERRED_PORT,
  readCommentsFile,
  SERVER_STATE_PATH,
  type ServerState,
  updateCommentsFile,
} from './shared.ts';

const AnnotationInputSchema = v.object({
  exact: v.pipe(v.string(), v.minLength(1), v.maxLength(10_000)),
  prefix: v.pipe(v.string(), v.maxLength(200)),
  suffix: v.pipe(v.string(), v.maxLength(200)),
  comment: v.pipe(v.string(), v.minLength(1), v.maxLength(10_000)),
});

const SourceInputSchema = v.object({
  sourcePath: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
});

function resolveDocPath(doc: string): string | undefined {
  if (doc.includes('\0') || !doc.endsWith('.html')) {
    return undefined;
  }
  const normalized = normalize(doc);
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }
  return `${OUTPUT_ROOT}/${normalized}`;
}

export const app = new Hono();

app.get('/api/health', (c) => c.json({ service: HEALTH_SERVICE_NAME, pid: process.pid }));

app.get('/api/comments', async (c) => {
  const commentsPath = commentsPathFromQuery(c.req.query('doc'));
  if (commentsPath === undefined) {
    return c.json({ error: 'doc パラメータが不正です' }, 400);
  }
  return c.json(await readCommentsFile(commentsPath));
});

app.post('/api/comments', async (c) => {
  const commentsPath = commentsPathFromQuery(c.req.query('doc'));
  if (commentsPath === undefined) {
    return c.json({ error: 'doc パラメータが不正です' }, 400);
  }
  const parsed = v.safeParse(AnnotationInputSchema, await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'コメントの形式が不正です' }, 400);
  }
  const annotation: Annotation = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...parsed.output,
  };
  await updateCommentsFile(commentsPath, (comments) => {
    comments.annotations.push(annotation);
  });
  return c.json(annotation, 201);
});

// コメントファイルへの書き込みはすべてこのプロセスに集約する。フックや CLI が
// 自前で read-modify-write すると、その間にブラウザが追加したコメントを消す
app.patch('/api/comments', async (c) => {
  const commentsPath = commentsPathFromQuery(c.req.query('doc'));
  if (commentsPath === undefined) {
    return c.json({ error: 'doc パラメータが不正です' }, 400);
  }
  const id = c.req.query('id');
  if (id === undefined) {
    return c.json({ error: 'id パラメータがありません' }, 400);
  }
  const target = await updateCommentsFile(commentsPath, (comments) => {
    const found = comments.annotations.find((a) => a.id === id);
    if (found !== undefined) {
      found.resolved = true;
    }
    return found;
  });
  if (target === undefined) {
    return c.json({ error: '指定されたコメントが存在しません' }, 404);
  }
  return c.json({ ok: true, comment: target.comment });
});

app.put('/api/source', async (c) => {
  const commentsPath = commentsPathFromQuery(c.req.query('doc'));
  if (commentsPath === undefined) {
    return c.json({ error: 'doc パラメータが不正です' }, 400);
  }
  const parsed = v.safeParse(SourceInputSchema, await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'sourcePath の形式が不正です' }, 400);
  }
  await updateCommentsFile(commentsPath, (comments) => {
    comments.sourcePath = parsed.output.sourcePath;
  });
  return c.json({ ok: true });
});

app.delete('/api/comments', async (c) => {
  const commentsPath = commentsPathFromQuery(c.req.query('doc'));
  if (commentsPath === undefined) {
    return c.json({ error: 'doc パラメータが不正です' }, 400);
  }
  const id = c.req.query('id');
  if (id === undefined) {
    return c.json({ error: 'id パラメータがありません' }, 400);
  }
  const removed = await updateCommentsFile(commentsPath, (comments) => {
    const remaining = comments.annotations.filter((a) => a.id !== id);
    const found = remaining.length !== comments.annotations.length;
    comments.annotations = remaining;
    return found;
  });
  if (!removed) {
    return c.json({ error: '指定されたコメントが存在しません' }, 404);
  }
  return c.json({ ok: true });
});

// mermaid は数 MB あり HTML への埋め込みに向かないため、node_modules から配信する。
// エントリは図の種類ごとの chunk を相対パスで読むので dist ごと公開する
const MERMAID_ASSET_PREFIX = '/_assets/mermaid';
const MERMAID_DIST_DIR = dirname(
  Bun.resolveSync('mermaid/dist/mermaid.esm.min.mjs', import.meta.dir),
);

app.use(
  `${MERMAID_ASSET_PREFIX}/*`,
  serveStatic({
    root: MERMAID_DIST_DIR,
    rewriteRequestPath: (path) => path.slice(MERMAID_ASSET_PREFIX.length),
  }),
);

function commentsPathFromQuery(doc: string | undefined): string | undefined {
  if (doc === undefined) {
    return undefined;
  }
  const htmlPath = resolveDocPath(doc);
  return htmlPath === undefined ? undefined : commentsPathForHtml(htmlPath);
}

// 状態ファイル(.server.json)などの隠しファイルは配信しない
app.use('*', async (c, next) => {
  const segments = decodeURIComponent(c.req.path).split('/');
  if (segments.some((segment) => segment.startsWith('.'))) {
    return c.notFound();
  }
  await next();
});
app.use('*', serveStatic({ root: OUTPUT_ROOT }));

async function main(): Promise<void> {
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: PREFERRED_PORT,
      fetch: app.fetch,
    });
  } catch {
    // 既定ポートが自分と同種のサーバなら二重起動しない。
    // 他プロセスが占有している場合のみ空きポートへ退避する
    if (await isOwnServer(PREFERRED_PORT)) {
      return;
    }
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
  }
  const state: ServerState = {
    port: server.port ?? PREFERRED_PORT,
    pid: process.pid,
  };
  await Bun.write(SERVER_STATE_PATH, JSON.stringify(state));
}

if (import.meta.main) {
  await main();
}
