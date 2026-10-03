import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { createLinter, loadTextlintrc } from 'textlint';

const ROOT = dirname(dirname(import.meta.dir));

const linter = createLinter({
  descriptor: await loadTextlintrc({
    configFilePath: join(ROOT, '.textlintrc.json'),
    node_modulesDir: join(ROOT, 'node_modules'),
  }),
});

async function messages(text: string): Promise<string[]> {
  const result = await linter.lintText(text, join(ROOT, 'ai-words-sample.md'));
  return result.messages.map((message) => message.message);
}

// [例文, 指摘のメッセージに含まれる語]
const hitCases: [string, string][] = [
  ['型定義は不可欠である。', '不可欠'],
  ['原因を掘り下げた。', '掘り下げる'],
  ['原因を深掘りした。', '深掘り'],
  ['手順を言語化する。', '言語化'],
  ['この問題を探求した。', '探求する'],
  ['失敗例に触れた。', '触れる'],
  ['失敗例に言及する。', '言及する'],
  ['この設定において問題が起きる。', 'において'],
  ['速度という側面から見る。', 'という側面から'],
  ['速度の観点から比べる。', 'の観点から'],
  ['これは速いと言えるだろう。', 'と言えるだろう'],
  ['これは速いかもしれません。', 'かもしれない'],
  ['これは非常に速い。', '非常に'],
  ['これは極めて速い。', '極めて'],
  ['まとめると、原因は設定である。', 'まとめると'],
  ['要するに設定の問題である。', '要するに'],
  ['原因は設定に他ならない。', 'に他ならない'],
  ['少し冷静になって考えると、原因は設定である。', '少し冷静になって考えると'],
  ['これは設定の罠である。', '罠'],
  ['そのバッチに地雷が入っていた。', '地雷'],
  ['これは便利なテクである。', 'テク'],
  ['この案はカスである。', 'カス'],
  ['くだらない案である。', 'くだらない'],
  ['同期処理の射影も合わせる。', '射影'],
  ['更新のたびに引き直すくじである。', 'くじ'],
  ['引数を取り違えると別の行を消す。', '取り違える'],
  ['この方式は桁違いに速い。', '桁違い'],
  ['この設定には落し穴がある。', '落し穴'],
  ['この程度くらいであれば手で直せる。', 'くらいであれば'],
  ['この書き方は非推奨とされています。', 'とされている'],
  ['前回は配備を行った。', '前回は'],
  ['前回の記事で説明した。', '前回の記事'],
];

// [例文, 指摘が出てはいけない語]。内蔵辞書の語(穴、経路など)が当たるのは
// この表の対象外なので、語を絞って確かめる
const missCases: [string, string][] = [
  ['庭の穴を深く掘る。', '深掘り'],
  ['これはテクノロジーの話である。', 'テク'],
  ['カスタム設定を使う。', 'カス'],
  ['くじらの回遊経路を記録する。', 'くじ'],
  ['足首をくじいて歩けなくなった。', 'くじ'],
  ['心がくじけそうになる。', 'くじ'],
  ['これは便利なテクニックである。', 'テク'],
  ['最初の段階で落とされている。', 'とされている'],
  ['デプロイは push するとされる。', 'とされている'],
  ['ファイルを 1 つにまとめる。', 'まとめると'],
  ['前回の会議で決めた。', '前回の記事'],
];

describe('ai-words.json の辞書', () => {
  test.each(
    hitCases,
  )('「%s」を書いたとき、「%s」の指摘が出ること', async (text, word) => {
    const found = await messages(text);

    expect(found.some((message) => message.includes(`"${word}"`))).toBe(true);
  });

  test.each(
    missCases,
  )('「%s」のように別の意味で使ったとき、「%s」の指摘が出ないこと', async (text, word) => {
    const found = await messages(text);

    expect(found.filter((message) => message.includes(`"${word}"`))).toEqual(
      [],
    );
  });
});
