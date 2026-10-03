import htmldiff from 'node-htmldiff';

// node-htmldiff は Unicode 非対応の \w でトークナイズするため、
// 日本語は実質1文字=1トークンとなり差分粒度は文字単位になる(検証済み)
export function renderDiffHtml(previousHtml: string, currentHtml: string): string {
  return htmldiff(previousHtml, currentHtml);
}
