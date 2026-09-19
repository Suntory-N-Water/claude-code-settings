import { homedir } from 'node:os';
import { basename, isAbsolute, resolve } from 'node:path';

const TARGET_EXTENSION = '.md';

// 書き込み先がオペランドに現れるコマンド。ここに挙げたものだけを見る。
// コマンド文字列に出てくる .md を無条件に拾うと、grep や cat の読み取り対象まで
// 変換対象になる
const IN_PLACE_EDITORS = new Set(['sed', 'perl', 'ruby']);
// touch は内容を変えないので、検知しても変換すべき更新が無い
const OPERAND_WRITERS = new Set(['tee']);
const COPY_COMMANDS = new Set(['mv', 'cp', 'install', 'rsync']);
// 引数やヒアドキュメントとして渡されたスクリプト本文の中に書き込み先が現れる。
// スクリプトは静的に追えないので本文中の .md リテラルを候補として拾い、
// 実際に書かれたかどうかは呼び出し側の更新時刻チェックに委ねる
const SCRIPT_INTERPRETERS = new Set([
  'python',
  'python3',
  'node',
  'bun',
  'deno',
  'ruby',
  'perl',
  'php',
  'awk',
  'gawk',
]);
// コマンド名の前に置けて、後ろに本来のコマンドが続くもの
const COMMAND_PREFIXES = new Set([
  'env',
  'sudo',
  'nohup',
  'time',
  'command',
  'exec',
  'xargs',
  'nice',
  'stdbuf',
]);

const SEGMENT_SEPARATORS = new Set([
  '&&',
  '||',
  '|',
  '|&',
  '&',
  ';',
  ';;',
  '\n',
  '(',
  ')',
  '{',
  '}',
]);
const REDIRECT_OPERATORS = new Set(['>', '>>', '>|', '&>', '&>>']);
// 長いものから試す。'<<<' を '<<' より先に見ないとヒアストリングを
// ヒアドキュメントと誤認する
const OPERATORS = [
  '&>>',
  '<<<',
  '<<-',
  '&&',
  '||',
  '>>',
  '<<',
  '>|',
  '&>',
  ';;',
  '|&',
  '|',
  '&',
  ';',
  '>',
  '<',
  '(',
  ')',
  '{',
  '}',
];

interface WordToken {
  kind: 'word';
  value: string;
}
interface OpToken {
  kind: 'op';
  value: string;
}
interface HeredocToken {
  kind: 'heredoc';
  body: string;
}
export type Token = WordToken | OpToken | HeredocToken;

interface PendingHeredoc {
  delimiter: string;
  stripTabs: boolean;
  token: HeredocToken;
}

function matchOperator(command: string, index: number): string | undefined {
  return OPERATORS.find((operator) => command.startsWith(operator, index));
}

// $( ) の中は外側とは別の引用の文脈になる。中に出てくる " や ' を外側の
// 引用符の相手と見なすと、語の切れ目がずれる
function commandSubstitutionEnd(command: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < command.length) {
    const char = command[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return index + 1;
      }
    }
    index++;
  }
  return command.length;
}

// ヒアドキュメントの本文はコマンドではなくデータなので、トークン列から切り離す。
// 素通しすると本文中の && や > がコマンドの構造として解釈される
function consumeHeredocBodies(
  command: string,
  start: number,
  pending: PendingHeredoc[],
): number {
  let index = start;
  for (const heredoc of pending) {
    const lines: string[] = [];
    let closed = false;
    while (index < command.length) {
      const lineEnd = command.indexOf('\n', index);
      const line = command.slice(
        index,
        lineEnd === -1 ? command.length : lineEnd,
      );
      index = lineEnd === -1 ? command.length : lineEnd + 1;
      const candidate = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
      if (candidate === heredoc.delimiter) {
        closed = true;
        break;
      }
      lines.push(line);
    }
    heredoc.token.body = lines.join('\n');
    if (!closed) {
      break;
    }
  }
  pending.length = 0;
  return index;
}

export function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  const pending: PendingHeredoc[] = [];
  let word = '';
  let hasWord = false;
  let awaitingDelimiter:
    | { stripTabs: boolean; token: HeredocToken }
    | undefined;
  let index = 0;

  const flushWord = (): void => {
    if (!hasWord) {
      return;
    }
    if (awaitingDelimiter !== undefined) {
      pending.push({
        delimiter: word,
        stripTabs: awaitingDelimiter.stripTabs,
        token: awaitingDelimiter.token,
      });
      awaitingDelimiter = undefined;
    } else {
      tokens.push({ kind: 'word', value: word });
    }
    word = '';
    hasWord = false;
  };

  while (index < command.length) {
    const char = command[index] ?? '';
    if (char === "'") {
      const end = command.indexOf("'", index + 1);
      const close = end === -1 ? command.length : end;
      word += command.slice(index + 1, close);
      hasWord = true;
      index = close + 1;
      continue;
    }
    if (char === '"') {
      index++;
      hasWord = true;
      while (index < command.length && command[index] !== '"') {
        if (command[index] === '\\' && index + 1 < command.length) {
          const next = command[index + 1] ?? '';
          word += '\\$`"'.includes(next) ? next : `\\${next}`;
          index += 2;
          continue;
        }
        if (command[index] === '$' && command[index + 1] === '(') {
          const end = commandSubstitutionEnd(command, index + 2);
          word += command.slice(index, end);
          index = end;
          continue;
        }
        word += command[index];
        index++;
      }
      index++;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      const next = command[index + 1] ?? '';
      // 行継続は区切りではないので単語も切らない
      if (next !== '\n') {
        word += next;
        hasWord = true;
      }
      index += 2;
      continue;
    }
    if (char === '\n') {
      flushWord();
      tokens.push({ kind: 'op', value: '\n' });
      index++;
      if (pending.length > 0) {
        index = consumeHeredocBodies(command, index, pending);
      }
      continue;
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      flushWord();
      index++;
      continue;
    }
    const operator = matchOperator(command, index);
    if (operator !== undefined) {
      flushWord();
      if (operator === '<<' || operator === '<<-') {
        const token: HeredocToken = { kind: 'heredoc', body: '' };
        tokens.push(token);
        awaitingDelimiter = { stripTabs: operator === '<<-', token };
      } else {
        tokens.push({ kind: 'op', value: operator });
      }
      index += operator.length;
      continue;
    }
    word += char;
    hasWord = true;
    index++;
  }
  flushWord();
  if (pending.length > 0) {
    consumeHeredocBodies(command, index, pending);
  }
  return tokens;
}

export function splitSegments(tokens: Token[]): Token[][] {
  const segments: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === 'op' && SEGMENT_SEPARATORS.has(token.value)) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  segments.push(current);
  return segments.filter((segment) => segment.length > 0);
}

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;
// 未解決の変数はこの印に置き換える。空白を印にするとスペース入りのパスを
// 未解決と誤判定するため、パスに現れない文字を使う
const UNRESOLVED = '\u0000';

// 展開できない値は候補にしない。$n のようなループ変数まで当てずっぽうで
// 埋めると、存在しないパスや無関係なファイルを掴む
function expand(value: string, vars: Map<string, string>): string | undefined {
  let result = value;
  if (result === '~' || result.startsWith('~/')) {
    result = homedir() + result.slice(1);
  }
  result = result.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_whole, braced?: string, bare?: string) =>
      vars.get(braced ?? bare ?? '') ?? UNRESOLVED,
  );
  if (
    result.includes(UNRESOLVED) ||
    result.includes('$') ||
    result.includes('`') ||
    /[*?[\]]/.test(result)
  ) {
    return undefined;
  }
  return result;
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith(TARGET_EXTENSION);
}

// スクリプト本文の走査は拡張子の比較値('.md')や、埋め込み前のテンプレート
// ('{dir}/{name}.md')まで拾ってしまう。パスとして成立しないものはここで落とす
function isPlausiblePath(path: string): boolean {
  if (!isMarkdown(path) || /[{}]/.test(path)) {
    return false;
  }
  return basename(path) !== TARGET_EXTENSION;
}

// スクリプト本文に現れる .md は、読み取り対象・一覧のデータ・比較用の値など
// 書き込み先以外の方が多い。書き込みに使われたと読み取れる形のものだけを拾う

// open('doc.md', 'w') のように、その場で書き込みモードを指定している形
const DIRECT_WRITE_OPEN =
  /\bopen\s*\(\s*(['"])([^'"\n]*\.md)\1\s*,[^)]*['"][wax]/gi;
// writeFileSync('doc.md', ...) や Path('doc.md').write_text(...) のように、
// 書き込み関数へ直接パスを渡している形
const DIRECT_WRITE_CALL =
  /(?:writeFileSync|Bun\.write|appendFileSync)\s*\(\s*(['"])([^'"\n]*\.md)\1|(['"])([^'"\n]*\.md)\3\s*\)\s*\.\s*write/gi;
// p = 'doc.md' のように、いったん変数へ置く形。書き込みに使われたかは別で確かめる
const PATH_ASSIGNMENT =
  /([A-Za-z_]\w*)\s*=\s*(?:[A-Za-z_][\w.]*\s*\(\s*)?(['"])([^'"\n]*\.md)\2/g;

function isWrittenThrough(script: string, variable: string): boolean {
  const used = new RegExp(
    [
      // p.write_text(...) / p.write(...)
      `\\b${variable}\\s*\\.\\s*write`,
      // open(p, 'w')
      `\\bopen\\s*\\(\\s*${variable}\\s*,[^)]*['"][wax]`,
      // writeFileSync(p, ...) / f.write_text(p) 等、書き込み関数の引数
      `write\\w*\\s*\\(\\s*${variable}\\b`,
    ].join('|'),
  );
  return used.test(script);
}

function markdownLiteralsIn(script: string): string[] {
  const found = [
    ...[...script.matchAll(DIRECT_WRITE_OPEN)].map((match) => match[2] ?? ''),
    ...[...script.matchAll(DIRECT_WRITE_CALL)].map(
      (match) => match[2] ?? match[4] ?? '',
    ),
  ];
  for (const match of script.matchAll(PATH_ASSIGNMENT)) {
    if (isWrittenThrough(script, match[1] ?? '')) {
      found.push(match[3] ?? '');
    }
  }
  return found;
}

function hasInPlaceFlag(operands: string[]): boolean {
  return operands.some(
    (operand) =>
      /^-[a-zA-Z]*i/.test(operand) || operand.startsWith('--in-place'),
  );
}

interface Segment {
  commandName: string | undefined;
  operands: string[];
  redirects: string[];
  scripts: string[];
  assignments: [string, string][];
}

function readSegment(tokens: Token[]): Segment {
  const words: string[] = [];
  const redirects: string[] = [];
  const scripts: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token.kind === 'heredoc') {
      scripts.push(token.body);
      continue;
    }
    if (token.kind === 'op') {
      const next = tokens[index + 1];
      if (REDIRECT_OPERATORS.has(token.value) && next?.kind === 'word') {
        redirects.push(next.value);
        index++;
      }
      continue;
    }
    words.push(token.value);
  }

  const assignments: [string, string][] = [];
  let cursor = 0;
  while (cursor < words.length) {
    const match = ASSIGNMENT.exec(words[cursor] ?? '');
    if (match === null) {
      break;
    }
    assignments.push([match[1] ?? '', match[2] ?? '']);
    cursor++;
  }
  while (
    cursor < words.length &&
    COMMAND_PREFIXES.has(basename(words[cursor] ?? ''))
  ) {
    cursor++;
    while ((words[cursor] ?? '').startsWith('-')) {
      cursor++;
    }
  }
  const commandName =
    cursor < words.length ? basename(words[cursor] ?? '') : undefined;
  return {
    commandName,
    operands: words.slice(cursor + 1),
    redirects,
    scripts,
    assignments,
  };
}

/**
 * Bash コマンドが書き換えた可能性のある Markdown ファイルの絶対パスを返す。
 *
 * 書き込み位置に現れたパスだけを候補にするが、スクリプト本文由来の候補には
 * 読み取り専用のパスも混ざる。実際に書かれたかは呼び出し側で更新時刻を見て判定する
 */
export function collectMarkdownWriteTargets(
  command: string,
  cwd: string,
): string[] {
  const vars = new Map<string, string>([['HOME', homedir()]]);
  const targets = new Set<string>();
  let directory = cwd;

  const add = (raw: string | undefined): void => {
    if (raw === undefined || !isPlausiblePath(raw)) {
      return;
    }
    targets.add(isAbsolute(raw) ? raw : resolve(directory, raw));
  };
  const addAll = (raws: string[]): void => {
    for (const raw of raws) {
      add(expand(raw, vars));
    }
  };

  for (const tokens of splitSegments(tokenize(command))) {
    const segment = readSegment(tokens);
    for (const [name, value] of segment.assignments) {
      const expanded = expand(value, vars);
      if (expanded !== undefined) {
        vars.set(name, expanded);
      }
    }
    addAll(segment.redirects);

    const name = segment.commandName;
    if (name === undefined) {
      continue;
    }
    const operands = segment.operands;
    if (name === 'cd') {
      const moved = expand(
        operands.find((operand) => !operand.startsWith('-')) ?? '',
        vars,
      );
      if (moved !== undefined && moved !== '') {
        directory = isAbsolute(moved) ? moved : resolve(directory, moved);
      }
      continue;
    }
    if (name === 'export') {
      for (const operand of operands) {
        const match = ASSIGNMENT.exec(operand);
        if (match === null) {
          continue;
        }
        const expanded = expand(match[2] ?? '', vars);
        if (expanded !== undefined) {
          vars.set(match[1] ?? '', expanded);
        }
      }
      continue;
    }
    if (
      OPERAND_WRITERS.has(name) ||
      (IN_PLACE_EDITORS.has(name) && hasInPlaceFlag(operands))
    ) {
      // sed / perl のスクリプト本体が .md で終わることはまず無いので、
      // ファイル引数とスクリプト引数を区別せずに .md だけ拾う
      addAll(operands);
    }
    if (COPY_COMMANDS.has(name)) {
      // 宛先がディレクトリのときは、そこに入るファイル名を組み立てられるが、
      // 拡張子の無いファイルへの複製と区別が付かないので複製元を当てにしない
      const positional = operands.filter((operand) => !operand.startsWith('-'));
      addAll(positional.slice(-1));
    }
    if (SCRIPT_INTERPRETERS.has(name)) {
      for (const script of [...segment.scripts, ...operands]) {
        addAll(markdownLiteralsIn(script));
      }
    }
  }
  return [...targets];
}
