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
  '- 強調記号(絵文字、過剰な太字、感嘆符)を入れない',
  '- 情報量より読みやすさを優先する。同じことを二度書かない',
  '- 概要から各論へ進める。先に全体像を一文で置き、次に詳細を展開する。要約の再提示はしない',
  '- 次の言い回しは中身を増やさないので使わない: 「重要なのは〜である」「本章では〜を扱う」「まとめると」「正面から扱う」「不可欠」「核心的」「鍵となる」「包括的」「掘り下げる」「言語化する」「触れる」',
  '- 悪い例: 「本節では認証フローを正面から扱う。重要なのは整合性である」',
  '  良い例: 「認証フローを扱う。整合性が崩れる条件を特定する」',
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
