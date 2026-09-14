import { describe, expect, test } from 'bun:test';
import { runStyleCheck, severeViolations } from './check.ts';
import { type Violation, type WordRuleId, wordRules } from './rules.ts';

function check(source: string, writtenText?: string): Promise<Violation[]> {
  return runStyleCheck({ source, writtenText });
}

function ofRule(violations: Violation[], ruleId: string): Violation[] {
  return violations.filter((violation) => violation.ruleId === ruleId);
}

const wordRuleIds: Set<string> = new Set(wordRules.map((rule) => rule.id));

function wordViolations(violations: Violation[]): Violation[] {
  return violations.filter((violation) => wordRuleIds.has(violation.ruleId));
}

// 語ルールと 1 対 1 で対応させる。例文の無いルールを足すと型検査が落ちる
const hitCases = {
  'empty-adjective-emphasis': ['型定義は核心的である。', '核心的'],
  'empty-adjective-weak': ['型定義は不可欠である。', '不可欠'],
  'empty-adjective-coverage': ['多角的な検討を行う。', '多角的'],
  'front-facing': ['この前提を正面から回収する。', '正面から回収する'],
  // dash: ['設計—実装の順で進める。', '—'],
  kikimasu: ['この設定が効きます。', '効き'],
  preview: ['本章では設計を扱う。', '本章では'],
  summary: ['まとめると、原因は設定である。', 'まとめると'],
  explore: ['この問題を探求する。', '探求する'],
  'empty-verb-dig': ['原因を掘り下げる。', '掘り下げる'],
  'empty-verb-touch': ['失敗例に触れる。', '触れる'],
  'connective-frame': ['この設定において問題が起きる。', 'において'],
  'connective-additive': ['また、実行時間を測った。', 'また、'],
  'weak-hedge': ['これは速いと言えるだろう。', 'と言えるだろう'],
  'empty-emphasis': ['これは非常に速い。', '非常に'],
  'jargon-trap': ['これは設定の罠である。', '罠'],
  'jargon-technique': ['これは便利なテクである。', 'テク'],
  dismissive: ['この案はカスである。', 'カス'],
  'calm-down': [
    '少し冷静になって考えると、原因は設定である。',
    '少し冷静になって考えると',
  ],
  'jargon-projection': ['同期処理の射影も合わせる。', '射影'],
  'jargon-window': ['設定が食い違う窓が生まれる。', '窓'],
  'jargon-skip': ['この手順を飛ばすと表示が壊れる。', '飛ばす'],
  'jargon-lottery': ['更新のたびに引き直すくじなので、いずれ引く。', 'くじ'],
  'jargon-burn': ['ループ1回で240秒を焼く。', '焼く'],
  'jargon-authority': ['設定の正本はこのファイルである。', '正本'],
  'jargon-contract': ['この関数の契約を決める。', '契約'],
  'jargon-promise': ['この API は順序を約束する。', '約束'],
  'jargon-wire': ['ハンドラを配線する。', '配線'],
  'jargon-surface': ['この公開面を小さく保つ。', '公開面'],
  'jargon-role': ['このプロセスが中継役になる。', '役'],
  'jargon-run': ['テストを回す。', 'を回す'],
  'jargon-skeleton': ['記事の骨を先に決める。', '骨'],
  'jargon-noop': ['この分岐は no-op である。', 'no-op'],
  'jargon-spec': ['まず spec を確認する。', 'spec'],
  'jargon-ack': ['ack してから破棄する。', 'ack'],
  'jargon-fold': ['このテストファイルを畳む。', '畳む'],
  'jargon-lick': ['DOM を 1 回舐めるだけである。', '舐める'],
  'jargon-stock': ['初期在庫は 75 件になる。', '在庫'],
  'ai-texture': ['この設計には手触りがある。', '手触り'],
  'ai-grandiose': ['そこには残酷な真理がある。', '真理'],
  'translationese-verb': ['この結果は限界を示唆する。', '示唆'],
  'translationese-frame': [
    'この方式は速度という点で優れている。',
    'という点で',
  ],
  'katakana-jargon': ['既存の資産にレバレッジをかける。', 'レバレッジ'],
  'cliche-closing': ['いかがでしたか。', 'いかがでした'],
  'structure-preview': ['3 つの観点から説明する。', 'つの観点から'],
  'conclusion-dodge': [
    'この判断はケースバイケースである。',
    'ケースバイケース',
  ],
  'weak-negation': ['この書き方はあまり推奨されない。', 'あまり推奨され'],
  'disclaimer-ritual': ['これはあくまで一例である。', 'あくまで一例'],
  'academic-self': ['本稿では設定を扱う。', '本稿'],
  'invisible-char': ['設定を\u200B読み込む。', '\u200B'],
  'check-cross-mark': ['❌ 古い書き方を使う。', '❌'],
  'jargon-draw': ['全レシピから1件だけ引きます。', '1件だけ引き'],
  'jargon-pitfall': ['この設定には落とし穴がある。', '落とし穴'],
  'jargon-block-off': ['これで両方の不具合を塞ぐ。', '塞ぐ'],
  'jargon-hit': ['Bash からコマンドを叩くしかない。', '叩く'],
  'jargon-pass-through': ['この検査を素通りして保存される。', '素通り'],
  'jargon-magnitude': ['この方式は桁違いに速い。', '桁違い'],
  'jargon-mixup': ['引数を取り違えると別の行を消す。', '取り違え'],
  'jargon-standard-move': ['ここは index を張るのが定石である。', '定石'],
  'jargon-composition': [
    '呼び出し元が握りつぶすという構図になる。',
    'という構図',
  ],
  'jargon-tool': ['差分を確かめるための道具である。', 'ための道具'],
  'jargon-entrance': ['この関数が処理の入口として置かれている。', '入口として'],
  'jargon-silently': ['設定が合わないと静かに壊れる。', '静かに壊れ'],
  'jargon-accident': ['本番データを消す事故が起きる。', '事故'],
  'jargon-collapse': ['件数が増えるとこの前提が破綻する。', '破綻'],
  'jargon-tilt': ['迷ったら再試行しない側に倒す。', '側に倒す'],
  'jargon-let-escape': ['例外を上位へ逃がす。', '逃がす'],
  'jargon-crush': ['残った不具合を 1 件ずつ潰す。', '潰す'],
  'jargon-boundary': ['ここが責務の境界になる。', 'の境界'],
} as const satisfies Record<WordRuleId, readonly [string, string]>;

const hitRows: [string, string, string][] = Object.entries(hitCases).map(
  ([ruleId, [sentence, matched]]) => [ruleId, sentence, matched],
);

const missCases: [WordRuleId, string][] = [
  ['front-facing', '正面から取り組む。'],
  // ['dash', '設計-実装の順で進める。'],
  ['kikimasu', '設定を変えた効果が出ている。'],
  ['kikimasu', '実行の効率を測る。'],
  ['kikimasu', 'この項目を有効化する。'],
  ['kikimasu', 'キャッシュを無効にする。'],
  ['kikimasu', '改正法が発効する。'],
  ['kikimasu', '時効が成立した。'],
  ['kikimasu', '実効性のある対策を選ぶ。'],
  ['preview', 'ここでは設定を確認する。'],
  ['connective-additive', 'また会う日まで待つ。'],
  ['connective-additive', 'これはまた、別の話である。'],
  ['jargon-technique', 'これは便利なテクニックである。'],
  ['dismissive', 'カスタム設定を使う。'],
  ['jargon-window', '問い合わせ窓口に連絡する。'],
  ['jargon-window', '窓ガラスの寸法を測る。'],
  ['jargon-skip', '鳥が空を飛んでいる。'],
  ['jargon-lottery', 'くじらの回遊経路を記録する。'],
  ['jargon-lottery', '足首をくじいて歩けなくなった。'],
  ['jargon-lottery', '心がくじけそうになる。'],
  ['jargon-burn', 'CD を焼く。'],
  ['jargon-burn', 'ROM に焼く。'],
  ['jargon-burn', '画像を焼く。'],
  ['jargon-burn', '日に焼ける。'],
  ['jargon-burn', '設定をイメージに焼き込む。'],
  ['jargon-burn', 'プロセスに焼き付いた環境変数が残る。'],
  ['jargon-burn', 'キャッシュに型が焼かれる。'],
  ['jargon-contract', '雇用契約を確認する。'],
  ['jargon-contract', '契約書に署名する。'],
  ['jargon-promise', 'お約束の展開である。'],
  ['jargon-promise', '口約束で終わった。'],
  ['jargon-wire', '配線工事を依頼する。'],
  ['jargon-surface', '画面を確認する。'],
  ['jargon-surface', '断面積を計算する。'],
  ['jargon-role', '主役を務める。'],
  ['jargon-role', '役割を決める。'],
  ['jargon-role', 'この資料は役に立つ。'],
  ['jargon-run', '首を回して確認する。'],
  ['jargon-run', '時計の針を回す。'],
  ['jargon-skeleton', '骨折した箇所を確認する。'],
  ['jargon-skeleton', '鉄骨を組む。'],
  ['jargon-ack', 'callback を確認する。'],
  ['jargon-spec', 'spec.ts を確認する。'],
  ['jargon-fold', '折り畳み可能なパネルを置く。'],
  ['jargon-fold', '畳み込みニューラルネットワークを使う。'],
  ['jargon-fold', '赤字が続いたので店を畳む。'],
  ['jargon-fold', '洗い終わった洗濯物を畳む。'],
  ['jargon-fold', '受け取った地図を畳む。'],
  ['jargon-lick', '子どもが飴を舐めている。'],
  ['jargon-stock', '在庫管理システムを更新する。'],
  ['jargon-stock', '部品が在庫切れになった。'],
  ['jargon-draw', 'おみくじを引く。'],
  ['jargon-draw', '辞書を引いて確認する。'],
  ['jargon-draw', '定規で線を引く。'],
  ['jargon-block-off', '耳を塞いで音を遮る。'],
  ['jargon-block-off', '壁の穴を塞ぐ。'],
  ['jargon-block-off', '今は手が塞がっている。'],
  ['jargon-block-off', '腸閉塞の症例を調べる。'],
  ['jargon-hit', '肩を叩いて合図する。'],
  ['jargon-hit', '太鼓を叩く音が聞こえる。'],
  ['jargon-hit', '議論の叩き台を用意する。'],
  ['ai-texture', '一日の総熱量を計算する。'],
  ['ai-grandiose', '結晶化した粒子を観察する。'],
  ['katakana-jargon', 'ピボットテーブルを作る。'],
  ['katakana-jargon', 'ナレッジ共有の場を作る。'],
  ['cliche-closing', '結局のところ書きたい人が書く。'],
  ['translationese-verb', '浮き輪が水面に浮かび上がる。'],
  ['jargon-accident', '交通事故の件数を調べる。'],
  ['jargon-accident', '事故現場を撮影する。'],
  ['jargon-collapse', '財政破綻した自治体を調べる。'],
  ['jargon-tilt', '本棚を手前に倒す。'],
  ['jargon-let-escape', '熱を逃がす穴を開ける。'],
  ['jargon-crush', '待ち時間を潰す。'],
  ['jargon-crush', '面目を潰す結果になった。'],
  ['jargon-boundary', 'テストの境界値を洗い出す。'],
  ['jargon-boundary', '土地の境界線を確かめる。'],
  ['jargon-entrance', '建物の入口で待つ。'],
  ['jargon-tool', '工具箱から道具を取り出す。'],
];

describe('語のルール', () => {
  test.each(
    hitRows,
  )('%s の語を地の文に書いた時、検出されること', async (ruleId, sentence, matched) => {
    const violations = await check(sentence);

    expect(ofRule(violations, ruleId)[0]?.matched).toBe(matched);
  });

  test.each(
    missCases,
  )('%s の除外に当たる語を書いた時、検出されないこと', async (ruleId, sentence) => {
    const violations = await check(sentence);

    expect(ofRule(violations, ruleId)).toEqual([]);
  });

  // 「効きます」だけを見ていた頃は、同じ意味の他の活用形が素通りしていた
  test.each([
    ['この設定が効く。', '効く'],
    ['キャッシュが効いている。', '効いて'],
    ['再起動しても効いた。', '効いた'],
    ['この指定は効かない。', '効かな'],
    ['同じ手が効ける。', '効ける'],
    ['ここで効けば十分である。', '効けば'],
    ['この対策は効き目がある。', '効き'],
  ])('%s のように活用させても kikimasu で検出されること', async (sentence, matched) => {
    const violations = await check(sentence);

    expect(ofRule(violations, 'kikimasu')[0]?.matched).toBe(matched);
  });

  test('罠と同じ扱いの語も同じルールで検出されること', async () => {
    const violations = await check('そのバッチに地雷が入っていた。');

    expect(violations[0]).toMatchObject({
      ruleId: 'jargon-trap',
      matched: '地雷',
    });
  });

  test('コーパス校正で対象から外した語は検出されないこと', async () => {
    const violations = await check('まさにその通りである。');

    expect(wordViolations(violations)).toEqual([]);
  });

  test('禁止語を含まない地の文からは、語の指摘が出ないこと', async () => {
    const source = [
      'この関数は設定ファイルを読み込む。',
      '見つからない場合は既定値を返す。',
    ].join('\n');

    const violations = await check(source);

    expect(wordViolations(violations)).toEqual([]);
  });

  test('指摘に検出語・該当文・書き直し方が揃うこと', async () => {
    const violations = await check('型定義は核心的である。');

    expect(violations[0]).toMatchObject({
      severity: 'severe',
      matched: '核心的',
      sentence: '型定義は核心的である。',
    });
    expect(violations[0]?.good).not.toBe('');
  });

  test('畳むを書いた時、severe として報告されること', async () => {
    const violations = await check('再生成を完了条件に畳んだ。');

    expect(violations[0]).toMatchObject({
      severity: 'severe',
      matched: '畳んだ',
    });
  });

  test('同じ severe が 3 文に当たる時、打ち切らずに全て報告すること', async () => {
    const source = [
      '型定義は核心的である。',
      '設定ファイルは核心的である。',
      '疎通確認は核心的である。',
    ].join('\n\n');

    const violations = await check(source);

    expect(ofRule(violations, 'empty-adjective-emphasis')).toHaveLength(3);
  });

  test('同じ warning が 3 文に当たる時、2 文で打ち切ること', async () => {
    const source = [
      'この処理は非常に速い。',
      'あの処理も非常に軽い。',
      'どの処理も非常に短い。',
    ].join('\n\n');

    const violations = await check(source);

    expect(ofRule(violations, 'empty-emphasis')).toHaveLength(2);
  });
});

describe('検査しない箇所', () => {
  test('コードブロックの中に禁止語があっても検出しないこと', async () => {
    const source = [
      '本文です。',
      '```ts',
      'const label = "核心的";',
      '```',
    ].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'empty-adjective-emphasis')).toEqual([]);
  });

  test('インラインコードで囲んだ禁止語を検出しないこと', async () => {
    const violations = await check('設定の名前は `核心的` と書く。');

    expect(ofRule(violations, 'empty-adjective-emphasis')).toEqual([]);
  });

  test('URL に含まれる記号を検出しないこと', async () => {
    const violations = await check('詳細は https://example.com/a—b にある。');

    expect(ofRule(violations, 'dash')).toEqual([]);
  });

  test('ファイルパスで終わる文を体言止めとしないこと', async () => {
    const violations = await check('保存先は ~/.claude/style-check。');

    expect(ofRule(violations, 'taigendome')).toEqual([]);
  });

  test('フロントマターの中を検出しないこと', async () => {
    const source = ['---', 'title: 核心的な話', '---', '本文です。'].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'empty-adjective-emphasis')).toEqual([]);
  });

  test('HTML コメントの中を検出しないこと', async () => {
    const source = ['<!--', '核心的なメモ', '-->', '本文です。'].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'empty-adjective-emphasis')).toEqual([]);
  });

  test('本文中の水平線より後も検査されること', async () => {
    const source = ['前の文です。', '---', '型定義は核心的である。'].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'empty-adjective-emphasis')).toHaveLength(1);
  });

  test('日本語を含まないファイルは検査しないこと', async () => {
    const source = ['# Setup', '', 'Run the installer — then reboot.'].join(
      '\n',
    );

    const violations = await check(source);

    expect(violations).toEqual([]);
  });
});

describe('書いた範囲での絞り込み', () => {
  const source = ['型定義は核心的である。', '結果を保存する。'].join('\n');

  test('差し替えた断片に無い語は報告しないこと', async () => {
    const violations = await check(source, '結果を保存する。');

    expect(wordViolations(violations)).toEqual([]);
  });

  test('差し替えた断片にある語は報告すること', async () => {
    const violations = await check(source, '型定義は核心的である。');

    expect(ofRule(violations, 'empty-adjective-emphasis')).toHaveLength(1);
  });

  test('文書全体の集計は差し替えた断片で絞り込まないこと', async () => {
    const polite = [
      '設定を検索します。',
      '結果を保存します。',
      '一覧を表示します。',
    ].join('\n');

    const violations = await check(polite, '一覧を表示します。');

    expect(ofRule(violations, 'sentence-ending-repeat')).toHaveLength(1);
  });
});

describe('文末の重複', () => {
  test('敬体の同じ文末が 3 文続いた時、連続した文が示されること', async () => {
    const source = [
      '設定を検索します。',
      '結果を保存します。',
      '一覧を表示します。',
    ].join('\n');

    const violations = await check(source);

    const hit = ofRule(violations, 'sentence-ending-repeat')[0];
    expect(hit?.matched).toContain('3 連続');
    expect(hit?.sentence).toContain('一覧を表示します。');
  });

  test('敬体の同じ文末が 2 文で途切れる時、指摘されないこと', async () => {
    const source = ['設定を検索します。', '結果を保存します。'].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'sentence-ending-repeat')).toEqual([]);
  });

  test('箇条書きの行は文末の連続に数えないこと', async () => {
    const source = [
      '- 設定を検索します。',
      '- 結果を保存します。',
      '- 一覧を表示します。',
    ].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'sentence-ending-repeat')).toEqual([]);
  });

  test('常体の同じ文末が続いても指摘されないこと', async () => {
    const source = [
      '設定を検索する。',
      '結果を保存する。',
      '一覧を表示する。',
    ].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'sentence-ending-repeat')).toEqual([]);
  });
});

describe('敬体と常体の混在', () => {
  test('敬体と常体が混ざる時、少ない方の文が示されること', async () => {
    const source = [
      '設定を検索します。',
      '結果を保存する。',
      '一覧を表示する。',
    ].join('\n');

    const violations = await check(source);

    const hit = ofRule(violations, 'polite-plain-mixed')[0];
    expect(hit?.matched).toContain('敬体 1 文 / 常体 2 文');
    expect(hit?.sentence).toBe('設定を検索します。');
  });

  test('敬体だけの時、指摘されないこと', async () => {
    const source = ['設定を検索します。', '結果を保存しました。'].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'polite-plain-mixed')).toEqual([]);
  });

  test('常体だけの時、指摘されないこと', async () => {
    const source = ['設定を検索する。', '結果を保存した。'].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'polite-plain-mixed')).toEqual([]);
  });

  test('見出し・箇条書き・表・引用の文体は数えないこと', async () => {
    const source = [
      '# 設定を検索します。',
      '- 結果を保存します。',
      '| 一覧を表示します。 |',
      '> 記録を残します。',
      '本文を書く。',
    ].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'polite-plain-mixed')).toEqual([]);
  });
});

describe('対句の多用', () => {
  const line = (index: number) => `${index} 番は A ではなく B を選ぶ。`;

  test('1 ファイルに 3 回出た時、回数と該当文が示されること', async () => {
    const source = [line(1), line(2), line(3)].join('\n');

    const violations = await check(source);

    const hit = ofRule(violations, 'dewanaku-overuse')[0];
    expect(hit?.matched).toContain('3 回');
    expect(hit?.sentence).toContain(line(1));
  });

  test('2 回までは指摘されないこと', async () => {
    const source = [line(1), line(2)].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'dewanaku-overuse')).toEqual([]);
  });

  test('「だけでなく〜も」も同じ対句として数えること', async () => {
    const source = [
      'A だけでなく B も選ぶ。',
      'C だけでなく D も選ぶ。',
      'E だけでなく F も選ぶ。',
    ].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'dewanaku-overuse')[0]?.matched).toContain(
      '3 回',
    );
  });

  test('回数が閾値に達しても、地の文に対する比率が薄い時は指摘されないこと', async () => {
    const filler = Array.from({ length: 148 }, () => '設定を読み込む。');
    const source = [line(1), line(2), line(3), ...filler].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'dewanaku-overuse')).toEqual([]);
  });

  test('1 文に 2 回出た場合も 2 回として数えること', async () => {
    const twice = 'A ではなく B、C ではなく D を選ぶ。';
    const source = [twice, twice].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'dewanaku-overuse')[0]?.matched).toContain(
      '4 回',
    );
  });

  test('見出し・箇条書き・表・引用の「ではなく」は数えないこと', async () => {
    const source = [
      `# ${line(1)}`,
      `- ${line(2)}`,
      `| ${line(3)} |`,
      `> ${line(4)}`,
    ].join('\n');

    const violations = await check(source);

    expect(ofRule(violations, 'dewanaku-overuse')).toEqual([]);
  });
});

describe('体言止め', () => {
  test('地の文が名詞で終わる時、該当文が示されること', async () => {
    const violations = await check('原因はロックの競合。');

    expect(ofRule(violations, 'taigendome')[0]?.sentence).toBe(
      '原因はロックの競合。',
    );
  });

  test('述語で言い切る文は指摘されないこと', async () => {
    const violations = await check('原因はロックが競合したことである。');

    expect(ofRule(violations, 'taigendome')).toEqual([]);
  });

  test('箇条書きの体言止めは指摘されないこと', async () => {
    const violations = await check('- 原因はロックの競合。');

    expect(ofRule(violations, 'taigendome')).toEqual([]);
  });
});

describe('重大度', () => {
  test('重大なルールに当たった文だけが重大として取り出せること', async () => {
    const source = ['型定義は核心的である。', 'これは非常に速い。'].join('\n');

    const severe = severeViolations(await check(source));

    expect(severe.map((violation) => violation.sentence)).toEqual([
      '型定義は核心的である。',
    ]);
  });

  test('文書全体の集計は重大にならないこと', async () => {
    const source = [
      '設定を検索します。',
      '結果を保存します。',
      '一覧を表示します。',
    ].join('\n');

    const severe = severeViolations(await check(source));

    expect(severe).toEqual([]);
  });
});

describe('見出しの形', () => {
  test('見出しが述語で言い切る時、該当見出しが示されること', async () => {
    const violations = await check('# この設計もまた同じ方向を指している');

    const hit = ofRule(violations, 'heading-proposition')[0];
    expect(hit?.sentence).toBe('この設計もまた同じ方向を指している');
    expect(hit?.matched).toContain('1 件');
  });

  test('見出しが疑問で終わる時、該当見出しが示されること', async () => {
    const violations = await check('# なぜこの方式を選んだのか');

    expect(ofRule(violations, 'heading-proposition')[0]?.sentence).toBe(
      'なぜこの方式を選んだのか',
    );
  });

  test('見出しが名詞で終わる時、指摘されないこと', async () => {
    const violations = await check('# フックの設計');

    expect(ofRule(violations, 'heading-proposition')).toEqual([]);
  });

  test('手順を表す見出しが動詞で終わる時、指摘されないこと', async () => {
    const violations = await check('# 依存をインストールする');

    expect(ofRule(violations, 'heading-proposition')).toEqual([]);
  });

  test('地の文が述語で終わっても、見出しの指摘には数えないこと', async () => {
    const violations = await check('この設計は同じ方向を指している。');

    expect(ofRule(violations, 'heading-proposition')).toEqual([]);
  });

  test('見出しの指摘は重大にならないこと', async () => {
    const severe = severeViolations(await check('# この方式が最も速い'));

    expect(severe).toEqual([]);
  });
});
