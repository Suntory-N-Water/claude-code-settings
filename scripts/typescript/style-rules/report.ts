import type { RuleId, Severity, Violation } from './rules.ts';

const MAX_GROUPS = 8;

// tsc や eslint と同じ語にして、どちらがターンを止めるかを既知の意味に乗せる
const SEVERITY_LABEL = { severe: 'error', warning: 'warning' } as const;

// 語だけ置き換えると別の語形で同じ問題が残り、文が壊れる。丸ごと書き直させる
const REWRITE_INSTRUCTION = '該当文を丸ごと書き直す。検出語だけの同義語置換は禁止。';
const SEVERITY_INSTRUCTION = 'error は修正必須(未修正だとターンを終了できない)、warning は任意。';
const REPEATED_GOOD = '上と同じ';

interface Hit {
  ruleId: RuleId;
  matched: string;
  good: string;
}

interface Group {
  sentence: string;
  severity: Severity;
  hits: Hit[];
}

// 1 文に複数の指摘が当たる。文ごとにまとめないと指摘の数だけ部分修正を促してしまう
function groupBySentence(violations: Violation[]): Group[] {
  const groups = new Map<string, Group>();
  for (const violation of violations) {
    const hit: Hit = {
      ruleId: violation.ruleId,
      matched: violation.matched,
      good: violation.good,
    };
    const group = groups.get(violation.sentence);
    if (group === undefined) {
      groups.set(violation.sentence, {
        sentence: violation.sentence,
        severity: violation.severity,
        hits: [hit],
      });
      continue;
    }
    // 同じ文字列の文が別々の箇所にあると同じ指摘が二重に届く
    if (group.hits.some((existing) => existing.ruleId === hit.ruleId)) {
      continue;
    }
    if (violation.severity === 'severe') {
      group.severity = 'severe';
    }
    group.hits.push(hit);
  }
  return [...groups.values()];
}

function markRepeated(groups: Group[]): Group[] {
  const shownRules = new Set<RuleId>();
  return groups.map((group) => ({
    ...group,
    hits: group.hits.map((hit) => {
      const repeated = shownRules.has(hit.ruleId);
      shownRules.add(hit.ruleId);
      return repeated ? { ...hit, good: REPEATED_GOOD } : hit;
    }),
  }));
}

function formatGroup(group: Group): string {
  return [
    `[${SEVERITY_LABEL[group.severity]}] ${group.sentence}`,
    ...group.hits.map((hit) => `  ${hit.matched}: ${hit.good}`),
  ].join('\n');
}

export function formatReport(filePath: string, violations: Violation[]): string {
  const groups = groupBySentence(violations);
  const ordered = [
    ...groups.filter((group) => group.severity === 'severe'),
    ...groups.filter((group) => group.severity === 'warning'),
  ];
  const shown = markRepeated(ordered.slice(0, MAX_GROUPS));
  const omitted = ordered.length - shown.length;

  const lines = [
    `style-check ${filePath}`,
    REWRITE_INSTRUCTION,
    SEVERITY_INSTRUCTION,
    '',
    ...shown.map(formatGroup),
  ];
  if (omitted > 0) {
    lines.push('', `ほか ${omitted} 文は省略しました。`);
  }
  return lines.join('\n');
}

export function formatStopReport(entries: { filePath: string; sentences: string[] }[]): string {
  const lines = ['style-check: error が未修正のまま残っています。', REWRITE_INSTRUCTION, ''];
  for (const entry of entries) {
    lines.push(entry.filePath);
    for (const sentence of entry.sentences) {
      lines.push(`  ${sentence}`);
    }
  }
  return lines.join('\n');
}
