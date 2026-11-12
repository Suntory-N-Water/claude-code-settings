import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// テストから実際の記録先を書き換えずに済ませるため、環境変数で差し替えられるようにする
export const STORE_ROOT =
  process.env.TEXTLINT_CHECK_STORE_ROOT ?? join(homedir(), '.claude', 'textlint-check');

export interface EditRecord {
  filePath: string;
  // Write は全文を書き出すので、残っている指摘はすべて今回の出力に属する。編集前の本文を持たない
  before?: string;
}

function safeSessionId(sessionId: string): string {
  return sessionId.replaceAll('/', '-');
}

function sessionDir(sessionId: string): string {
  return join(STORE_ROOT, safeSessionId(sessionId));
}

export function reportPath(sessionId: string): string {
  return join(STORE_ROOT, `${safeSessionId(sessionId)}-report.md`);
}

// 並列の Edit が同じファイルを同時に記録しても競合しないよう、ファイルごとに別の記録を作る。
// 'wx' で開くので、ターンの中で最初の編集の記録だけが残る
export async function recordFirstEdit(sessionId: string, record: EditRecord): Promise<void> {
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${encodeURIComponent(record.filePath)}.json`);
  try {
    const handle = await open(path, 'wx');
    await handle.writeFile(JSON.stringify(record));
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

export async function readRecords(sessionId: string): Promise<EditRecord[]> {
  const dir = sessionDir(sessionId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const records = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(await Bun.file(join(dir, name)).text()) as EditRecord;
      } catch {
        return undefined;
      }
    }),
  );
  return records.filter((record) => record !== undefined);
}

export async function clearRecords(sessionId: string): Promise<void> {
  await rm(sessionDir(sessionId), { recursive: true, force: true });
}
