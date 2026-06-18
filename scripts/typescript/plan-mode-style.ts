#!/usr/bin/env -S bun run --silent
/**
 * @fileoverview
 *   EnterPlanMode 直後にプラン本文の文体指針を Claude に伝える。
 *
 *   AIが書く文章は形容詞・感嘆・誇張が多く読み物としてノイズになりがち。
 *   生成と編集を分離するつもりで「推敲済みのライター文体」をプランに適用させる。
 */

import { defineHook, runHook } from 'cc-hooks-ts';

const STYLE_GUIDE = [
  'プラン本文を書く際の文体指針:',
  '- 過剰な形容詞・感嘆・誇張表現は全て削除する',
  '- 「〜できます」「〜しましょう」ではなく「〜する」と断定する',
  '- 推敲済みのライター文体で書く。生成と編集を分けるつもりで、書いた後に削る',
  '- 強調記号（絵文字、過剰な太字、感嘆符）を入れない',
  '- 情報量より読みやすさを優先する。同じことを二度書かない',
].join('\n');

const hook = defineHook({
  trigger: {
    PostToolUse: {
      EnterPlanMode: true,
    },
  },

  run: (context) =>
    context.json({
      event: 'PostToolUse',
      output: {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: STYLE_GUIDE,
        },
      },
    }),
});

if (import.meta.main) {
  await runHook(hook);
}
