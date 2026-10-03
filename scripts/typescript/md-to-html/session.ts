import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { OUTPUT_ROOT } from './shared.ts';

const SESSION_DIR = join(OUTPUT_ROOT, '.sessions');
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// session_id はそのままファイル名にせず、パス区切りを含む値でディレクトリを
// 抜けられないようにする
function sessionFilePath(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return join(SESSION_DIR, `${safe}.json`);
}

// 一度全文を提示したコメントは同じセッションでは繰り返さない。記録が読めない
// ときは空集合を返す。再掲は無駄で済むが、取りこぼしは指摘が届かなくなる
export async function readInjectedIds(sessionId: string): Promise<Set<string>> {
  try {
    const file = Bun.file(sessionFilePath(sessionId));
    if (!(await file.exists())) {
      return new Set();
    }
    const data = (await file.json()) as { injectedIds?: unknown };
    return new Set(
      Array.isArray(data.injectedIds)
        ? data.injectedIds.filter((id): id is string => typeof id === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

export async function recordInjectedIds(sessionId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const known = await readInjectedIds(sessionId);
  for (const id of ids) {
    known.add(id);
  }
  await Bun.write(sessionFilePath(sessionId), JSON.stringify({ injectedIds: [...known] }, null, 2));
}

export async function pruneOldSessions(): Promise<void> {
  try {
    const names = await readdir(SESSION_DIR);
    const threshold = Date.now() - RETENTION_MS;
    for (const name of names) {
      const path = join(SESSION_DIR, name);
      const info = await stat(path);
      if (info.mtimeMs < threshold) {
        await unlink(path);
      }
    }
  } catch {
    // 掃除に失敗しても注入の動作には影響しない
  }
}
