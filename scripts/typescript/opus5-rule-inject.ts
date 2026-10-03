#!/usr/bin/env -S bun run --silent
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { defineHook, runHook } from 'cc-hooks-ts';
import { join } from 'pathe';

const RULE_PATH = join(import.meta.dir, '..', '..', 'prompts', 'opus5-response-rule.md');
const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

// settings.json のモデルエイリアスは常に最新世代を指すため、Opus 5 とみなす
const LATEST_OPUS_ALIASES = ['opus', 'opusplan'];

type Detection = {
  isOpus5: boolean;
  /** stderr に出す判定根拠。どの経路を通ったか実測するために使う */
  source: string;
};

function isOpus5ModelId(model: string): boolean {
  return model.toLowerCase().replaceAll(' ', '-').includes('opus-5');
}

function readConfiguredModel(): string | undefined {
  try {
    const settings: unknown = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    const model =
      typeof settings === 'object' && settings !== null
        ? (settings as { model?: unknown }).model
        : undefined;
    return typeof model === 'string' ? model : undefined;
  } catch {
    return undefined;
  }
}

/**
 * model は /clear 後や会話復元時に省略されうる。その場合だけ settings.json を見る。
 */
function detectOpus5(inputModel: string | undefined): Detection {
  if (inputModel !== undefined) {
    return {
      isOpus5: isOpus5ModelId(inputModel),
      source: `input.model=${inputModel}`,
    };
  }

  const configured = readConfiguredModel();
  if (configured === undefined) {
    return { isOpus5: false, source: 'unknown' };
  }

  return {
    isOpus5: LATEST_OPUS_ALIASES.includes(configured) || isOpus5ModelId(configured),
    source: `settings.model=${configured}`,
  };
}

function readRule(): string | undefined {
  try {
    return readFileSync(RULE_PATH, 'utf-8');
  } catch {
    return undefined;
  }
}

const hook = defineHook({
  trigger: {
    SessionStart: true,
  },

  run: (c) => {
    const detection = detectOpus5(c.input.model);
    if (!detection.isOpus5) {
      return c.json({
        event: 'SessionStart',
        output: {
          systemMessage: `[opus5-rule-inject] skip (${detection.source})`,
        },
      });
    }

    const rule = readRule();
    if (rule === undefined) {
      return c.nonBlockingError(`[opus5-rule-inject] rule not found: ${RULE_PATH}`);
    }

    return c.json({
      event: 'SessionStart',
      output: {
        systemMessage: `[opus5-rule-inject] inject (${detection.source})`,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: rule,
        },
      },
    });
  },
});

if (import.meta.main) {
  await runHook(hook);
}
