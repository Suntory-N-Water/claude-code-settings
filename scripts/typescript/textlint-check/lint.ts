import { dirname, extname, join } from 'node:path';
import type { TextlintResult } from '@textlint/types';

// 設定と辞書は ~/.claude 直下にある。このファイルは scripts/typescript/textlint-check にあるので 3 階層上がる
const ROOT = dirname(dirname(dirname(import.meta.dir)));

export type TextlintFinding = Pick<
  TextlintResult['messages'][number],
  'ruleId' | 'message' | 'line' | 'column'
>;

type Linter = {
  lintText(text: string, filePath: string): Promise<TextlintResult>;
};

let linterPromise: Promise<Linter> | undefined;

// textlint と辞書は読み込むだけで約 380MB を使う。指摘を確かめるときまで読み込まない
function loadLinter(): Promise<Linter> {
  linterPromise ??= (async () => {
    const { createLinter, loadTextlintrc } = await import('textlint');
    const descriptor = await loadTextlintrc({
      configFilePath: join(ROOT, '.textlintrc.json'),
      node_modulesDir: join(ROOT, 'node_modules'),
    });
    return createLinter({ descriptor });
  })();
  return linterPromise;
}

export const CODE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

export async function lintFile(text: string, filePath: string): Promise<TextlintFinding[]> {
  // textlint は JS/TS を読むプラグインを持たず、拡張子のまま渡すと例外になる。
  // 辞書の語は日本語なので、プレーンテキストとして読ませてもコード部分は誤検出しない
  const lintPath = CODE_EXTENSIONS.has(extname(filePath).toLowerCase())
    ? `${filePath}.txt`
    : filePath;
  const linter = await loadLinter();
  return (await linter.lintText(text, lintPath)).messages;
}

function findingKey(finding: TextlintFinding): string {
  return `${finding.ruleId}\0${finding.message}`;
}

export function introducedFindings(
  before: readonly TextlintFinding[],
  after: readonly TextlintFinding[],
): TextlintFinding[] {
  const remaining = new Map<string, number>();
  for (const finding of before) {
    const key = findingKey(finding);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const introduced: TextlintFinding[] = [];
  for (const finding of after) {
    const key = findingKey(finding);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      introduced.push(finding);
    }
  }
  return introduced;
}
