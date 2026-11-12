# フックの棚卸し（2026-11-12）

`settings.json` のフックと、プラグイン general-dev-mods の常駐 mod を 1 つずつ確認した結果です。

## 削除するフック

- 起動時に作業前の確認事項を表示するフック（`session-start-reminder.ts`）
- 計画ファイルに見出し入りのシンボリックリンクを作るフック（`create-plan-link.ts`）
- 計画モードに入ったときに文体指針を渡すフック（`plan-mode-style.ts`）
- ツールの失敗を月ごとのファイルに記録するフック（`tool-failure-log.ts`）

## 判断を保留したフック

- 否定の指示に注意を差し込むフック（`negation-guard.ts`）。誤検知が多く、より良い方法を検討中。2026-11-12 に `settings.json` から登録を外した。スクリプトのファイルは残してある。
- 推敲まわりの 4 つのフックは、まとめて見直す。
  - 編集で増えた textlint の指摘を伝えるフック（`textlint-post-tool-use.ts`）。2026-11-12 に、応答の終わりにまとめて確かめる方式へ移した。
    - 編集のたびに動くフックは、ターンで最初の編集の前の本文を `~/.claude/textlint-check/` に記録するだけになった。1 回約 0.01 秒、最大約 25MB（改修前は約 0.21 秒、約 379MB）。
    - 応答の終わりに動くフック（`textlint-edits-stop.ts`）が textlint を 1 回だけ起動する。増えた指摘を `~/.claude/textlint-check/<セッション>-report.md` に書き出し、Claude にはファイルのパスを返して読ませる。
  - Markdown を書き方の規則で確かめるフックと、応答の終わりに未修正の文を差し戻すフック（`style-check.ts`、`style-check-stop.ts`）。Markdown の編集 1 回で約 0.12 秒、最大約 381MB を使っていた。2026-11-12 に 2 つとも登録を外し、規則は応答の終わりの textlint のフック（`textlint-edits-stop.ts`）でまとめてかけるようにした。編集で増えた文だけを、textlint と同じ報告のファイルに書き出す。
  - コミットメッセージと PR・Issue の本文に textlint をかけるフック（`textlint-git-message.ts`）。残す寄り。編集後の textlint のフックとは別プロセスで、textlint をそれぞれ読み込む。

## 改修するフック

- HTML プレビューのコメントを Claude に渡すフック（`inject-comments.ts`）。入力ごとに `~/.claude/output-html` のコメントのファイルを全件読む（直近 1 か月の更新分だけで 112 件）。読み方を改善できる。2026-11-12 の測定では、コメントのファイル 130 件で 1 回約 0.02 秒、最大約 29MB だった。何もしないフック（約 23MB）とほぼ同じなので、改修は見送る。
- Markdown を HTML に変換するフック（`md-to-html.ts`）。2026-11-12 に改修した。
  - 変換の処理を `md-to-html/convert.ts` に移し、対象の Markdown のときだけ読み込む。Markdown 以外では 1 回約 0.01 秒、最大約 23MB になった（改修前は約 0.04 秒、約 42MB）。
  - タイトル・見出しがない Markdown と、800 字未満の Markdown も変換する。本文が空のときだけ変換しない。
- WebFetch の代わりにページを Markdown で保存するフック（`web-fetch-advice.ts`）。2026-11-06 ごろから、WebFetch はページ取得用のサブエージェント（WebFetch しか持たない）経由になり、保存したファイルを読めずに失敗していた。原因は Anthropic がサーバー側で配る機能フラグ（`tengu_clever_orbit`）で、変更履歴には載っていない。2026-11-12 に `settings.json` の `env` へ `CLAUDE_CODE_WEB_FETCH_AGENT=0` を足し、WebFetch を直接呼ぶ動きに戻した。新しいセッションでフックがページを保存することを確かめた。
- サブエージェントの調査結果を保存するフックと、過去ログを探させるフック（`subagent-archive.ts`、`subagent-research-context.ts`）。最近のサブエージェントは最終報告を SubagentHandback ツールで渡すため、保存されるのは「Now searches.」のような途中の 1 文だけになっている。2026-11-12 に、SubagentHandback の message を優先して保存するように直した。2026-11-11 の調査の記録で試すと、245 バイトだった保存内容が 21,870 バイトの最終報告になった。過去ログを探させるフックは、保存内容が直ったのでそのまま使う。

## そのまま使うフック

- 1 時間以上空いた入力を差し戻すフック（`cache-ttl-guard.ts`）
- 55 分無操作で自動で /compact する mod（general-dev-mods の `cache-ttl-compact`）。差し戻すフックと役割が重なるが、自動圧縮が動かなかったときの代わりとして両方残す。
- herdr に会話の ID を知らせるフック（`hooks/herdr-agent-state.sh`）
- herdr のサイドバーに入力の 1 行目を表示するフック（`herdr-pane-status.ts`）
- 英語の応答を差し戻すフック（`japanese-guard.ts`）。応答の終わりごとに会話の履歴を全部読む。52MB の履歴では最大約 253MB を使った。
- 質問や許可の待機をターミナルに通知するフック（`notify-input-needed.ts`）
- 応答の終了時に通知音を鳴らすフック（`notify-turn-end.ts`）
- テスト設計のスキルなしでテストを編集するのを止めるフック（`tdd-skill-guard.ts`）
- Bash を rtk 経由に書き換えるフック（`rtk hook claude`）
