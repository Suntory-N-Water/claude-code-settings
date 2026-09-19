#!/usr/bin/env bun
import { dirname, join } from 'node:path';
import type { TextlintResult } from '@textlint/types';
import { defineHook } from 'cc-hooks-ts';

const ROOT = dirname(dirname(import.meta.dir));
const MAX_REPORTED_FINDINGS = 8;
const JAPANESE = /[ぁ-んァ-ヶ一-龠]/u;

type TextlintFinding = Pick<
  TextlintResult['messages'][number],
  'ruleId' | 'message'
>;

type Linter = {
  lintText(text: string, filePath: string): Promise<TextlintResult>;
};

let linterPromise: Promise<Linter> | undefined;

function loadLinter(): Promise<Linter> {
  linterPromise ??= (async () => {
    const { createLinter, loadTextlintrc } = await import('textlint');
    const descriptor = await loadTextlintrc({
      configFilePath: join(ROOT, '.textlintrc.json'),
      node_modulesDir: join(ROOT, 'node_modules'),
    });
    return createLinter({ descriptor });
  })();
  return linterPromise;
}

export function formatReport(findings: readonly TextlintFinding[]): string {
  // 同じ語が何度も出ると報告が埋まる。件数だけ添えて 1 行にまとめる
  const counts = new Map<string, number>();
  for (const { message } of findings) {
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }

  const shown = [...counts.entries()].slice(0, MAX_REPORTED_FINDINGS);
  const lines = shown.map(([message, count]) =>
    count > 1 ? `- ${message} (${count} 箇所)` : `- ${message}`,
  );
  const omitted = counts.size - shown.length;
  if (omitted > 0) {
    lines.push(`- ほか ${omitted} 件`);
  }

  return [
    // 直前の返答を書き直させると同じ内容が二度出て文脈を圧迫する。以降の言い換えだけを求める
    'textlint が直前の返答に指摘を検出しました。直前の返答はそのままにして、これ以降の返答で言い換えてください。',
    ...lines,
  ].join('\n');
}

const hook = defineHook({
  trigger: {
    Stop: true,
  },

  run: async (context) => {
    // 一度差し戻しても止め続けるとターンが終わらない。差し戻しは 1 ターンに一度だけ
    if (context.input.stop_hook_active) {
      return context.success();
    }

    const text = context.input.last_assistant_message ?? '';
    // textlint と辞書のロードに約 150ms かかる。日本語を含む返答のときだけ払う
    if (!JAPANESE.test(text)) {
      return context.success();
    }

    try {
      const linter = await loadLinter();
      // 返答は Markdown として表示される。拡張子で Markdown プロセッサに寄せると
      // コードブロックとインラインコードが検査対象から外れる
      const { messages } = await linter.lintText(
        text,
        join(ROOT, 'assistant-message.md'),
      );
      if (messages.length === 0) {
        return context.success();
      }

      return context.json({
        event: 'Stop',
        output: {
          decision: 'block',
          reason: formatReport(messages),
        },
      });
    } catch (error) {
      // 検査の失敗でターンの終了を妨げない
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[textlint-stop] ${detail}\n`);
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(hook);
}
