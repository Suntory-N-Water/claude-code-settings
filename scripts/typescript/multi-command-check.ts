#!/usr/bin/env -S bun run --silent
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { $ } from 'bun';
import { defineHook, runHook } from 'cc-hooks-ts';
import { join } from 'pathe';
import { hasTypeScriptEdits } from './utils';

const LOG_DIR = join(homedir(), '.claude', 'multi-command-check-log');

/**
 * コマンド実行結果を表す型
 */
type CommandResult = {
  /** コマンド名 */
  command: string;
  /** プロセス終了コード (0: 成功, その他: エラー) */
  code: number;
  /** 標準出力の内容 */
  stdout: string;
  /** 標準エラー出力の内容 */
  stderr: string;
};

/**
 * コマンドライン引数から -c オプションの値を取得する
 * @returns カンマ区切りのコマンド文字列、または undefined
 */
function getCommandsFromArgs(): string | undefined {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      c: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  return values.c;
}

/**
 * カンマ区切りの文字列をコマンド配列に変換する
 * @param commandsStr - カンマ区切りのコマンド文字列
 * @returns トリムされたコマンド配列
 */
function parseCommands(commandsStr: string): string[] {
  return commandsStr
    .split(',')
    .map((cmd) => cmd.trim())
    .filter((cmd) => {
      if (cmd.length === 0) {
        return false;
      }
      // 危険な文字を含むコマンドを拒否
      if (/[\s;|&$`<>()]/.test(cmd)) {
        return false;
      }
      return true;
    });
}

/**
 * 指定されたコマンドを実行する
 * @param command - 実行するコマンド名
 * @param cwd - 実行ディレクトリ
 * @returns コマンド実行結果
 */
async function runCommand(
  command: string,
  cwd: string,
): Promise<CommandResult> {
  const proc = await $`bun run ${command}`.cwd(cwd).nothrow().quiet();

  return {
    command,
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/**
 * 複数のコマンドを順次実行する
 * @param commands - 実行するコマンド配列
 * @param cwd - 実行ディレクトリ
 * @returns 全コマンドの実行結果
 */
async function runCommands(
  commands: string[],
  cwd: string,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];

  for (const command of commands) {
    const result = await runCommand(command, cwd);
    results.push(result);
  }

  return results;
}

function commandOutput(result: CommandResult): string {
  const outputs = [result.stdout, result.stderr].filter(Boolean);
  return outputs.length > 0 ? outputs.join('\n') : 'No output captured';
}

function writeFailureLog(
  failures: CommandResult[],
  sessionId: string,
): string | undefined {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const logPath = join(LOG_DIR, `${sessionId}.log`);
    const body = failures
      .map(
        (f) =>
          `=== bun run ${f.command} (exit ${f.code}) ===\n${commandOutput(f)}`,
      )
      .join('\n\n');
    writeFileSync(logPath, `${new Date().toISOString()}\n\n${body}\n`, 'utf-8');
    return logPath;
  } catch (error) {
    process.stderr.write(
      `[multi-command-check] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return undefined;
  }
}

function formatErrorMessage(
  failures: CommandResult[],
  sessionId: string,
): string {
  const header =
    '\x1b[31mSome commands failed. Fix the following errors:\x1b[0m';
  const list = failures
    .map((f) => `- bun run ${f.command} (exit ${f.code})`)
    .join('\n');

  const logPath = writeFailureLog(failures, sessionId);
  if (logPath === undefined) {
    const MAX_OUTPUT_LENGTH = 500;
    const fallback = failures
      .map((f) => {
        const raw = commandOutput(f);
        const output =
          raw.length > MAX_OUTPUT_LENGTH
            ? `${raw.slice(0, MAX_OUTPUT_LENGTH)}\n... (truncated, ${raw.length - MAX_OUTPUT_LENGTH} more chars)`
            : raw;
        return `\x1b[31m❌ bun run ${f.command}\x1b[0m\n${output}`;
      })
      .join('\n\n');
    return `${header}\n\n${fallback}`;
  }

  return [
    header,
    list,
    '',
    `結果を ${logPath} に出力しました。まず先頭 50 行ほど読み、足りなければ該当箇所を grep して必要な範囲だけを確認してください。`,
  ].join('\n');
}

/**
 * コマンド実行結果から成功メッセージを生成する
 * @param results - コマンド実行結果配列
 * @returns 成功メッセージ
 */
function formatSuccessMessage(results: CommandResult[]): string {
  const commandList = results.map((r) => r.command).join(', ');
  return `All commands passed: ${commandList}`;
}

export const multiCommandCheckHook = defineHook({
  trigger: {
    Stop: true,
  },

  run: async (c) => {
    // すでにHookで継続中なら実行しない
    if (c.input.stop_hook_active) {
      return c.success();
    }
    // コマンド引数から -c オプションを取得
    const commandsStr = getCommandsFromArgs();

    // 設定されていない場合は誤爆防止で success を返す
    if (!commandsStr) {
      return c.success();
    }

    const transcriptPath = c.input.transcript_path;
    const cwd = c.input.cwd;

    // TypeScript ファイルの編集がなかった場合はスキップ
    const hasEdits = hasTypeScriptEdits(transcriptPath);

    if (!hasEdits) {
      return c.success();
    }

    // コマンドをパースして実行
    const commands = parseCommands(commandsStr);

    if (commands.length === 0) {
      return c.success();
    }

    const results = await runCommands(commands, cwd);

    const failures = results.filter((r) => r.code !== 0);

    if (failures.length > 0) {
      return c.blockingError(formatErrorMessage(failures, c.input.session_id));
    }

    // 全て成功
    return c.success({
      messageForUser: formatSuccessMessage(results),
    });
  },
});

if (process.env.NODE_ENV !== 'test') {
  await runHook(multiCommandCheckHook);
}
