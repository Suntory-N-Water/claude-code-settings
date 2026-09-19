# claude code settings

## subagent-log

`Explore` / `general-purpose` サブエージェントの調査結果を
`subagent-log/<プロジェクト名>/<日付>_<調査内容>.md` に保存する
(`scripts/typescript/subagent-archive.ts`)。

サブエージェント開始時に `scripts/typescript/subagent-research-context.ts` が
保存先のパスを注入し、過去ログを `grep` で探してから調査するよう指示する。
