import { describe, expect, test } from 'bun:test';
import { formatReport, formatStopReport } from './report.ts';
import type { Violation } from './rules.ts';

const severe: Violation = {
  ruleId: 'empty-adjective-emphasis',
  category: '空虚な形容',
  severity: 'severe',
  matched: '核心的',
  sentence: '型定義は核心的である。',
  good: '何が無いと何ができなくなるかを書く',
};

const warning: Violation = {
  ruleId: 'jargon-contract',
  category: '過去の指摘',
  severity: 'warning',
  matched: '契約',
  sentence: 'この関数の契約を決める。',
  good: '入出力の取り決めをそのまま書く',
};

describe('差し戻しの文面', () => {
  test('該当文と書き直し方が示されること', () => {
    const report = formatReport('/a/b.md', [warning, severe]);

    expect(report).toContain(`[error] ${severe.sentence}`);
    expect(report).toContain(`  ${warning.matched}: ${warning.good}`);
  });

  test('どちらがターンを止めるかが示されること', () => {
    const report = formatReport('/a/b.md', [severe]);

    expect(report).toContain('error は修正必須');
  });

  test('重大が先に並ぶこと', () => {
    const report = formatReport('/a/b.md', [warning, severe]);

    expect(report.indexOf('[error]')).toBeLessThan(report.indexOf('[warning]'));
  });

  test('語だけの置換を禁じる指示が入ること', () => {
    const report = formatReport('/a/b.md', [severe]);

    expect(report).toContain('検出語だけの同義語置換は禁止');
  });

  // dash ルールを rules.ts でコメントアウトしている間は 'dash' が RuleId に無い
  // test('1 文に複数の指摘が当たると、該当文が 1 度だけ出ること', () => {
  //   const dash: Violation = {
  //     ruleId: 'dash',
  //     category: '記号',
  //     severity: 'severe',
  //     matched: '—',
  //     sentence: 'この設定 — これが効きます。',
  //     good: '括弧()にする',
  //   };
  //   const kikimasu: Violation = {
  //     ruleId: 'kikimasu',
  //     category: '比喩の動詞',
  //     severity: 'severe',
  //     matched: '効きます',
  //     sentence: dash.sentence,
  //     good: '何がどう作用したかを書く',
  //   };
  //
  //   const report = formatReport('/a/b.md', [dash, kikimasu]);
  //
  //   expect(report.split(dash.sentence)).toHaveLength(2);
  //   expect(report).toContain(`  ${dash.matched}: ${dash.good}`);
  //   expect(report).toContain(`  ${kikimasu.matched}: ${kikimasu.good}`);
  // });

  test('同じ規則が別の文に当たると、2 度目の書き直し方が省かれること', () => {
    const second: Violation = {
      ...warning,
      sentence: 'あの関数の契約も決める。',
    };

    const report = formatReport('/a/b.md', [warning, second]);

    expect(report).toContain(`  ${warning.matched}: ${warning.good}`);
    expect(report).toContain(`  ${warning.matched}: 上と同じ`);
    expect(report.split(warning.good)).toHaveLength(2);
  });

  test('同じ文字列の文が別の箇所にあっても、1 つにまとまること', () => {
    const report = formatReport('/a/b.md', [warning, { ...warning }]);

    expect(report.split(warning.sentence)).toHaveLength(2);
    expect(report).not.toContain('上と同じ');
  });

  test('指摘が多い時、打ち切って省略件数が示されること', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      ...warning,
      sentence: `${index + 1} 番の文です。`,
    }));

    const report = formatReport('/a/b.md', many);

    expect(report).toContain('文は省略しました。');
    expect(report).not.toContain('30 番の文です。');
  });
});

describe('ターン終了時の文面', () => {
  test('ファイルごとの該当文が並ぶこと', () => {
    const report = formatStopReport([{ filePath: '/a/b.md', sentences: [severe.sentence] }]);

    expect(report).toContain('/a/b.md');
    expect(report).toContain(`  ${severe.sentence}`);
  });
});
