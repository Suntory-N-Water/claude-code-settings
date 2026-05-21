#!/usr/bin/env -S bun run --silent
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineHook, runHook } from 'cc-hooks-ts';
import type { TranscriptEntry } from './types/claude-output.js';

// 型定義
type StopWordsRule = {
  keywords: string[];
  message: string;
};

type StopWordsRules = Record<string, StopWordsRule>;

const RULE_FILE_PATH = '~/.claude/scripts/stop_words_rules.json';

/**
 * チルダを含むパス文字列を絶対パスに解決する
 * @param pathString - 解決するパス文字列
 * @returns 絶対パス
 */
function resolvePath(pathString: string): string {
  let resolvedPath = pathString;
  if (pathString.startsWith('~/')) {
    resolvedPath = path.join(os.homedir(), pathString.slice(2));
  }
  return path.resolve(resolvedPath);
}

/**
 * 値が空でない文字列かどうかを判定する型ガード関数
 * @param value - 判定する値
 * @returns 空でない文字列の場合true
 */
function isNonEmptyString(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * JSONLトランスクリプトファイルから最後のアシスタントメッセージを抽出する
 * @param transcriptPath - トランスクリプトファイルのパス
 * @returns 最後のアシスタントメッセージ、見つからない場合は空文字列
 */
function extractLastAssistantMessage(transcriptPath: string): string {
  if (!existsSync(transcriptPath)) {
    return '';
  }

  try {
    const transcriptLines = readFileSync(transcriptPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .reverse();

    for (const line of transcriptLines) {
      try {
        const msg: TranscriptEntry = JSON.parse(line);
        if (
          msg.type === 'assistant' &&
          msg.message &&
          'content' in msg.message &&
          Array.isArray(msg.message.content)
        ) {
          for (const content of msg.message.content) {
            if (
              typeof content === 'object' &&
              content.type === 'text' &&
              isNonEmptyString(content.text)
            ) {
              return content.text;
            }
          }
        }
      } catch {
        // JSONパースエラーを無視して次の行に進む
      }
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * ストップワードルールファイルを読み込んで型安全に解析する
 * @returns 解析されたルール、ファイルが存在しないか不正な場合はnull
 */
function loadStopWordsRules(): StopWordsRules | null {
  const rulesPath = resolvePath(RULE_FILE_PATH);

  if (!existsSync(rulesPath)) {
    return null;
  }

  try {
    const content = readFileSync(rulesPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (typeof parsed === 'object' && parsed !== null) {
      const result: StopWordsRules = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (
          value &&
          typeof value === 'object' &&
          'keywords' in value &&
          'message' in value &&
          Array.isArray(value.keywords) &&
          typeof value.message === 'string'
        ) {
          result[key] = {
            keywords: value.keywords.filter(
              (k): k is string => typeof k === 'string',
            ),
            message: value.message,
          };
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * メッセージに対してストップワードルールをチェックする
 * @param message - チェック対象のメッセージ
 * @param rules - 適用するストップワードルール
 * @returns 違反情報オブジェクト
 */
function checkForStopWords(
  message: string,
  rules: StopWordsRules,
): {
  violated: boolean;
  ruleName?: string;
  keyword?: string;
  ruleMessage?: string;
} {
  for (const [ruleName, rule] of Object.entries(rules)) {
    for (const keyword of rule.keywords) {
      if (typeof keyword === 'string' && message.includes(keyword)) {
        return {
          violated: true,
          ruleName,
          keyword,
          ruleMessage: rule.message || 'ルール違反が検出されました',
        };
      }
    }
  }

  return { violated: false };
}

const stopWordsHook = defineHook({
  trigger: { Stop: true },
  run: async (context) => {
    try {
      const input = context.input;
      const transcriptPath = input.transcript_path;

      if (!isNonEmptyString(transcriptPath)) {
        return context.success();
      }

      const lastAssistantMessage = extractLastAssistantMessage(transcriptPath);
      if (!lastAssistantMessage) {
        return context.success();
      }

      const rules = loadStopWordsRules();
      if (!rules) {
        return context.success();
      }

      const violation = checkForStopWords(lastAssistantMessage, rules);
      if (violation.violated) {
        const contextSnippet = lastAssistantMessage.substring(0, 200);
        const errorMessage = [
          `\x1b[31m❌ エラー: AIの発言に「${violation.keyword}」が含まれています。\x1b[0m`,
          '',
          `\x1b[31mルール: ${violation.ruleName}\x1b[0m`,
          `\x1b[31mメッセージ: ${violation.ruleMessage}\x1b[0m`,
          '',
          '\x1b[31m検出された文脈:\x1b[0m',
          `${contextSnippet}${lastAssistantMessage.length > 200 ? '...' : ''}`,
          '',
          '\x1b[31m作業を中止し、ルールに従って計画を見直してください。\x1b[0m',
        ].join('\n');

        return context.blockingError(errorMessage);
      }

      return context.success();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return context.nonBlockingError(
        `NGワードチェック中にエラーが発生しました: ${errorMessage}`,
      );
    }
  },
});

await runHook(stopWordsHook);
