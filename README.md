# Claude Code Settings

## セットアップ

### 新規インストール

既存の `.claude` ディレクトリがない場合は、直接クローンできます。

```bash
git clone https://github.com/Suntory-N-Water/claude-code-settings.git ~/.claude
```

### 既存の `.claude` ディレクトリがある場合

既存設定をバックアップしてから完全置換します。

```bash
# 既存設定をバックアップ
mv ~/.claude ~/.claude_backup_$(date +%Y%m%d_%H%M%S)

# 新しい設定をクローン
git clone https://github.com/Suntory-N-Water/claude-code-settings.git ~/.claude
```
