import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { collectMarkdownWriteTargets } from './bash-targets.ts';

const CWD = '/Users/tester/dev/project';

function collect(command: string): string[] {
  return collectMarkdownWriteTargets(command, CWD).sort();
}

describe('リダイレクトによる書き込みの検知', () => {
  it('ヒアドキュメントの書き出し先が対象になること', () => {
    const command = ["cat > docs/plan.md <<'EOF'", '# 計画', '本文', 'EOF'].join('\n');

    expect(collect(command)).toEqual([`${CWD}/docs/plan.md`]);
  });

  it('ヒアドキュメントの本文で言及されただけのファイルは対象にならないこと', () => {
    const command = [
      "cat > docs/plan.md <<'EOF'",
      '- AGENTS.md を参照する',
      '- ~/.claude/CLAUDE.md も見る',
      'EOF',
    ].join('\n');

    expect(collect(command)).toEqual([`${CWD}/docs/plan.md`]);
  });

  it('リダイレクトがヒアドキュメントより後ろにあっても対象になること', () => {
    const command = ["cat <<'EOF' > docs/plan.md", '# 計画', 'EOF'].join('\n');

    expect(collect(command)).toEqual([`${CWD}/docs/plan.md`]);
  });

  it('追記のリダイレクトも対象になること', () => {
    expect(collect('printf "行\\n" >> notes.md')).toEqual([`${CWD}/notes.md`]);
  });

  it('コマンドの出力を書き出した先も対象になること', () => {
    expect(collect('gh issue view 965 --json body -q .body > out.md')).toEqual([`${CWD}/out.md`]);
  });
});

describe('その場書き換えコマンドの検知', () => {
  it('sed -i の対象ファイルが複数でもすべて対象になること', () => {
    const command = "sed -i '' -e 's|旧|新|g' docs/a.md docs/b.md && grep -rn 新 docs";

    expect(collect(command)).toEqual([`${CWD}/docs/a.md`, `${CWD}/docs/b.md`]);
  });

  it('-i の無い sed は対象にならないこと', () => {
    expect(collect("sed -n '5,9p' docs/a.md")).toEqual([]);
  });

  it('perl の -i も対象になること', () => {
    expect(collect("perl -i -pe 's/旧/新/' docs/a.md")).toEqual([`${CWD}/docs/a.md`]);
  });

  it('tee の書き出し先が対象になること', () => {
    expect(collect('echo x | tee -a docs/a.md')).toEqual([`${CWD}/docs/a.md`]);
  });
});

describe('コピーと移動の検知', () => {
  it('移動先が対象になり、移動元は対象にならないこと', () => {
    expect(collect('mv docs/old.md docs/new.md')).toEqual([`${CWD}/docs/new.md`]);
  });

  it('複製先がディレクトリのときは、対象にならないこと', () => {
    expect(collect('cp docs/a.md backup/')).toEqual([]);
  });
});

describe('作業ディレクトリと変数の解決', () => {
  it('先行する cd の位置を基準に相対パスを解決すること', () => {
    const command = "cd /Users/tester/other && sed -i '' 's/a/b/' SKILL.md";

    expect(collect(command)).toEqual(['/Users/tester/other/SKILL.md']);
  });

  it('同じコマンド内で代入された変数を展開すること', () => {
    const command = ['S=/Users/tester/scratch', 'cat > "$S/note.md" <<EOF', 'x', 'EOF'].join('\n');

    expect(collect(command)).toEqual(['/Users/tester/scratch/note.md']);
  });

  it('チルダを展開すること', () => {
    const command = ["cat > ~/notes/idea.md <<'EOF'", '# 案', 'EOF'].join('\n');

    expect(collect(command)).toEqual([`${homedir()}/notes/idea.md`]);
  });

  it('空白を含むパスが引用符で囲まれていれば対象になること', () => {
    expect(collect(`sed -i '' 's/a/b/' "docs/my notes.md"`)).toEqual([`${CWD}/docs/my notes.md`]);
  });

  it('値の分からない変数を含むパスは対象にしないこと', () => {
    const command = 'for n in 903 904; do sed -i "" "s/x/y/" "$n.md"; done';

    expect(collect(command)).toEqual([]);
  });

  it('グロブを含むパスは対象にしないこと', () => {
    expect(collect("sed -i '' 's/a/b/' docs/*.md")).toEqual([]);
  });
});

describe('スクリプト本文からの検知', () => {
  it('インタプリタのヒアドキュメント内のパスリテラルが対象になること', () => {
    const command = [
      "python3 - <<'PYEOF'",
      "p = '/tmp/issue.md'",
      "open(p, 'w').write('x')",
      'PYEOF',
    ].join('\n');

    expect(collect(command)).toEqual(['/tmp/issue.md']);
  });

  it('-c で渡したスクリプト内のパスリテラルも対象になること', () => {
    const command = `python3 -c "open('docs/a.md','w').write('x')"`;

    expect(collect(command)).toEqual([`${CWD}/docs/a.md`]);
  });

  it('拡張子の比較値はパスとして扱わないこと', () => {
    const command = `python3 -c "print([p for p in files if p.endswith('.md')])"`;

    expect(collect(command)).toEqual([]);
  });

  it('埋め込み前のテンプレート文字列はパスとして扱わないこと', () => {
    const command = `python3 -c "open('{dir}/{name}.md'.format(dir=d), 'w').write(s)"`;

    expect(collect(command)).toEqual([]);
  });

  it('変数へ置いたパスを書き込みに使ったとき、対象になること', () => {
    const command = [
      "python3 - <<'PYEOF'",
      'import pathlib',
      "p = pathlib.Path('docs/a.md')",
      "p.write_text(p.read_text().replace('旧', '新'))",
      'PYEOF',
    ].join('\n');

    expect(collect(command)).toEqual([`${CWD}/docs/a.md`]);
  });

  it('変数へ置いたパスを読み取りにしか使わないとき、対象にならないこと', () => {
    const command = [
      "python3 - <<'PYEOF'",
      "p = 'docs/a.md'",
      'print(open(p).read())',
      'PYEOF',
    ].join('\n');

    expect(collect(command)).toEqual([]);
  });

  it('一覧として並べたファイル名は、書き込み先として扱われないこと', () => {
    const command = [
      "python3 - <<'PYEOF'",
      "targets = ['glossary.md', 'env-vars.md']",
      "open('report.txt', 'w').write(str(targets))",
      'PYEOF',
    ].join('\n');

    expect(collect(command)).toEqual([]);
  });

  it('スクリプトが読み取るだけのとき、本文のパスは対象にならないこと', () => {
    const command = [
      "python3 - <<'PYEOF'",
      'import os',
      "print(os.path.normpath('docs/../docs/a.md'))",
      'PYEOF',
    ].join('\n');

    expect(collect(command)).toEqual([]);
  });

  it('スクリプトが読み込んだ内容を表示するだけのとき、対象にならないこと', () => {
    const command = `python3 -c "print(open('docs/a.md').read())"`;

    expect(collect(command)).toEqual([]);
  });
});

describe('読み取りだけのコマンド', () => {
  it('cat での読み取りは対象にならないこと', () => {
    expect(collect('cat docs/a.md')).toEqual([]);
  });

  it('grep での検索は対象にならないこと', () => {
    expect(collect('grep -rn "TODO" docs/a.md docs/b.md')).toEqual([]);
  });

  it('ヒアストリングをヒアドキュメントと誤認しないこと', () => {
    expect(collect('grep TODO <<< "docs/a.md"')).toEqual([]);
  });

  // touch は内容を変えないので、検知しても変換すべき更新が無い
  it('touch でファイルを作っただけのとき、対象にならないこと', () => {
    expect(collect('touch docs/new.md')).toEqual([]);
  });
});
