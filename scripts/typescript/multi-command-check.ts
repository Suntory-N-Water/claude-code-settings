#!/usr/bin/env -S bun run --silent
import { parseArgs } from 'node:util';
import { $ } from 'bun';
import { defineHook, runHook } from 'cc-hooks-ts';
import { hasTypeScriptEdits } from './utils';

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

/**
 * コマンド実行結果からエラーメッセージを生成する
 * @param results - コマンド実行結果配列
 * @returns エラーメッセージ、またはエラーがない場合は undefined
 */
function formatErrorMessage(results: CommandResult[]): string | undefined {
  const failures = results.filter((r) => r.code !== 0);

  if (failures.length === 0) {
    return undefined;
  }

  const errorMessages = failures
    .map((f) => {
      // stdout と stderr の両方を含めて 型チェック で stderr に出力がある場合でも
      // 個別の結果を返却させるようにする
      // 元のコード: const output = f.stderr || f.stdout || 'No output captured';
      const outputs = [f.stdout, f.stderr].filter(Boolean);
      const rawOutput =
        outputs.length > 0 ? outputs.join('\n') : 'No output captured';
      const MAX_OUTPUT_LENGTH = 500;
      const output =
        rawOutput.length > MAX_OUTPUT_LENGTH
          ? `${rawOutput.slice(0, MAX_OUTPUT_LENGTH)}\n... (truncated, ${rawOutput.length - MAX_OUTPUT_LENGTH} more chars)`
          : rawOutput;
      return `\x1b[31m❌ Command failed: bun run ${f.command}\x1b[0m\n${output}`;
    })
    .join('\n\n');

  return `\x1b[31mSome commands failed. Fix the following errors:\x1b[0m\n\n${errorMessages}`;
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

    // エラーがあればブロッキングエラーを返す
    const errorMessage = formatErrorMessage(results);

    if (errorMessage) {
      return c.blockingError(errorMessage);
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
