import { readdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoredEntry {
  filePath: string;
  sentences: string[];
}

export interface WarningEntry {
  filePath: string;
  keys: string[];
}

export interface SessionStore {
  read(sessionId: string): Promise<StoredEntry[]>;
  write(sessionId: string, entries: StoredEntry[]): Promise<void>;
  prune(): Promise<void>;
}

export interface WarningStore {
  read(sessionId: string): Promise<WarningEntry[]>;
  write(sessionId: string, entries: WarningEntry[]): Promise<void>;
}

export interface ReportedStore {
  read(sessionId: string): Promise<string[]>;
  write(sessionId: string, keys: string[]): Promise<void>;
}

const MAX_SENTENCES_PER_FILE = 20;
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface JsonStore<Entry> {
  read(sessionId: string): Promise<Entry[]>;
  write(sessionId: string, entries: Entry[]): Promise<void>;
}

function createJsonStore<Entry>(root: string, suffix: string): JsonStore<Entry> {
  const storePath = (sessionId: string): string =>
    join(root, `${sessionId.replaceAll('/', '-')}${suffix}`);

  return {
    async read(sessionId) {
      const file = Bun.file(storePath(sessionId));
      if (!(await file.exists())) {
        return [];
      }
      try {
        const parsed: unknown = await file.json();
        return Array.isArray(parsed) ? (parsed as Entry[]) : [];
      } catch {
        return [];
      }
    },

    async write(sessionId, entries) {
      await Bun.write(storePath(sessionId), JSON.stringify(entries));
    },
  };
}

export function createSessionStore(root: string): SessionStore {
  return {
    ...createJsonStore<StoredEntry>(root, '.json'),

    async prune() {
      let names: string[];
      try {
        names = await readdir(root);
      } catch {
        return;
      }
      const limit = Date.now() - PRUNE_AFTER_MS;
      await Promise.all(
        names.map(async (name) => {
          const path = join(root, name);
          try {
            if ((await stat(path)).mtimeMs < limit) {
              await unlink(path);
            }
          } catch {
            // 他プロセスが同時に消した場合は放置してよい
          }
        }),
      );
    },
  };
}

export function createWarningStore(root: string): WarningStore {
  return createJsonStore<WarningEntry>(root, '.warnings.json');
}

export function createReportedStore(root: string): ReportedStore {
  return createJsonStore<string>(root, '.conversation.json');
}

// プロセスを起動するテストから保存先を差し替えるために環境変数を見る
export const storeRoot =
  process.env.STYLE_CHECK_STORE_ROOT ?? join(homedir(), '.claude', 'style-check');

export const sessionStore = createSessionStore(storeRoot);
export const warningStore = createWarningStore(storeRoot);
export const reportedStore = createReportedStore(storeRoot);

export function mergeEntry(
  entries: StoredEntry[],
  filePath: string,
  sentences: string[],
): StoredEntry[] {
  const existing = entries.find((entry) => entry.filePath === filePath);
  if (existing === undefined) {
    return [...entries, { filePath, sentences: [...new Set(sentences)] }];
  }
  const merged = [...new Set([...existing.sentences, ...sentences])];
  return entries.map((entry) =>
    entry.filePath === filePath
      ? { filePath, sentences: merged.slice(-MAX_SENTENCES_PER_FILE) }
      : entry,
  );
}

export function replaceKeys(
  entries: WarningEntry[],
  filePath: string,
  keys: string[],
): WarningEntry[] {
  const others = entries.filter((entry) => entry.filePath !== filePath);
  return keys.length === 0 ? others : [...others, { filePath, keys }];
}
