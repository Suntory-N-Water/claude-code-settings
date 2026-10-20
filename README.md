# claude code settings

## subagent-log

`Explore` / `general-purpose` サブエージェントの調査結果を
`subagent-log/<プロジェクト名>/<日付>_<調査内容>.md` に保存する
(`scripts/typescript/subagent-archive.ts`)。

サブエージェント開始時に `scripts/typescript/subagent-research-context.ts` が
保存先のパスを注入し、過去ログを `grep` で探してから調査するよう指示する。

## herdr

herdr の設定ファイルは `herdr/config.toml` に置いている。

herdr が読むのは `~/.config/herdr/config.toml` なので、macOS と WSL のどちらでも、次のコマンドでこの場所にリンクを作る。

```sh
mkdir -p ~/.config/herdr
ln -sf ~/.claude/herdr/config.toml ~/.config/herdr/config.toml
herdr server reload-config
```

`settings.json` の SessionStart には、herdr 用のフック `hooks/herdr-agent-state.sh` を登録した。herdr を再起動すると、herdr はこのフックが送ったセッション ID を使って Claude Code の会話を再開する。

`herdr integration install claude` は、`settings.json` を次のように書き換えてしまう。

- 全部のキーをアルファベット順に並べ替える
- フックのパスを `/Users/...` から始まる絶対パスにする（WSL ではこのパスにファイルが無い）

herdr の更新でこのコマンドを実行し直したときは、`git diff settings.json` で上の 2 点を確かめて元に戻す。

`scripts/typescript/herdr-pane-status.ts` は、Claude Code に送った指示の 1 行目を、herdr のサイドバーのエージェント一覧に出す。作業中か終わったかは、herdr が同じ行に出す `working` / `idle` で見分ける。herdr の外で起動した Claude Code では、このフックは何もしない。