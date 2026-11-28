#!/bin/bash
set -u

# rtk: PreToolUse フックが全 Bash 呼び出しで叩くので PATH 非依存にする
(
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  ln -sf "$HOME/.local/bin/rtk" /usr/local/bin/rtk
) &

(
  git clone --depth 1 https://github.com/Suntory-N-Water/claude-code-settings.git /tmp/cc-settings
  mkdir -p "$HOME/.claude"
  cp -a /tmp/cc-settings/. "$HOME/.claude/"
  cd "$HOME/.claude" && bun install

  # クラウドの GitHub プロキシの制約は手元では起きないため、リポジトリの CLAUDE.md ではなく VM 上の複製にだけ足す
  cat >> "$HOME/.claude/CLAUDE.md" <<'EOF'

# クラウドセッションの GitHub 操作

- GitHub のプロキシが GraphQL を拒否するため、`gh pr` と `gh issue` のサブコマンドは 403 で失敗する。PR と Issue の操作は組み込みの GitHub ツールか、`gh api repos/{owner}/{repo}/...` の REST 呼び出しで行う
- `GH_TOKEN` は `proxy-injected` という仮の値で、認証はプロキシが付ける。`gh auth login` は実行しない
- プロキシはタグのプッシュとブランチの削除を拒否する
EOF

  claude plugin marketplace add Suntory-N-Water/suntory-n-water-marketplace || true
  claude plugin marketplace add anthropics/claude-plugins-official || true
  claude plugin install -y general-dev-skills@suntory-n-water-marketplace || true
  claude plugin install -y general-dev-mods@suntory-n-water-marketplace || true
  claude plugin install -y visual-html@suntory-n-water-marketplace || true
  claude plugin install -y mattpocock-skills@claude-plugins-official || true
) &

# 手元では npx skills で ~/.agents/skills に入れており設定リポジトリに含まれないため、取得元から直接置く
(
  mkdir -p "$HOME/.claude/skills"
  for repo in vercel-labs/agent-browser MaryCache/imozuru nanaism/yomiyasu; do
    name="${repo#*/}"
    git clone --depth 1 "https://github.com/$repo.git" "/tmp/skill-$name" || continue
    rm -rf "$HOME/.claude/skills/$name"
    cp -a "/tmp/skill-$name/skills/$name" "$HOME/.claude/skills/$name" || true
  done
) &

(
  npm install -g agent-browser && agent-browser install
) &

wait
exit 0
