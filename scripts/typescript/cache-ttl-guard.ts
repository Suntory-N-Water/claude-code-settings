#!/usr/bin/env -S bun run --silent
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { defineHook, runHook } from 'cc-hooks-ts';
import { join } from 'pathe';

const STATE_DIR = join(homedir(), '.claude', 'cache-ttl');
const HOUR_MS = 60 * 60 * 1000;
// promptCacheTtl が 1h なので、これを超えた入力は履歴全体の書き直しになる
const THRESHOLD_MS = HOUR_MS;
// cleanupPeriodDays の対象外なので自前で消す
const RETENTION_MS = 7 * 24 * HOUR_MS;

interface State {
  endedAt: number;
  blockedHash?: string;
}

function stateFile(sessionId: string): string | undefined {
  if (!/^[\w-]+$/.test(sessionId)) {
    return undefined;
  }
  return join(STATE_DIR, `${sessionId}.json`);
}

function readState(path: string): State | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as State).endedAt !== 'number'
  ) {
    return undefined;
  }
  return parsed as State;
}

function writeState(path: string, state: State): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(state), 'utf-8');
}

function removeExpired(): void {
  if (!existsSync(STATE_DIR)) {
    return;
  }
  const limit = Date.now() - RETENTION_MS;
  for (const name of readdirSync(STATE_DIR)) {
    const path = join(STATE_DIR, name);
    if (statSync(path).mtimeMs < limit) {
      rmSync(path, { force: true });
    }
  }
}

function hashOf(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

const hook = defineHook({
  trigger: {
    SessionStart: true,
    Stop: true,
    UserPromptSubmit: true,
  },

  run: (context) => {
    try {
      const path = stateFile(context.input.session_id);
      if (path === undefined) {
        return context.success({});
      }

      // /compact はセッション ID を引き継ぐ。記録を消さないと、
      // キャッシュを作り直した直後の入力を止めてしまう
      if (context.input.hook_event_name === 'SessionStart') {
        if (context.input.source === 'clear' || context.input.source === 'compact') {
          rmSync(path, { force: true });
        }
        return context.success({});
      }

      if (context.input.hook_event_name === 'Stop') {
        if (context.input.stop_hook_active) {
          return context.success({});
        }
        writeState(path, { endedAt: Date.now() });
        removeExpired();
        return context.success({});
      }

      const state = readState(path);
      if (state === undefined) {
        return context.success({});
      }

      const elapsed = Date.now() - state.endedAt;
      if (elapsed < THRESHOLD_MS) {
        return context.success({});
      }

      // 同じ内容の 2 回目は通す。毎回止めると作業にならない
      const hash = hashOf(context.input.prompt);
      if (state.blockedHash === hash) {
        return context.success({});
      }

      writeState(path, { endedAt: state.endedAt, blockedHash: hash });
      const hours = Math.floor(elapsed / HOUR_MS);
      return context.blockingError(
        [
          `前回のやり取りから ${hours} 時間経過しています。/clear してください。`,
          'このまま続ける場合は、同じ内容をもう一度送信してください。',
        ].join('\n'),
      );
    } catch (err) {
      process.stderr.write(
        `[cache-ttl-guard] ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return context.success({});
    }
  },
});

if (import.meta.main) {
  await runHook(hook);
}
