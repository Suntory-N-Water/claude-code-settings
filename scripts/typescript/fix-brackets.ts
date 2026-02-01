#!/usr/bin/env -S bun run --silent
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineHook } from 'cc-hooks-ts';

/**
 * 全角かっこ「（）」を半角かっこ「()」に変換するStopフック
 */
const fixBracketsHook = defineHook({
  trigger: {
    Stop: true,
  },
  run: async (context) => {
    try {
      // git diffで変更されたファイルのリストを取得
      const proc = Bun.spawn(['git', 'diff', '--name-only', '--cached'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        // git diffが失敗した場合はスキップ
        return context.success();
      }

      const files = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (files.length === 0) {
        return context.success({
          messageForUser: '変更されたファイルがありません',
        });
      }

      let fixedCount = 0;

      for (const file of files) {
        const filePath = join(process.cwd(), file);

        // ファイルが存在しない場合はスキップ
        if (!existsSync(filePath)) {
          continue;
        }

        try {
          // ファイルを読み込み
          const bunFile = Bun.file(filePath);
          const content = await bunFile.text();

          // 全角かっこを半角かっこに変換
          const fixedContent = content
            .replace(/\uff08/g, '(') // 全角左かっこ → 半角左かっこ
            .replace(/\uff09/g, ')'); // 全角右かっこ → 半角右かっこ

          // 変更があった場合のみ書き込み
          if (content !== fixedContent) {
            await Bun.write(filePath, fixedContent);
            fixedCount++;
          }
        } catch {
          // ファイルの読み書きに失敗した場合は無視
        }
      }

      if (fixedCount > 0) {
        return context.success();
      }

      return context.success();
    } catch (error) {
      console.error(`全角かっこ変換時にエラー発生: ${error}`);
      return context.success();
    }
  },
});

if (import.meta.main) {
  const { runHook } = await import('cc-hooks-ts');
  await runHook(fixBracketsHook);
}
