import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const POST_SCRIPT = join(import.meta.dir, 'textlint-post-tool-use.ts');
const STOP_SCRIPT = join(import.meta.dir, 'textlint-edits-stop.ts');
const SESSION_ID = 'textlint-edits-stop-test';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(import.meta.dir, '.textlint-edits-stop-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function run(script: string, input: unknown): Promise<string> {
  const proc = Bun.spawn(['bun', 'run', script], {
    env: { ...process.env, TEXTLINT_CHECK_STORE_ROOT: join(workspace, 'store') },
    stdin: new TextEncoder().encode(JSON.stringify(input)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

// Edit の後のファイルを書いてから、記録のフックに Edit を渡す
async function edit(filePath: string, after: string, oldString: string, newString: string) {
  await writeFile(filePath, after);
  await run(POST_SCRIPT, {
    hook_event_name: 'PostToolUse',
    session_id: SESSION_ID,
    transcript_path: join(workspace, 'transcript.jsonl'),
    cwd: workspace,
    tool_name: 'Edit',
    tool_use_id: 'toolu_textlint_test',
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
    tool_response: {},
  });
}

function stop(stopHookActive = false): Promise<string> {
  return run(STOP_SCRIPT, {
    hook_event_name: 'Stop',
    session_id: SESSION_ID,
    transcript_path: join(workspace, 'transcript.jsonl'),
    cwd: workspace,
    stop_hook_active: stopHookActive,
  });
}

const reportPath = () => join(workspace, 'store', `${SESSION_ID}-report.md`);

describe('textlint Stop hook', () => {
  test('ターンの編集で指摘が増えたとき、指摘を報告のファイルに書き出し、そのパスを Claude に返すこと', async () => {
    const filePath = join(workspace, 'doc.md');
    await edit(filePath, '処理の入口を用意します。\n', '用意', '入口を用意');

    const stdout = await stop();

    expect(JSON.parse(stdout)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(reportPath()),
    });
    expect(await Bun.file(reportPath()).text()).toContain('入口');
  });

  test('ターンの編集で指摘が増えなかったとき、何も返さないこと', async () => {
    const filePath = join(workspace, 'doc.md');
    await edit(filePath, '処理の入口を用意します。\n', '追加します', '用意します');

    const stdout = await stop();

    expect(stdout).toBe('');
  });

  test('1 ターンで同じファイルを 2 回編集したとき、1 回目の編集の前の本文と比べること', async () => {
    const filePath = join(workspace, 'doc.md');
    await edit(filePath, '処理の入口を用意します。\n', '用意', '入口を用意');
    await edit(filePath, '処理の入口を準備します。\n', '用意', '準備');

    const stdout = await stop();

    expect(JSON.parse(stdout)).toMatchObject({ decision: 'block' });
  });

  test('Markdown の編集で書き方の規則に反する文が増えたとき、その文を報告のファイルに書き出し、Claude に差し戻すこと', async () => {
    const filePath = join(workspace, 'doc.md');
    await edit(
      filePath,
      '# 方針\n\nこれは根本的な問題です。\n',
      '値を用意します。',
      'これは根本的な問題です。',
    );

    const stdout = await stop();

    expect(JSON.parse(stdout)).toMatchObject({ decision: 'block' });
    expect(await Bun.file(reportPath()).text()).toContain('これは根本的な問題です。');
  });

  test('書き方の規則に反する文が編集の前からあったとき、その文を報告しないこと', async () => {
    const filePath = join(workspace, 'doc.md');
    await edit(
      filePath,
      '# 方針\n\nこれは根本的な問題です。\n\n値を準備します。\n',
      '値を用意します。',
      '値を準備します。',
    );

    const stdout = await stop();

    expect(stdout).toBe('');
  });

  test('TypeScript のファイルの編集では、書き方の規則をかけないこと', async () => {
    const filePath = join(workspace, 'code.ts');
    await edit(
      filePath,
      '// これは根本的な問題です。\nexport const a = 1;\n',
      '値を用意します。',
      'これは根本的な問題です。',
    );

    const stdout = await stop();

    expect(stdout).toBe('');
  });

  test('そのターンですでに指摘を返したとき、再び返さずに記録を消すこと', async () => {
    const filePath = join(workspace, 'doc.md');
    await edit(filePath, '処理の入口を用意します。\n', '用意', '入口を用意');

    const active = await stop(true);
    const next = await stop();

    expect(active).toBe('');
    expect(next).toBe('');
  });
});
