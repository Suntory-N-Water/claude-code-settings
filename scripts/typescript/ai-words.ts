#!/usr/bin/env bun
import { dirname, join } from 'node:path';
import { tokenize } from 'kuromojin';
import { createLinter, loadTextlintrc } from 'textlint';

const ROOT = dirname(dirname(import.meta.dir));

async function runTokenize(texts: string[]): Promise<void> {
  for (const text of texts) {
    process.stdout.write(`# ${text}\n`);
    const tokens = await tokenize(text);
    for (const [index, token] of tokens.entries()) {
      const fields = [
        `surface_form=${token.surface_form}`,
        `pos=${token.pos}`,
        `pos_detail_1=${token.pos_detail_1}`,
        `basic_form=${token.basic_form}`,
        `conjugated_form=${token.conjugated_form}`,
      ];
      process.stdout.write(`${index}\t${fields.join('\t')}\n`);
    }
  }
}

async function runLint(texts: string[]): Promise<void> {
  const descriptor = await loadTextlintrc({
    configFilePath: join(ROOT, '.textlintrc.json'),
    node_modulesDir: join(ROOT, 'node_modules'),
  });
  const linter = createLinter({ descriptor });

  for (const text of texts) {
    process.stdout.write(`# ${text}\n`);
    const result = await linter.lintText(
      text,
      join(ROOT, 'ai-words-sample.md'),
    );
    if (result.messages.length === 0) {
      process.stdout.write('指摘なし\n');
      continue;
    }
    for (const { line, column, ruleId, message } of result.messages) {
      process.stdout.write(`${line}:${column}\t${message}\t(${ruleId})\n`);
    }
  }
}

const [command, ...texts] = process.argv.slice(2);

if (command !== 'tokens' && command !== 'lint') {
  process.stderr.write(
    'usage: ai-words.ts <tokens|lint> "例文" ["例文" ...]\n' +
      '  tokens: kuromoji の形態素を表示する (辞書の tokens を書くときに使う)\n' +
      '  lint:   .textlintrc.json の設定で例文を textlint にかける\n',
  );
  process.exit(2);
}

if (texts.length === 0) {
  process.stderr.write('例文を 1 つ以上渡してください\n');
  process.exit(2);
}

if (command === 'tokens') {
  await runTokenize(texts);
} else {
  await runLint(texts);
}
