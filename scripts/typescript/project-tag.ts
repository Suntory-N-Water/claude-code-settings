import { basename, normalize } from 'pathe';

/** 実行環境のホームパスではなく、リポジトリのディレクトリ名を識別子にする。 */
export function projectTag(projectDir: string): string {
  const name = basename(normalize(projectDir)).replace(/^\.+/, '').trim();
  return name || 'unknown';
}
