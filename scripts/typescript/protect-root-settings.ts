#!/usr/bin/env -S bun run --silent
import { defineHook, runHook } from 'cc-hooks-ts';
import { isAbsolute, join, resolve } from 'pathe';

// リポジトリ直下の settings.json には OTEL の Bearer トークンなど環境固有の秘密が入るため、
// git の履歴へ載せない。deny ルールは前方一致でコマンドの中身を見ないので、
// `git add .` や `git commit -a` のような間接的な経路はここで塞ぐ。
const PROTECTED_PATH = 'settings.json';
// pathspec magic の :/ でリポジトリ直下に固定する (cwd がサブディレクトリでも、
// また .claude/settings.json を巻き込まないため)
const PROTECTED_PATHSPEC = ':/settings.json';
const BULK_ADD_ARGS = new Set(['.', '-A', '--all', '-u', '--update', ':/', '*']);

function segments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map((s) => s.trim());
}

function tokens(segment: string): string[] {
  return segment.split(/\s+/).filter((t) => t.length > 0);
}

function isGitSubcommand(args: string[], subcommand: string): boolean {
  if (args[0] !== 'git') {
    return false;
  }
  // `git -C dir add` のようにグローバルオプションが挟まる形も拾う
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg.startsWith('-')) {
      continue;
    }
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(args[i - 1] ?? '')) {
      continue;
    }
    return arg === subcommand;
  }
  return false;
}

// トークンを cwd 基準で解決し、リポジトリ直下の settings.json と一致するかを見る。
// 文字列末尾での判定だと .claude/settings.json まで巻き込むため、絶対パスで比べる。
function pointsAtProtected(token: string, cwd: string, repoRoot: string): boolean {
  if (token.startsWith('-')) {
    return false;
  }
  const raw = token.replace(/^['"]|['"]$/g, '');
  const absolute = isAbsolute(raw) ? raw : resolve(cwd, raw);
  return absolute === join(repoRoot, PROTECTED_PATH);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

async function isProtectedDirty(cwd: string): Promise<boolean> {
  const out = await git(cwd, ['status', '--porcelain', '--', PROTECTED_PATHSPEC]);
  return out.trim().length > 0;
}

async function isProtectedStaged(cwd: string): Promise<boolean> {
  const out = await git(cwd, ['diff', '--cached', '--name-only', '--', PROTECTED_PATHSPEC]);
  return out.trim().length > 0;
}

async function isProtectedUnpushed(cwd: string): Promise<boolean> {
  const out = await git(cwd, ['diff', '--name-only', '@{u}..HEAD', '--', PROTECTED_PATHSPEC]);
  return out.trim().length > 0;
}

async function denyReason(command: string, cwd: string): Promise<string | undefined> {
  const repoRoot = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  if (!repoRoot) {
    return undefined;
  }

  for (const segment of segments(command)) {
    const args = tokens(segment);

    if (isGitSubcommand(args, 'add')) {
      if (args.some((a) => pointsAtProtected(a, cwd, repoRoot))) {
        return `${PROTECTED_PATH} を直接 add しようとしています`;
      }
      if (args.some((a) => BULK_ADD_ARGS.has(a)) && (await isProtectedDirty(cwd))) {
        return `一括 add で ${PROTECTED_PATH} が巻き込まれます。パスを明示して add してください`;
      }
    }

    if (isGitSubcommand(args, 'commit')) {
      const commitsAll = args.some(
        (a) => a === '-a' || a === '--all' || /^-[a-z]*a[a-z]*$/.test(a),
      );
      if (commitsAll && (await isProtectedDirty(cwd))) {
        return `commit -a で ${PROTECTED_PATH} が巻き込まれます`;
      }
      if (await isProtectedStaged(cwd)) {
        return `${PROTECTED_PATH} が staged です。git restore --staged ${PROTECTED_PATH} で外してください`;
      }
    }

    if (isGitSubcommand(args, 'push') && (await isProtectedUnpushed(cwd))) {
      return `未 push のコミットに ${PROTECTED_PATH} の変更が含まれています`;
    }
  }
  return undefined;
}

const hook = defineHook({
  trigger: {
    PreToolUse: {
      Bash: true,
    },
  },

  run: async (context) => {
    const { command } = context.input.tool_input;
    if (typeof command !== 'string' || !command.includes('git')) {
      return context.success();
    }

    let reason: string | undefined;
    try {
      reason = await denyReason(command, context.input.cwd);
    } catch {
      // git リポジトリ外での実行が大半なので通す。保護対象のリポジトリ内では
      // git コマンドが失敗しないため、ここへは来ない
      return context.success();
    }

    if (reason === undefined) {
      return context.success();
    }

    return context.json({
      event: 'PreToolUse',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `${reason}。${PROTECTED_PATH} は環境固有の秘密を含むため git 管理しません。`,
        },
      },
    });
  },
});

if (import.meta.main) {
  await runHook(hook);
}
