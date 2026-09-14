export type Severity = 'severe' | 'warning';

export interface WordRule {
  readonly id: string;
  readonly category: string;
  readonly severity: Severity;
  readonly pattern: RegExp;
  readonly good: string;
}

export interface DocumentRule {
  readonly category: string;
  readonly severity: Severity;
  readonly threshold: number;
  readonly good: string;
}

export interface TextlintRule {
  readonly category: string;
  readonly severity: Severity;
  readonly good: string;
}

// 語彙と閾値の一部は skill natural-japanese の scripts/lint.py の
// コーパス校正(人間 103 文書 + AI 81 文書)に合わせている。skill は
// skills-lock.json でハッシュ管理されているため、更新したら lint.py の
// FORBIDDEN_PHRASES・FORBIDDEN_PHRASES_WEAK_SIGNAL・ANTITHESIS_* の差分を見る。
// 対応時点のハッシュは 043db25ceb40d2bb1eec4e6c18605f02e2e6938773fb91cbce8381e5c1f447c5

// 照合は 1 文ずつ行い g フラグを付けない。そのため `^` は文の先頭を指す
export const wordRules = [
  {
    id: 'empty-adjective-emphasis',
    category: '空虚な形容',
    severity: 'severe',
    pattern: /核心的?|鍵となる|根本的な/u,
    good: '何が無いと何ができなくなるかを書く。例:「型定義が無いと tool_input の形が決まらない」',
  },
  {
    // 「不可欠」は人間側でも一定数使われる(人間 6〜15 回 vs AI 2 回前後)ため、
    // 同じ空虚な形容でも severe には上げない
    id: 'empty-adjective-weak',
    category: '空虚な形容',
    severity: 'warning',
    pattern: /不可欠/u,
    good: '何が無いと何ができなくなるかを書く。例:「型定義が無いと tool_input の形が決まらない」',
  },
  {
    id: 'empty-adjective-coverage',
    category: '空虚な形容',
    severity: 'severe',
    pattern: /多角的|包括的|総合的/u,
    good: 'どの角度から何をいくつ見たかを書く。例:「実行時間とメモリ使用量の 2 つを測った」',
  },
  {
    id: 'front-facing',
    category: '正面から系',
    severity: 'severe',
    pattern: /正面から(?:扱う|回収する|見る|書く|立てる)/u,
    good: '姿勢の宣言を削り、動作だけ書く。例:「本章では〇〇の理論を扱う」「ここで、この前提を回収する」',
  },
  // {
  //   id: 'dash',
  //   category: '記号',
  //   severity: 'severe',
  //   pattern: /[—―─]/u,
  //   good: '言い換えは句点で二文に分けるか読点でつなぐ。見出しは単一の自然な句にする',
  // },
  {
    id: 'kikimasu',
    category: '比喩の動詞',
    severity: 'severe',
    pattern: /効(?:く|き|い[てた]|かな|け[るば])/u,
    good: '何がどう作用したかをそのまま書く。例:「ヘッダーが適用されています」「キャッシュで 2 回目が速くなる」',
  },
  {
    id: 'preview',
    category: '予告',
    severity: 'warning',
    pattern:
      /重要なのは[^。]{0,60}である|ここでは[^。]{0,60}について見ていく|本章では/u,
    good: '予告を削って主張から書く。例:「評価の中心は、正しさを誰が知っているかにある」',
  },
  {
    id: 'summary',
    category: '総括',
    severity: 'warning',
    pattern: /まとめると|要するに|に他ならない/u,
    good: '直前の言い換えだけなら削る。結論は一度だけ書く',
  },
  {
    id: 'explore',
    category: '予告',
    severity: 'warning',
    pattern: /探求する/u,
    good: '何をするかを書く。例:「〇〇の理論を扱う」',
  },
  {
    id: 'empty-verb-dig',
    category: '空虚な動詞',
    severity: 'warning',
    pattern: /掘り下げる|深掘りする|言語化する/u,
    good: '何をどう書いたかを示す。例:「実測値を 3 種類に分けて数えた」',
  },
  {
    id: 'empty-verb-touch',
    category: '空虚な動詞',
    severity: 'warning',
    pattern: /触れる|言及する/u,
    good: '何をどこまで説明するかを書く。例:「〇〇の失敗例だけを説明する」',
  },
  {
    id: 'connective-frame',
    category: '接続の型',
    severity: 'warning',
    pattern: /において|という側面から|の観点から/u,
    good: '助詞でそのまま書く。例:「この設定では」「実行時間で比べると」',
  },
  {
    id: 'connective-additive',
    category: '接続の型',
    severity: 'warning',
    pattern: /^(?:さらに|また|加えて)[、，]/u,
    good: '前の文との論理関係を示す語にする。例:「そのため」「一方」。関係が無いなら段落を分ける',
  },
  {
    id: 'weak-hedge',
    category: '弱い緩和',
    severity: 'warning',
    pattern: /と言えるだろう|かもしれない/u,
    good: '根拠があるなら断定する。推量・仮定・読者の疑念・作中人物の認識を表すときは残してよい',
  },
  {
    id: 'empty-emphasis',
    category: '空虚な強調',
    severity: 'warning',
    pattern: /非常に|極めて|大いに/u,
    good: '数値か比較対象を書く。例:「同じ処理の 3 倍速い」',
  },
  // 「まさに」は検出しない。人間の使用が多く AI の癖ではないと実測されている
  // (人間 24 回 vs AI 0 回)
  {
    id: 'jargon-trap',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /罠|地雷/u,
    good: '何が起きるかをそのまま書く。例:「この設定では stdout が Claude に届かない」',
  },
  {
    id: 'jargon-technique',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /テク(?![ニノス])/u,
    good: '正式名称で書く。例:「手法」「書き方」',
  },
  {
    id: 'dismissive',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /カス(?![タケ])|くだらない/u,
    good: '対象を名指しして、何がどう不足しているかを書く',
  },
  {
    id: 'calm-down',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /少し冷静になって考えると/u,
    good: '前置きを削って結論から書く',
  },
  {
    id: 'jargon-projection',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /射影/u,
    good: 'データに何をしたかをそのまま書く。例:「jq がフィールドを絞り込んでいる」「不要な列を取り除く」。数学・グラフィックスの用語(正射影、射影変換など)は残してよい',
  },
  {
    id: 'jargon-window',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /窓(?![口際辺枠]|ガラス)/u,
    good: '時間帯・期間・状態をそのまま書く。例:「設定とコードが食い違っている時間帯」「再ビルドが完了するまでの数分間」。建築や UI の実物の窓は残してよい',
  },
  {
    id: 'jargon-skip',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /飛ば[さしすせそ]/u,
    good: '省略・中断・不実行をそのまま書く。例:「実行しない」「省略する」「途中で終える」。物を空中へ移動させる意味(ボールを飛ばす)は残してよい',
  },
  {
    id: 'jargon-lottery',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /くじ(?![らかきくけい])/u,
    good: '確率と回数をそのまま書く。例:「実行のたびに 1.5% の確率で失敗する」「回数を重ねればいずれ失敗する」。実際の抽選・抽選機能について書く場合は残してよい',
  },
  {
    // 「焼き込む」「焼き付く」「焼き直す」は埋め込みの意味で定着しており指摘の対象外。
    // 記録媒体への書き込みと調理は後読みで外す
    id: 'jargon-burn',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!(?:CD|DVD|BD|ROM|ディスク|イメージ|画像|写真|パン|肉|魚|芋) ?[をに] ?)焼(?:く|き(?![込付直上])|い[てた]|か(?![れ]))/u,
    good: '何をどれだけ消費するかをそのまま書く。例:「240 秒を消費する」「上限までトークンを使い切る」。記録媒体への書き込み、調理、日焼けは残してよい',
  },
  {
    id: 'jargon-authority',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /正本/u,
    good: '値の出どころをそのまま書く。例:「この設定はここのファイルの値を使う」「食い違ったら settings.json を優先する」。法律文書の正本(謄本と対になるもの)は残してよい',
  },
  {
    id: 'jargon-contract',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!雇用|賃貸|売買|保険|派遣|業務委託|請負)契約(?![書者社金期解満更条]|を結|を交)/u,
    good: '入出力の取り決めをそのまま書く。例:「引数は文字列、戻り値は件数」「型定義が入出力の形を決めている」。人や会社と結ぶ契約は残してよい',
  },
  {
    id: 'jargon-promise',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /(?<!口|固い|堅い|お)約束(?![事の])/u,
    good: '保証する内容をそのまま書く。例:「受け取った順に処理する」「失敗しても件数は変わらない」。人と交わす約束は残してよい',
  },
  {
    id: 'jargon-wire',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /配線(?!工)/u,
    good: 'どれをどこへ渡すかをそのまま書く。例:「ハンドラを router に登録する」「生成した client を引数で渡す」。電気やネットワークの実物の配線は残してよい',
  },
  {
    // surface の直訳。単独の「面」は場面・画面・側面と紛れるため、直訳で
    // 現れる複合語だけを見る
    id: 'jargon-surface',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?:公開|攻撃|接触|操作|設定|拡張|互換|境界|入出力)面(?![積白倒])/u,
    good: '利用者から見える範囲をそのまま書く。例:「外部に出す関数は 2 つだけ」「利用者が触る設定項目」。物体の面や図形の面は残してよい',
  },
  {
    id: 'jargon-role',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!主|脇|悪|大|端|配|重|現|兵|使|締|三|荷|通)役(?![割立所員場者職目柄種]|に立)/u,
    good: '何をする処理かをそのまま書く。例:「Pod へ転送するプロセス」「名前から IP を引く仕組み」。演劇や配役の意味は残してよい',
  },
  {
    id: 'jargon-run',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!手|首|体|腕|目|背|針|独楽|コマ|ハンドル|ネジ|ねじ|時計)を回[さしすせそ]/u,
    good: '実行をそのまま書く。例:「テストを実行する」「CI で毎回動かす」。物を回転させる意味は残してよい',
  },
  {
    id: 'jargon-skeleton',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /(?<!鉄|背|軟|遺|納|気|反|老|尾)骨(?![折盤髄粗質密子太])/u,
    good: '構成をそのまま書く。例:「記事の見出しを先に決める」「最初に置く 3 つの節」。人体や動物の骨は残してよい',
  },
  {
    id: 'jargon-noop',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /\bno[-\s]?ops?\b/iu,
    good: '何が起きないかをそのまま書く。例:「この分岐では何もしない」「既に登録済みなら書き換えない」',
  },
  {
    id: 'jargon-spec',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /\bspecs?\b/iu,
    good: '仕様と書く。どの仕様かまで示す。例:「issue #386 で決めた仕様」「OpenAPI の定義ファイル」',
  },
  {
    id: 'jargon-ack',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /\back\b/iu,
    good: '受信確認の動作をそのまま書く。例:「受け取ったことを返してから捨てる」。通信仕様の ACK パケットを指す場合は大文字で書けば残してよい',
  },
  {
    // 10 回以上の指摘を経ても直らなかったため severe にした。物を折り重ねる
    // 意味と店じまいの意味は除外側に足して残す。
    // 仮名書きは「〜けたためです」の「たため」に当たるため、可能形は
    // 「たためる」「たためば」「たためよ」だけを見て「たため」単独は外す
    id: 'jargon-fold',
    category: '過去の指摘',
    severity: 'severe',
    pattern:
      /(?<!折り|店を|会社を|事業を|商売を|傘を|布団を|服を|洗濯物を|地図を|テントを|紙を|布を|シャツを|ハンカチを|座布団を|段ボールを|ダンボールを)(?:畳(?:む|ん[でだ]|み(?!込)|め[るばよ]?|もう)|たた(?:む|ん[でだ]|み(?!込)|め[るばよ]|もう))/u,
    good: '削除・統合・終了のどれをするかをそのまま書く。例:「テストファイルを削除して 4 ケースを統合先へ移す」「この機能の提供をやめる」。布や紙を折り重ねる意味と、店や事業をやめる意味は残してよい',
  },
  {
    id: 'jargon-lick',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!(?:飴|アイス|指|唇|皿|傷|塩|切手|スプーン|舌|犬|猫) ?[をがで] ?)(?:舐め|嘗め)(?:る|た|て|ま[すしせ]|れ[ばる]?)/u,
    good: '何をどの範囲まで読むかをそのまま書く。例:「DOM を端から順に見る」「全ファイルを 1 回読む」。実際に舌でなめる意味は残してよい',
  },
  {
    id: 'jargon-stock',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /在庫(?![管切])/u,
    good: '数えている対象と数をそのまま書く。例:「公開時点で 100 ページある」「最初に用意できるのは 75 件」。商品や部品の実際の在庫は残してよい',
  },
  // ここから下は skill stop-ai-slop-jp と natural-japanese が挙げる語のうち、
  // このユーザーの過去入力 10,499 件で 1 度も使われていなかったものだけを採る。
  // 出典側が挙げていても実測で使用があった語(解像度・温度感・凝縮・インストール・
  // リファクタリング・コミットする)は、本人の語彙と区別できないため入れていない。
  // 同じ理由で全角コロン後の半角スペース・curly quotes・絵文字全般も対象外。
  {
    id: 'ai-texture',
    category: '質感を装う語',
    severity: 'severe',
    pattern:
      /手触り|肌感|(?<!総|発|摂取)熱量|腹落ち|血の通った|地に足のついた|等身大|泥臭|(?:の|という)営み/u,
    good: '何を見て何を感じたかをそのまま書く。例:「押した時の反発が強い」「実際に触ると angular より重い」',
  },
  {
    id: 'ai-grandiose',
    category: '大げさな熟語',
    severity: 'severe',
    pattern: /真理|境地|虚飾|深淵|禁欲的|冷徹|美学|結晶(?![化構水析])/u,
    good: '普通の感想を普通の語で書く。例:「使いにくかった」「思ったより速い」',
  },
  {
    id: 'translationese-verb',
    category: '翻訳調の動詞',
    severity: 'severe',
    pattern:
      /示唆|物語っている|(?<!水面に|空に|海面に)浮かび上が|収斂|同じ方向を指し/u,
    good: '誰が何をしたかを書く。例:「この計測では 3 件が失敗した」「同じ設定で 2 回とも落ちた」',
  },
  {
    id: 'translationese-frame',
    category: '翻訳調の言い回し',
    severity: 'severe',
    pattern: /という点で|であることは間違いない/u,
    good: '助詞でそのまま書く。例:「速度は速い」「この設定では落ちない」',
  },
  {
    id: 'katakana-jargon',
    category: '横文字',
    severity: 'severe',
    pattern:
      /レバレッジ|ディープダイブ|アライン(?![メ])|ピボット(?!テーブル)|ナレッジ(?!共有|ベース|マネジメント)|プライオリティ/u,
    good: '普通の日本語で書く。例:「活用する」「詳しく調べる」「揃える」「方針を変える」「知識」「優先度」',
  },
  {
    id: 'cliche-closing',
    category: '決まり文句',
    severity: 'severe',
    pattern:
      /いかがでした|ぜひ.{0,12}してみてください|現代社会において|近年[、，]|結論から言うと/u,
    good: '前置きと締めを削り、結果だけ書く。例:「設定を 2 箇所変えた」',
  },
  {
    id: 'structure-preview',
    category: '構成の予告',
    severity: 'severe',
    pattern: /つの観点から|順に見てい|ここからが本題|改めて整理|STEP ?[0-9]/u,
    good: '予告を削って中身から書く。見出しで分かることを本文で言い直さない',
  },
  {
    id: 'conclusion-dodge',
    category: '結論の回避',
    severity: 'severe',
    pattern:
      /ケースバイケース|場合によります|一概には言え|メリットもあれば|賛否が分かれる|状況に応じて異な/u,
    good: 'どちらを選ぶかを書く。例:「この規模なら前者にする」。決められないなら何が分かれば決まるかを書く',
  },
  {
    id: 'weak-negation',
    category: '弱い否定',
    severity: 'severe',
    pattern: /あまり推奨され|望ましくないとされ|避けたほうが(?:良|よ)い/u,
    good: '言い切る。例:「これは使わない」「この書き方だと落ちる」',
  },
  {
    id: 'disclaimer-ritual',
    category: '言い訳',
    severity: 'severe',
    pattern:
      /あくまで一例|個人差があ|(?:すべて|全て).{0,10}当てはまるわけでは/u,
    good: '予防線を削る。条件があるなら条件をそのまま書く。例:「bun 1.4 で確認した」',
  },
  {
    id: 'academic-self',
    category: '自称',
    severity: 'severe',
    pattern: /本稿|本論考|筆者/u,
    good: '自分を指すなら「私」と書く。文書自体を指すなら「ここ」「この文書」と書く',
  },
  {
    // 貼り付けや変換で紛れ込む見えない文字。人間が意図して書くことはない。
    // ZWJ(U+200D)は絵文字の合成に使われるため対象から外す
    id: 'invisible-char',
    category: '見えない文字',
    severity: 'severe',
    pattern: /[\u200B\u200C\uFEFF\u2060]/u,
    good: '見えない空白文字を削除する',
  },
  {
    id: 'check-cross-mark',
    category: '記号での対比',
    severity: 'severe',
    pattern: /[❌✅]/u,
    good: '対比を地の文に展開する。例:「前のやり方はここが面倒で、今のやり方はここが楽になった」',
  },
  {
    // くじ引きの比喩。対象を絞らないと「線を引く」「辞書を引く」「風邪を引く」まで当たる
    id: 'jargon-draw',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?:レシピ|記事|投稿|項目|候補|データ|\d+ ?件)(?:を|だけ|も)引(?:く|き|け[るばよ]?|い[てた]|こう)/u,
    good: '「引く」を使わず、選ぶ・表示する・取り出すのどれをするかをそのまま書く。例:「全レシピから1件だけ選ぶ」「ランダムに1件表示する」。くじや線や辞書を実際に引く意味は残してよい',
  },
  {
    id: 'jargon-pitfall',
    category: '過去の指摘',
    severity: 'warning',
    pattern: /落とし穴|落し穴/u,
    good: '何が起きるかをそのまま書く。例:「この順で書くと環境変数が読まれない」「引数を省くと既定値で上書きされる」。地面に掘る実際の落とし穴は残してよい',
  },
  {
    // 物理的にふさぐ意味と、手や席が使用中である意味は助詞ごと後読みで外す
    id: 'jargon-block-off',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!(?:耳|口|鼻|穴|道|傷|窓|通路|入口|出口|隙間|手|席|回線|電話)[をがも] ?)塞(?:ぐ|ぎ|い[でだ]|げ[るばよ]?|ご[うる]|が[らりるれっ])/u,
    good: '何が起きなくなるかをそのまま書く。例:「この 2 つの不具合が起きなくなる」「未処理だった経路を処理するようにした」。耳や穴を実際にふさぐ意味、手や席が使用中である意味は残してよい',
  },
  {
    // 物を打つ意味は助詞ごと後読みで外す。「叩き台」「叩き上げ」「叩き売り」は
    // 打つ動作の比喩ではなく別の語として定着しているため後読みで外す
    id: 'jargon-hit',
    category: '過去の指摘',
    severity: 'warning',
    pattern:
      /(?<!(?:肩|背中|背|頭|尻|手|膝|顔|扉|ドア|戸|窓|机|壁|床|地面|太鼓|鍵盤|キーボード|門)[をがも] ?)叩(?:く|き(?![台上売])|け[るばよ]?|い[てた]|こう|か)/u,
    good: '実行・送信のどちらをするかをそのまま書く。例:「clasp push を実行する」「API にリクエストを送る」。物を打つ意味と「叩き台」は残してよい',
  },
  // 本人の使用がある語(実測・切り分け・瞬間・断定・既定)は入れていない。
  // 出典 https://nyosegawa.com/posts/qiita-writing-before-after-ai/
  {
    id: 'jargon-pass-through',
    category: '失敗の比喩',
    severity: 'warning',
    pattern: /素通り/u,
    good: '何が処理されないかをそのまま書く。例:「この分岐は検査せずに次へ渡す」「フィルタが適用されない」',
  },
  {
    id: 'jargon-magnitude',
    category: '判断の言い回し',
    severity: 'warning',
    pattern: /桁違い/u,
    good: '何倍かを数値で書く。例:「処理時間が 30 倍になる」「件数が 2 桁多い」',
  },
  {
    id: 'jargon-mixup',
    category: '判断の言い回し',
    severity: 'warning',
    pattern: /取り違え/u,
    good: '何と何を混同するかを書く。例:「id と index を逆に渡す」',
  },
  {
    id: 'jargon-standard-move',
    category: '判断の言い回し',
    severity: 'warning',
    pattern: /定石/u,
    good: 'なぜその方法を選ぶかを書く。例:「この件数なら index を張る」',
  },
  {
    id: 'jargon-composition',
    category: '場所や物のたとえ',
    severity: 'warning',
    pattern: /という構図/u,
    good: '関係をそのまま書く。例:「A が B を呼び、失敗すると C が再試行する」',
  },
  {
    id: 'jargon-tool',
    category: '場所や物のたとえ',
    severity: 'warning',
    pattern: /(?:ための|という)道具/u,
    good: '何ができるかをそのまま書く。例:「差分を出すコマンド」。実物の工具は残してよい',
  },
  {
    // 建物の入口と分けるため、比喩でしか付かない助詞まで含めて見る
    id: 'jargon-entrance',
    category: '場所や物のたとえ',
    severity: 'warning',
    pattern: /入口(?:として|に立|になる)/u,
    good: '最初に何をするかをそのまま書く。例:「最初に読むのはこのファイル」。建物の入口は残してよい',
  },
  {
    // silently break / silently ignored の直訳
    id: 'jargon-silently',
    category: '翻訳調の言い回し',
    severity: 'warning',
    pattern: /静かに(?:壊れ|失敗|死ぬ|落ちる|止ま|消え|無視)/u,
    good: 'エラーが出ないことをそのまま書く。例:「例外を投げずに空配列を返す」「警告も出さずに設定を捨てる」',
  },
  {
    id: 'jargon-accident',
    category: '失敗の比喩',
    severity: 'warning',
    pattern: /(?<!交通|人身|自動車|追突|接触|労災)事故(?![死車現])/u,
    good: '何が起きるかをそのまま書く。例:「本番のデータを上書きする」。実際の事故は残してよい',
  },
  {
    id: 'jargon-collapse',
    category: '失敗の比喩',
    severity: 'warning',
    pattern: /(?<!財政|経営|家庭|婚姻|債務)破綻/u,
    good: '何が成り立たなくなるかを書く。例:「件数が合わなくなる」「型が合わずビルドが落ちる」。経営や財政の破綻は残してよい',
  },
  {
    id: 'jargon-tilt',
    category: '作業の比喩',
    severity: 'warning',
    pattern: /(?:側|安全|厳しめ|緩め|こちら|そちら|どちら)に倒[すしせそさ]/u,
    good: 'どちらを選ぶかをそのまま書く。例:「迷ったら再試行しない方を選ぶ」',
  },
  {
    id: 'jargon-let-escape',
    category: '作業の比喩',
    severity: 'warning',
    pattern: /(?<!(?:熱|水|空気|蒸気|圧|魚|鳥|虫|煙) ?[をが] ?)逃が[すしせそ]/u,
    good: '例外や負荷をどう扱うかをそのまま書く。例:「例外を握りつぶさず呼び出し元へ投げる」。熱や水を実際に逃がす意味は残してよい',
  },
  {
    id: 'jargon-crush',
    category: '作業の比喩',
    severity: 'warning',
    pattern: /(?<!(?:時間|暇|ひま|顔|面目|芽) ?[をが] ?)潰[すしせさそ]/u,
    good: '何を直すかをそのまま書く。例:「未処理の不具合を 1 件ずつ直す」。時間や暇を潰す意味は残してよい',
  },
  {
    // 境界値分析は試験の用語、境界面は jargon-surface が見るため後読みで外す
    id: 'jargon-boundary',
    category: '翻訳調の言い回し',
    severity: 'warning',
    pattern: /(?:の|という)境界(?![値線面])/u,
    good: 'どこで分かれるかをそのまま書く。例:「ここから先はライブラリの責務」「この関数は検証をしない」',
  },
] as const satisfies readonly WordRule[];

export const documentRules = {
  'sentence-ending-repeat': {
    category: '文末の重複',
    severity: 'warning',
    threshold: 3,
    good: '文末を変える。例:「〜します」「〜です」「〜になります」を混ぜる。体言止めにしない',
  },
  'polite-plain-mixed': {
    category: '文体の混在',
    severity: 'warning',
    threshold: 1,
    good: '敬体か常体のどちらかに統一する',
  },
  'dewanaku-overuse': {
    category: '対句の多用',
    severity: 'warning',
    threshold: 3,
    good: '「AではなくB」「AだけでなくBも」の対句を減らす。残す箇所には否定の根拠を一文添える',
  },
  // natural-japanese は「長文なのに体言止めが 1 つも無い」ことを AI らしさとして
  // 検出する(体言止めは人間の修辞技法という実測結果)。ここは逆向きで、
  // 体言止め自体を避けたいという好みを規則にしている
  taigendome: {
    category: '体言止め',
    severity: 'warning',
    threshold: 1,
    good: '述語で言い切る。例:「〜が原因。」→「〜が原因です。」',
  },
  // 見出しに主張を置くと、各節がその主張の裏付けを並べる構成になる。
  // ファイル全体を見る規則なので severe にすると無関係な編集のたびに再送される
  'heading-proposition': {
    category: '見出しの形',
    severity: 'warning',
    threshold: 1,
    good: '見出しは題目の名前にする。例:「この設計もまた同じ方向を指している」→「この設計の位置づけ」',
  },
} as const satisfies Record<string, DocumentRule>;

// キーは preset-ai-writing の rule id と一致させる。textlint 側のメッセージは
// 「より自然な表現を検討してください」で終わり書き換え先を示さないため、good だけ
// こちらで持つ。severity は語規則と違い全て warning から始める。構造の指摘は
// 書式の好みと区別がつかず、severe にすると SKILL.md の編集が進まなくなる
export const textlintRules = {
  'no-ai-list-formatting': {
    category: 'リストの書式',
    severity: 'warning',
    good: '絵文字を消して語で書く。例:「✅ 完了」→「完了」',
  },
  'no-ai-emphasis-patterns': {
    category: '強調の書式',
    severity: 'warning',
    good: '見出しの ** を外す。強調は地の文の語にだけ使う',
  },
  'no-ai-hype-expressions': {
    category: '誇張',
    severity: 'warning',
    good: '誇張語を消して事実だけ書く。程度を示すなら数値か比較対象を添える。例:「大幅に短縮」→「1.2 秒から 0.4 秒に短縮」',
  },
  'no-ai-colon-continuation': {
    category: 'コロンの継続',
    severity: 'warning',
    good: 'コロンを消して文で言い切る。例:「実行します:」→「実行方法は次のとおりです。」。名詞で終わるコロン(「例:」「使用方法:」)は残してよい',
  },
  'ai-tech-writing-guideline': {
    category: '冗長・曖昧',
    severity: 'warning',
    good: '冗長な言い回しを削り、能動態と具体的な数値で書く。例:「操作する必要があります」→「操作します」。「必要に応じて」「適切に」は削る',
  },
} as const satisfies Record<string, TextlintRule>;

// 回数だけで判定すると長い文書ほど当たりやすい。密度が薄いうちは人間の修辞と
// 区別がつかないため、地の文に対する比率も条件にする
export const antithesisRatioThreshold = 0.02;

// 長い語尾から先に照合する。「ました」より前に「ませんでした」を置く
export const politeEndings = [
  'ませんでした',
  'ましょう',
  'ますか',
  'ません',
  'ました',
  'ます',
  'でしたか',
  'でしょう',
  'でした',
  'ですか',
  'です',
] as const;

export const plainEndings = [
  'であった',
  'である',
  'なかった',
  'だった',
  'ない',
  'だ',
  'た',
  'る',
  'う',
  'い',
] as const;

export type WordRuleId = (typeof wordRules)[number]['id'];
export type DocumentRuleId = keyof typeof documentRules;
export type TextlintRuleId = keyof typeof textlintRules;
export type RuleId = WordRuleId | DocumentRuleId | TextlintRuleId;

export interface Violation {
  ruleId: RuleId;
  category: string;
  severity: Severity;
  matched: string;
  sentence: string;
  good: string;
}

export function documentRule<Id extends DocumentRuleId>(
  id: Id,
): DocumentRule & { id: Id } {
  return { id, ...documentRules[id] };
}

export function isDocumentRuleId(id: RuleId): id is DocumentRuleId {
  return id in documentRules;
}

export function isTextlintRuleId(id: RuleId): id is TextlintRuleId {
  return id in textlintRules;
}

// ファイル全体を見て判定する規則。今回書いた範囲に関係なく当たり続けるため、
// 呼ぶ側は同じ指摘の再送を抑える
export function isFileScopedRuleId(id: RuleId): boolean {
  return isDocumentRuleId(id) || isTextlintRuleId(id);
}
