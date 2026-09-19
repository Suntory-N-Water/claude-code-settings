import { describe, expect, test } from 'bun:test';
import { collectMessageTargets } from './git-message-targets.ts';

function catHeredoc(body: string): string {
  return `"$(cat <<'EOF'\n${body}\nEOF\n)"`;
}

describe('git commit のメッセージ抽出', () => {
  test('-m に直接書いたとき、その本文が対象になること', () => {
    expect(collectMessageTargets('git commit -m "fix: 種を取り除く"')).toEqual([
      {
        label: 'コミットメッセージ',
        format: 'text',
        source: { kind: 'text', text: 'fix: 種を取り除く' },
      },
    ]);
  });

  test('-m を並べたとき、空行で連結した 1 つのメッセージになること', () => {
    const targets = collectMessageTargets(
      'git commit -m "feat: 件名" -m "本文の説明。"',
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.source).toEqual({
      kind: 'text',
      text: 'feat: 件名\n\n本文の説明。',
    });
  });

  test('-m へ cat のヒアドキュメントを渡したとき、その中身が対象になること', () => {
    const targets = collectMessageTargets(
      `git commit -m ${catHeredoc('feat: 件名\n\n本文の説明。')} && git push`,
    );

    expect(targets).toEqual([
      {
        label: 'コミットメッセージ',
        format: 'text',
        source: { kind: 'text', text: 'feat: 件名\n\n本文の説明。' },
      },
    ]);
  });

  test('-F - へヒアドキュメントを渡したとき、その中身が対象になること', () => {
    const targets = collectMessageTargets(
      "git add -A && git commit -q -F - <<'MSG' && git push\nfix: 件名\n\n本文。\nMSG",
    );

    expect(targets).toEqual([
      {
        label: 'コミットメッセージ',
        format: 'text',
        source: { kind: 'text', text: 'fix: 件名\n\n本文。' },
      },
    ]);
  });

  test('-F- と続けて書いても、ヒアドキュメントの中身が対象になること', () => {
    const targets = collectMessageTargets(
      "git commit -F- <<'EOF'\nfix: 件名\nEOF",
    );

    expect(targets[0]?.source).toEqual({ kind: 'text', text: 'fix: 件名' });
  });

  test('メッセージが二重引用符を含んでも、最後まで対象になること', () => {
    const targets = collectMessageTargets(
      `git commit -m ${catHeredoc('fix: 件名\n\n既定の "requires approval" で拒否された。\n\n最終行。')}`,
    );

    expect(targets[0]?.source).toEqual({
      kind: 'text',
      text: 'fix: 件名\n\n既定の "requires approval" で拒否された。\n\n最終行。',
    });
  });

  test('-F にパスを渡したとき、そのファイルが対象になること', () => {
    expect(collectMessageTargets('git commit -F /tmp/msg.txt')).toEqual([
      {
        label: 'コミットメッセージ',
        format: 'text',
        source: { kind: 'file', path: '/tmp/msg.txt' },
      },
    ]);
  });

  test('--amend でもメッセージが対象になること', () => {
    expect(collectMessageTargets('git commit --amend -m "fix: 件名"')).toEqual([
      {
        label: 'コミットメッセージ',
        format: 'text',
        source: { kind: 'text', text: 'fix: 件名' },
      },
    ]);
  });

  test('rtk を前置しても対象になること', () => {
    expect(collectMessageTargets('rtk git commit -m "fix: 件名"')).toHaveLength(
      1,
    );
    expect(
      collectMessageTargets('rtk proxy git commit -m "fix: 件名"'),
    ).toHaveLength(1);
  });

  test('-C で作業ディレクトリを指定しても対象になること', () => {
    expect(
      collectMessageTargets('git -C /tmp/repo commit -m "fix: 件名"'),
    ).toHaveLength(1);
  });

  test('定型の署名行は対象から外れること', () => {
    const targets = collectMessageTargets(
      `git commit -m ${catHeredoc('fix: 件名\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')}`,
    );

    expect(targets[0]?.source).toEqual({ kind: 'text', text: 'fix: 件名' });
  });

  test('署名だけのメッセージは対象にならないこと', () => {
    expect(
      collectMessageTargets(
        `git commit -m ${catHeredoc('Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>')}`,
      ),
    ).toEqual([]);
  });

  test('commit 以外のサブコマンドは対象にならないこと', () => {
    expect(
      collectMessageTargets('git log --grep="効く" --oneline -m 5'),
    ).toEqual([]);
  });

  test('展開できないコマンド置換は対象にならないこと', () => {
    expect(collectMessageTargets('git commit -m "$(build_message)"')).toEqual(
      [],
    );
    expect(collectMessageTargets('git commit -m "$MESSAGE"')).toEqual([]);
  });
});

describe('gh pr のタイトルと本文の抽出', () => {
  test('create のタイトルと本文がそれぞれ対象になること', () => {
    const targets = collectMessageTargets(
      `gh pr create --title "docs: 記事を追加する" --body ${catHeredoc('## 概要\n\n説明。')} 2>&1 | tail -3`,
    );

    expect(targets).toEqual([
      {
        label: 'PR のタイトル',
        format: 'text',
        source: { kind: 'text', text: 'docs: 記事を追加する' },
      },
      {
        label: 'PR の本文',
        format: 'markdown',
        source: { kind: 'text', text: '## 概要\n\n説明。' },
      },
    ]);
  });

  test('--body-file にパスを渡したとき、そのファイルが対象になること', () => {
    expect(
      collectMessageTargets(
        'gh pr create --title "件名" --body-file /tmp/body.md',
      ),
    ).toContainEqual({
      label: 'PR の本文',
      format: 'markdown',
      source: { kind: 'file', path: '/tmp/body.md' },
    });
  });

  test('edit の本文が対象になること', () => {
    expect(collectMessageTargets('gh pr edit 3 --body "説明を直す。"')).toEqual(
      [
        {
          label: 'PR の本文',
          format: 'markdown',
          source: { kind: 'text', text: '説明を直す。' },
        },
      ],
    );
  });

  test('comment の本文はコメントとして対象になること', () => {
    expect(
      collectMessageTargets('gh pr comment 3 --body "確認した。"'),
    ).toEqual([
      {
        label: 'PR のコメント',
        format: 'markdown',
        source: { kind: 'text', text: '確認した。' },
      },
    ]);
  });

  test('読み取りだけのサブコマンドは対象にならないこと', () => {
    expect(collectMessageTargets('gh pr view 5 --json title,body')).toEqual([]);
    expect(collectMessageTargets('gh pr list --state all')).toEqual([]);
  });

  test('pr / issue 以外のリソースは対象にならないこと', () => {
    expect(
      collectMessageTargets('gh release create v1.0.0 --notes "説明。"'),
    ).toEqual([]);
    expect(
      collectMessageTargets('gh repo create sample --description "説明。"'),
    ).toEqual([]);
  });
});

describe('gh issue のタイトルと本文の抽出', () => {
  test('create のタイトルと本文が Issue として対象になること', () => {
    expect(
      collectMessageTargets(
        'gh issue create --title "検出層を足す" --body "## 背景\n\n説明。"',
      ),
    ).toEqual([
      {
        label: 'Issue のタイトル',
        format: 'text',
        source: { kind: 'text', text: '検出層を足す' },
      },
      {
        label: 'Issue の本文',
        format: 'markdown',
        source: { kind: 'text', text: '## 背景\n\n説明。' },
      },
    ]);
  });

  test('--body-file にパスを渡したとき、そのファイルが対象になること', () => {
    expect(
      collectMessageTargets(
        'gh issue create --repo owner/name --title "件名" --body-file /tmp/issue-body.md',
      ),
    ).toContainEqual({
      label: 'Issue の本文',
      format: 'markdown',
      source: { kind: 'file', path: '/tmp/issue-body.md' },
    });
  });

  test('comment の本文はコメントとして対象になること', () => {
    expect(
      collectMessageTargets('gh issue comment 12 --body "対応した。"'),
    ).toEqual([
      {
        label: 'Issue のコメント',
        format: 'markdown',
        source: { kind: 'text', text: '対応した。' },
      },
    ]);
  });

  test('edit の本文が対象になること', () => {
    expect(
      collectMessageTargets('gh issue edit 12 --body "説明を直す。"'),
    ).toEqual([
      {
        label: 'Issue の本文',
        format: 'markdown',
        source: { kind: 'text', text: '説明を直す。' },
      },
    ]);
  });

  test('読み取りだけのサブコマンドは対象にならないこと', () => {
    expect(collectMessageTargets('gh issue view 12 --comments')).toEqual([]);
    expect(collectMessageTargets('gh issue close 12')).toEqual([]);
  });
});
