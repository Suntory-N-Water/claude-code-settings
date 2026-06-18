#!/usr/bin/env -S bun run --silent
/**
 * @fileoverview
 *   $CLAUDE_PROJECT_DIR/.claude/plans/ 配下の Markdown 原本の H1 見出しから、
 *   $CLAUDE_PROJECT_DIR/.claude/plan-links/ に読みやすい名前の相対シンボリックリンクを生成する。
 *
 *   発火タイミング: PostToolUse(Write|Edit)
 *   原本(plans/)は移動・改名・改変しない。エラー時も原本更新は阻害しない。
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { defineHook, runHook } from 'cc-hooks-ts';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';

const PLANS_SUBDIR = join('.claude', 'plans');
const LINKS_SUBDIR = join('.claude', 'plan-links');

/** child が parent 配下にあるか判定する */
function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  if (!relativePath) {
    return false;
  }
  if (relativePath.startsWith('..')) {
    return false;
  }
  if (relativePath.split(sep).includes('..')) {
    return false;
  }
  return true;
}

/**
 * Markdown を AST にパースし、最初の H1 (depth=1) 見出しのテキストを返す。
 * ATX style (`# heading`) と Setext style (`heading\n===`) の両方に対応する。
 * コードブロック内の `#` 始まり行は AST 上 heading にならないため自然に除外される。
 */
function extractH1(content: string): string | undefined {
  const tree = fromMarkdown(content);
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) {
      const text = mdastToString(node).trim();
      return text || undefined;
    }
  }
  return undefined;
}

/**
 * 見出しテキストをファイル名として安全な文字列に変換する。
 * 多くのファイルシステムで禁止される文字 (/ \ : * ? " < > |) と、
 * 連続する空白・ハイフンをハイフン一つに正規化する。
 * 日本語・絵文字・その他 Unicode はそのまま残す。
 */
function sanitize(heading: string): string {
  let normalized = heading.trim();
  normalized = normalized.replace(/[/\\:*?"<>|]/g, '-');
  normalized = normalized.replace(/[\s-]+/g, '-');
  normalized = normalized.replace(/^-+|-+$/g, '');
  return normalized;
}

function todayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromLinkName(name: string): string | undefined {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})_/);
  return match?.[1];
}

type LinkInfo = {
  name: string;
  fullPath: string;
  /** リンクが指す絶対パス */
  targetAbs: string;
};

function listSymlinks(linksDir: string): LinkInfo[] {
  if (!existsSync(linksDir)) {
    return [];
  }
  const symlinks: LinkInfo[] = [];
  for (const name of readdirSync(linksDir)) {
    const fullPath = join(linksDir, name);
    try {
      const stat = lstatSync(fullPath);
      if (!stat.isSymbolicLink()) {
        continue;
      }
      const target = readlinkSync(fullPath);
      symlinks.push({
        name,
        fullPath,
        targetAbs: resolve(linksDir, target),
      });
    } catch {
      // 読み取れないものはスキップ
    }
  }
  return symlinks;
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function uniqueLinkName(desiredName: string, linksDir: string): string {
  if (!existsSync(join(linksDir, desiredName))) {
    return desiredName;
  }
  const ext = '.md';
  const stem = desiredName.endsWith(ext)
    ? desiredName.slice(0, -ext.length)
    : desiredName;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${stem}_${suffix}${ext}`;
    if (!existsSync(join(linksDir, candidate))) {
      return candidate;
    }
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // 削除失敗は無視 (ベストエフォート)
  }
}

const hook = defineHook({
  trigger: {
    PostToolUse: {
      Write: true,
      Edit: true,
    },
  },

  run: (context) => {
    try {
      const projectDir = process.env.CLAUDE_PROJECT_DIR;
      if (!projectDir) {
        return context.success();
      }

      const filePath = (context.input.tool_input as { file_path?: string })
        .file_path;
      if (!filePath) {
        return context.success();
      }

      const absPath = resolve(filePath);
      const plansDir = resolve(projectDir, PLANS_SUBDIR);
      if (!isWithin(plansDir, absPath)) {
        return context.success();
      }
      if (extname(absPath) !== '.md') {
        return context.success();
      }

      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(absPath);
      } catch {
        return context.success();
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return context.success();
      }

      const content = readFileSync(absPath, 'utf-8');
      const heading = extractH1(content);
      if (!heading) {
        return context.success();
      }

      const safeHeading = sanitize(heading);
      if (!safeHeading) {
        return context.success();
      }

      const linksDir = resolve(projectDir, LINKS_SUBDIR);
      if (!existsSync(linksDir)) {
        mkdirSync(linksDir, { recursive: true });
      }

      const sourceReal = safeRealpath(absPath);
      const allLinks = listSymlinks(linksDir);
      const sameSourceLinks = allLinks.filter(
        (link) => safeRealpath(link.targetAbs) === sourceReal,
      );

      // 既に同じ原本を指すリンクがある場合は、見出しが変わっても
      // 当初リンクを作成した日付を維持して名前だけ更新する。
      let date = todayString();
      const firstExistingLink = sameSourceLinks[0];
      if (firstExistingLink) {
        const existingDate = dateFromLinkName(firstExistingLink.name);
        if (existingDate) {
          date = existingDate;
        }
      }

      const desiredName = `${date}_${safeHeading}.md`;
      const desiredPath = join(linksDir, desiredName);
      const linkTarget = join('..', 'plans', basename(absPath));

      // 冪等性: 期待する名前のリンクが既に存在し、同じ原本を指していれば何もしない
      const alreadyCorrect = sameSourceLinks.find(
        (link) => link.fullPath === desiredPath,
      );
      if (alreadyCorrect) {
        // 過去の見出しで生成された別名リンクが残っていれば一緒に掃除する
        for (const link of sameSourceLinks) {
          if (link.fullPath !== desiredPath) {
            tryUnlink(link.fullPath);
          }
        }
        return context.success();
      }

      // 見出し変更などで残った同一原本を指す古い名前のリンクを削除する
      for (const link of sameSourceLinks) {
        tryUnlink(link.fullPath);
      }

      // 同じ日付・同じ見出しの別原本が既にあった場合は末尾連番で衝突回避する
      const finalName = uniqueLinkName(desiredName, linksDir);
      const finalPath = join(linksDir, finalName);
      symlinkSync(linkTarget, finalPath);

      return context.success();
    } catch (err) {
      process.stderr.write(
        `[create-plan-link] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success();
    }
  },
});

if (import.meta.main) {
  await runHook(hook);
}
