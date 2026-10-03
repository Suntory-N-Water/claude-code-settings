#!/usr/bin/env -S bun run --silent
import { defineHook, runHook } from 'cc-hooks-ts';

type SoundCommand = [string, ...string[]];

// WSL 上の Bun は process.platform に 'linux' を返すため、Windows 環境はこの case で扱う
function resolveSoundCommand(platform: NodeJS.Platform): SoundCommand | null {
  switch (platform) {
    case 'darwin':
      return ['afplay', '/System/Library/Sounds/Glass.aiff'];
    case 'linux':
      // TODO: WSL 実機で確認してから実装する。候補は powershell.exe 経由で Windows 側に鳴らさせる方法
      return null;
    default:
      return null;
  }
}

const hook = defineHook({
  trigger: {
    Stop: true,
  },

  // settings.json の async: true でこの hook 自体がバックグラウンド実行されるため、再生完了まで待ってよい
  run: async (context) => {
    if (context.input.stop_hook_active) {
      return context.success();
    }

    const command = resolveSoundCommand(process.platform);
    if (command === null) {
      return context.success();
    }

    try {
      await Bun.spawn(command, { stdio: ['ignore', 'ignore', 'ignore'] }).exited;
    } catch {
      // 通知音が鳴らないだけなのでセッションは止めない
    }

    return context.success();
  },
});

if (import.meta.main) {
  await runHook(hook);
}
