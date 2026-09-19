import { describe, expect, it } from 'bun:test';
import { projectTag } from './project-tag';

describe('調査ログのプロジェクト識別', () => {
  it('同じリポジトリならmacOSとWSLで同じタグになること', () => {
    // Arrange
    const sut = projectTag;
    const projectDirs = [
      '/Users/alice/dev/claude-code-changelog-viewer',
      '/home/alice/dev/claude-code-changelog-viewer',
    ];

    // Act
    const result = projectDirs.map(sut);

    // Assert
    expect(result).toEqual([
      'claude-code-changelog-viewer',
      'claude-code-changelog-viewer',
    ]);
  });

  it('WSLからWindows側のリポジトリを開いてもディレクトリ名がタグになること', () => {
    // Arrange
    const sut = projectTag;
    const projectDir = '/mnt/c/Users/alice/dev/claude-code-changelog-viewer';

    // Act
    const result = sut(projectDir);

    // Assert
    expect(result).toBe('claude-code-changelog-viewer');
  });
});
