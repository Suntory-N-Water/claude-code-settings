import { describe, expect, it } from 'bun:test';
import { parseHTML } from 'linkedom';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { highlightCodeBlocks } from './highlight.ts';

function render(markdown: string): string {
  return micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}

function textOf(html: string): string {
  return parseHTML(`<div id="root">${html}</div>`).document.getElementById('root')
    ?.textContent as string;
}

const FENCE = '```';

function fence(language: string, code: string): string {
  return [`${FENCE}${language}`, code, FENCE, ''].join('\n');
}

describe('highlightCodeBlocks', () => {
  it('対応言語のコードブロックに Shiki の色を付ける', async () => {
    const html = await highlightCodeBlocks(render(fence('ts', 'const a: number = 1;')));
    expect(html).toContain('class="shiki');
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
  });

  // ブラウザ側はコメントの位置を本文のテキスト一致で求めるため、
  // コードの文字列が変わると既存コメントの位置がずれる
  it('コードの文字列はハイライト後も変わらない', async () => {
    const code = 'if (a < b && c > d) {\n  say("&lt;div&gt;");\n}';
    const html = await highlightCodeBlocks(render(fence('ts', code)));
    expect(textOf(html).trimEnd()).toBe(code);
  });

  it('mermaid のコードブロックを描画対象の pre に変換する', async () => {
    const definition = 'graph TD\n  A --> B';
    const html = await highlightCodeBlocks(render(fence('mermaid', definition)));
    expect(html).toContain('<pre class="mermaid">');
    expect(html).not.toContain('language-mermaid');
    expect(textOf(html).trim()).toBe(definition);
  });

  it('Shiki が扱えないコードブロックはそのまま残す', async () => {
    const unsupported = render(fence('whatever-lang', 'x'));
    const noLanguage = render(fence('', 'plain text'));

    expect(await highlightCodeBlocks(unsupported)).toBe(unsupported);
    expect(await highlightCodeBlocks(noLanguage)).toBe(noLanguage);
  });

  it('複数のコードブロックと本文を取り違えない', async () => {
    const html = await highlightCodeBlocks(
      render(
        [
          fence('ts', 'const a = 1;'),
          '\n段落A\n\n',
          fence('mermaid', 'graph TD\n  A --> B'),
          '\n段落B\n\n',
          fence('unknown-lang', 'raw'),
        ].join(''),
      ),
    );

    expect(html).toContain('class="shiki');
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('language-unknown-lang');
    expect(html.indexOf('段落A')).toBeLessThan(html.indexOf('段落B'));
    expect(html.indexOf('class="shiki')).toBeLessThan(html.indexOf('段落A'));
  });
});
