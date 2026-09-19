import {
  splitSegments,
  type Token,
  tokenize,
} from './md-to-html/bash-targets.ts';

export type MessageSource =
  | { kind: 'text'; text: string }
  | { kind: 'file'; path: string };

export interface MessageTarget {
  label: string;
  // textlint はファイル名の拡張子でプロセッサを選ぶ。コミットメッセージを
  // markdown として読ませると、箇条書きや先頭の # が構造として解釈される
  format: 'markdown' | 'text';
  source: MessageSource;
}

// コマンド名の前に置けて、後ろに本来のコマンドが続くもの
const COMMAND_PREFIXES = new Set([
  'env',
  'sudo',
  'nohup',
  'time',
  'command',
  'exec',
  'nice',
  'stdbuf',
  'rtk',
]);
// rtk は本来のコマンドの前にサブコマンドを挟む形も取る
const RTK_SUBCOMMANDS = new Set(['proxy', 'run', 'exec']);
// 値を後ろに取る git のグローバルオプション。サブコマンドの位置を読み違えないため
const GIT_VALUE_FLAGS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);
// 本文をコマンドラインから渡せる gh のサブコマンド。view や list は読み出しだけ
const GH_WRITE_ACTIONS = new Set(['create', 'edit', 'comment']);
const GH_RESOURCE_NAMES = { pr: 'PR', issue: 'Issue' } as const;
type GhResource = keyof typeof GH_RESOURCE_NAMES;

function isGhResource(value: string | undefined): value is GhResource {
  return value !== undefined && value in GH_RESOURCE_NAMES;
}
// git がコミットに残さない行。定型文なので指摘の対象から外す
const TRAILER_LINE = /^(?:co-authored-by:|signed-off-by:|🤖 generated with )/iu;
// $(cat <<'EOF' ... EOF) で本文を渡す形。トークナイザは二重引用符の中身を
// そのまま 1 語として返すので、ここで中身を取り出す
const CAT_HEREDOC =
  /^\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n?\2\s*\)$/u;

interface Segment {
  words: string[];
  heredocs: string[];
}

function readSegment(tokens: Token[]): Segment {
  const words: string[] = [];
  const heredocs: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'heredoc') {
      heredocs.push(token.body);
    } else if (token.kind === 'word') {
      words.push(token.value);
    }
  }
  return { words, heredocs };
}

function stripPrefixes(words: string[]): string[] {
  let cursor = 0;
  while (cursor < words.length && COMMAND_PREFIXES.has(words[cursor] ?? '')) {
    const isRtk = words[cursor] === 'rtk';
    cursor++;
    while ((words[cursor] ?? '').startsWith('-')) {
      cursor++;
    }
    if (isRtk && RTK_SUBCOMMANDS.has(words[cursor] ?? '')) {
      cursor++;
    }
  }
  return words.slice(cursor);
}

function subcommandsOf(words: string[], depth: number): string[] {
  const found: string[] = [];
  for (let index = 1; index < words.length && found.length < depth; index++) {
    const word = words[index] ?? '';
    if (GIT_VALUE_FLAGS.has(word)) {
      index++;
      continue;
    }
    if (word.startsWith('-')) {
      continue;
    }
    found.push(word);
  }
  return found;
}

function flagValues(words: string[], long: string, short?: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? '';
    if (word === '--') {
      break;
    }
    if (word === long || (short !== undefined && word === short)) {
      const next = words[index + 1];
      if (next !== undefined) {
        values.push(next);
        index++;
      }
      continue;
    }
    if (word.startsWith(`${long}=`)) {
      values.push(word.slice(long.length + 1));
      continue;
    }
    // -F- のように短いオプションへ値を続けて書ける。--message= と紛れないよう
    // 2 文字の短いオプションに限る
    if (
      short !== undefined &&
      !word.startsWith('--') &&
      word.startsWith(short) &&
      word.length > short.length
    ) {
      values.push(word.slice(short.length));
    }
  }
  return values;
}

/**
 * シェルの語から、検査できる本文を取り出す。
 *
 * 変数やコマンド置換はここでは展開できない。中身の分からない文字列をそのまま
 * 検査すると指摘が当てにならないので、読めない語は捨てる
 */
export function resolveWord(value: string): string | undefined {
  const heredoc = CAT_HEREDOC.exec(value);
  if (heredoc !== null) {
    return heredoc[3] ?? '';
  }
  if (value.includes('$') || value.includes('`')) {
    return undefined;
  }
  return value;
}

export function stripTrailers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !TRAILER_LINE.test(line.trim()))
    .join('\n')
    .trim();
}

function toTextSource(
  raw: string | undefined,
): { kind: 'text'; text: string } | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = stripTrailers(raw);
  return text === '' ? undefined : { kind: 'text', text };
}

// -F や --body-file は '-' で標準入力を指す。渡し方はヒアドキュメントに限られる
function fileSource(
  value: string,
  heredocs: string[],
): MessageSource | undefined {
  if (value !== '-') {
    return { kind: 'file', path: value };
  }
  const body = heredocs[0];
  return body === undefined ? undefined : toTextSource(body);
}

function commitTargets(segment: Segment): MessageTarget[] {
  const targets: MessageTarget[] = [];
  const messages = flagValues(segment.words, '--message', '-m')
    .map(resolveWord)
    .filter((value) => value !== undefined);
  // -m を並べると git は空行で連結して 1 つのメッセージにする
  const joined = toTextSource(
    messages.length === 0 ? undefined : messages.join('\n\n'),
  );
  if (joined !== undefined) {
    targets.push({
      label: 'コミットメッセージ',
      format: 'text',
      source: joined,
    });
  }

  for (const raw of flagValues(segment.words, '--file', '-F')) {
    const value = resolveWord(raw);
    if (value === undefined) {
      continue;
    }
    const source = fileSource(value, segment.heredocs);
    if (source !== undefined) {
      targets.push({
        label: 'コミットメッセージ',
        format: 'text',
        source,
      });
    }
  }
  return targets;
}

function ghTargets(
  segment: Segment,
  resource: GhResource,
  action: string,
): MessageTarget[] {
  const name = GH_RESOURCE_NAMES[resource];
  const bodyLabel =
    action === 'comment' ? `${name} のコメント` : `${name} の本文`;
  const targets: MessageTarget[] = [];

  for (const raw of flagValues(segment.words, '--title', '-t')) {
    const source = toTextSource(resolveWord(raw));
    if (source !== undefined) {
      targets.push({ label: `${name} のタイトル`, format: 'text', source });
    }
  }
  for (const raw of flagValues(segment.words, '--body', '-b')) {
    const source = toTextSource(resolveWord(raw));
    if (source !== undefined) {
      targets.push({ label: bodyLabel, format: 'markdown', source });
    }
  }
  for (const raw of flagValues(segment.words, '--body-file', '-F')) {
    const value = resolveWord(raw);
    if (value === undefined) {
      continue;
    }
    const source = fileSource(value, segment.heredocs);
    if (source !== undefined) {
      targets.push({ label: bodyLabel, format: 'markdown', source });
    }
  }
  return targets;
}

/**
 * Bash コマンドが git / gh へ渡すメッセージを取り出す。
 *
 * 取り出せるのは書き手が直接書いた文字列だけで、変数やコマンド置換の結果は含まない
 */
export function collectMessageTargets(command: string): MessageTarget[] {
  const targets: MessageTarget[] = [];
  for (const tokens of splitSegments(tokenize(command))) {
    const segment = readSegment(tokens);
    const words = stripPrefixes(segment.words);
    const head = words[0];
    if (head === 'git') {
      if (subcommandsOf(words, 1)[0] === 'commit') {
        targets.push(...commitTargets({ ...segment, words }));
      }
      continue;
    }
    if (head === 'gh') {
      const [resource, action] = subcommandsOf(words, 2);
      if (
        isGhResource(resource) &&
        action !== undefined &&
        GH_WRITE_ACTIONS.has(action)
      ) {
        targets.push(...ghTargets({ ...segment, words }, resource, action));
      }
    }
  }
  return targets;
}
