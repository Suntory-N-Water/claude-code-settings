#!/bin/bash

# 保存先ディレクトリ（Obsidian）
OBSIDIAN_DIR="$HOME/dev/sui-articles/claude"
LOG_FILE="$HOME/.claude/logs/save-history.log"
HISTORY_FILE="$HOME/.claude/history.jsonl"
STATE_FILE="$HOME/.claude/logs/history-last-line"

# ログ関数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 必要なディレクトリを作成
mkdir -p "$OBSIDIAN_DIR"
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$STATE_FILE")"

# 状態ファイルの初期化（初回は現在行数を記録するだけ）
if [ ! -f "$STATE_FILE" ]; then
    if [ -f "$HISTORY_FILE" ]; then
        CURRENT_LINES=$(wc -l < "$HISTORY_FILE" | tr -d ' ')
        echo "$CURRENT_LINES" > "$STATE_FILE"
        log "初回起動: 現在の行数 ($CURRENT_LINES) を記録しました。次回から新規追加分のみ処理します。"
    else
        echo "0" > "$STATE_FILE"
    fi
fi

log "履歴監視を開始します"

while true; do
    if [ -f "$HISTORY_FILE" ]; then
        # 前回処理した行数を取得
        LAST_LINE=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
        CURRENT_LINES=$(wc -l < "$HISTORY_FILE" | tr -d ' ')

        # 新しい行がある場合のみ処理
        if [ "$CURRENT_LINES" -gt "$LAST_LINE" ]; then
            log "新しい履歴を検出: $((CURRENT_LINES - LAST_LINE))行"

            # 新しい行のみを処理
            tail -n +$((LAST_LINE + 1)) "$HISTORY_FILE" | while IFS= read -r line; do
                # タイムスタンプを取得（ミリ秒のUnixタイムスタンプ）
                TIMESTAMP=$(echo "$line" | jq -r '.timestamp // empty')

                if [ -n "$TIMESTAMP" ]; then
                    # ミリ秒を秒に変換して日付を取得
                    DATE=$(date -r $((TIMESTAMP / 1000)) '+%Y-%m-%d' 2>/dev/null)

                    if [ -n "$DATE" ]; then
                        # historyサブディレクトリを作成
                        mkdir -p "$OBSIDIAN_DIR/history"
                        OUTPUT_FILE="$OBSIDIAN_DIR/history/${DATE}.md"

                        # 入力内容とプロジェクト情報を取得
                        DISPLAY=$(echo "$line" | jq -r '.display // empty')
                        PROJECT=$(echo "$line" | jq -r '.project // empty')
                        PROJECT_NAME=$(basename "$PROJECT")

                        if [ -n "$DISPLAY" ]; then
                            # ISO 8601形式のタイムスタンプ
                            TIMESTAMP_ISO=$(date -r $((TIMESTAMP / 1000)) '+%Y-%m-%dT%H:%M:%S' 2>/dev/null)

                            # エントリを追加（シンプルフォーマット）
                            echo "" >> "$OUTPUT_FILE"
                            echo "## $TIMESTAMP_ISO ($PROJECT_NAME)" >> "$OUTPUT_FILE"
                            echo "" >> "$OUTPUT_FILE"
                            echo "\`\`\`\`" >> "$OUTPUT_FILE"
                            echo "$DISPLAY" >> "$OUTPUT_FILE"
                            echo "\`\`\`\`" >> "$OUTPUT_FILE"
                            echo "" >> "$OUTPUT_FILE"
                        fi
                    fi
                fi
            done

            # 処理した行数を更新
            echo "$CURRENT_LINES" > "$STATE_FILE"
            log "状態ファイルを更新: $CURRENT_LINES 行"

            # Git自動add, commit, push
            if [ -d "$OBSIDIAN_DIR/.git" ] || git -C "$OBSIDIAN_DIR" rev-parse --git-dir > /dev/null 2>&1; then
                cd "$OBSIDIAN_DIR" || exit
                git add history/ >> "$LOG_FILE" 2>&1
                if ! git diff --cached --quiet; then
                    git commit -m "Auto-update history $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE" 2>&1
                    git push >> "$LOG_FILE" 2>&1
                    log "変更をコミット&プッシュしました"
                else
                    log "変更なし、コミットはスキップ"
                fi
            fi
        fi
    fi

    # 10秒待機（history.jsonlは頻繁に更新されないため）
    sleep 10
done
