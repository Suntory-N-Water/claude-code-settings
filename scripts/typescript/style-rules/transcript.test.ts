import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readTurnText } from './transcript.ts';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(import.meta.dir, '.transcript-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function userPrompt(text: string) {
  return { type: 'user', message: { role: 'user', content: text } };
}

function toolResult() {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
    },
  };
}

function assistant(text: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  };
}

async function writeTranscript(entries: unknown[]): Promise<string> {
  const path = join(workspace, 'transcript.jsonl');
  await Bun.write(path, entries.map((entry) => JSON.stringify(entry)).join('\n'));
  return path;
}

test('ファイルが無い時、空文字を返すこと', async () => {
  expect(await readTurnText(join(workspace, 'none.jsonl'))).toBe('');
});

test('直前の入力より後の assistant 発言だけを、書かれた順に返すこと', async () => {
  const path = await writeTranscript([
    userPrompt('前の質問'),
    assistant('前の返答'),
    userPrompt('今回の質問'),
    assistant('最初の返答'),
    assistant('次の返答'),
  ]);

  expect(await readTurnText(path)).toBe('最初の返答\n\n次の返答');
});

test('ツールの返り値をまたいだ発言も同じターンとして拾うこと', async () => {
  const path = await writeTranscript([
    userPrompt('今回の質問'),
    assistant('調べます'),
    toolResult(),
    assistant('分かりました'),
  ]);

  expect(await readTurnText(path)).toBe('調べます\n\n分かりました');
});

test('thinking と tool_use は返さないこと', async () => {
  const path = await writeTranscript([
    userPrompt('今回の質問'),
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '考え中' },
          { type: 'tool_use', name: 'Bash', input: {} },
          { type: 'text', text: '返答' },
        ],
      },
    },
  ]);

  expect(await readTurnText(path)).toBe('返答');
});

test('subagent の発言は返さないこと', async () => {
  const path = await writeTranscript([
    userPrompt('今回の質問'),
    assistant('subagent の返答', { isSidechain: true }),
    assistant('本体の返答'),
  ]);

  expect(await readTurnText(path)).toBe('本体の返答');
});

test('中断の記録も入力として扱い、そこで打ち切ること', async () => {
  const path = await writeTranscript([
    assistant('中断前の返答'),
    {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
      },
    },
    assistant('中断後の返答'),
  ]);

  expect(await readTurnText(path)).toBe('中断後の返答');
});

test('壊れた行があっても他の行を読めること', async () => {
  const path = join(workspace, 'broken.jsonl');
  await Bun.write(
    path,
    [
      JSON.stringify(userPrompt('今回の質問')),
      '{ 壊れた行',
      '',
      JSON.stringify(assistant('返答')),
    ].join('\n'),
  );

  expect(await readTurnText(path)).toBe('返答');
});
