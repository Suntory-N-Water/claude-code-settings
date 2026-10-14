export interface PageInput {
  title: string;
  contentHtml: string;
  diffHtml: string | undefined;
  clientJs: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1f2328;
  --border: #d1d9e0;
  /* 罫線・区切りとして意味を持つ線は非テキストコントラスト 3:1 が必要なため薄い --border と分ける */
  --border-strong: #949494;
  --code-bg: #f6f8fa;
  --link: #0969da;
  --quote: #59636e;
  --mark-bg: rgba(255, 213, 79, 0.45);
  --mark-selected: rgba(255, 170, 0, 0.65);
  --ins-bg: #dafbe1;
  --del-bg: #ffebe9;
  --danger: #d1242f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #e6edf3;
    --border: #3d444d;
    --border-strong: #8d96a0;
    --code-bg: #161b22;
    --link: #4493f8;
    --quote: #9198a1;
    --mark-bg: rgba(187, 128, 9, 0.4);
    --mark-selected: rgba(210, 153, 34, 0.7);
    --ins-bg: rgba(46, 160, 67, 0.3);
    --del-bg: rgba(248, 81, 73, 0.3);
    /* ライト用の #d1242f は暗い背景で文字のコントラスト 4.5:1 に届かない */
    --danger: #f85149;
  }
}
body {
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
  /* DADS Std-16N-175 */
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.75;
  letter-spacing: 0.02em;
  margin: 0;
  padding: 2rem 1rem 4rem;
  overflow-wrap: break-word;
}
html { scroll-behavior: smooth; }
#layout {
  display: flex;
  align-items: flex-start;
  gap: 2.5rem;
  max-width: var(--layout-width);
  margin: 0 auto;
  justify-content: center;
}
#side-panel { flex: 0 0 200px; }
/* min-width: 0 がないと pre の横スクロールが効かず本文が押し広げられる */
#content, #diff { flex: 0 1 var(--content-width); min-width: 0; }
#comment-panel { flex: 0 0 320px; }
#side-panel, #comment-panel {
  position: sticky;
  top: 1rem;
  align-self: start;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
}
/* 本文 840px は 16px で 1 行約 50 字。WCAG 1.4.8 の 40 字は超えるが、表やコードが
   縦に潰れない幅との折り合いで決めた。収まらない表は .table-scroll で横スクロールさせる。
   --layout-width は表示中の列と 2.5rem の間隔の合計で、ツールバーの端を本文の端に揃える */
body { --content-width: 840px; --layout-width: 1440px; }
body[data-toc="closed"] { --layout-width: 1200px; }
body[data-comments="closed"] { --layout-width: 1080px; }
body[data-toc="closed"][data-comments="closed"] { --layout-width: 840px; }
body[data-toc="closed"] #side-panel { display: none; }
body[data-comments="closed"] #comment-panel { display: none; }
/* 以下の 2 つのメディアクエリは、上の sticky 指定と同じ詳細度で上書きするため、
   必ず sticky 指定より後ろに置く(前に置くと縦積みでもパネルが本文に重なる) */
/* 1200px を切ると 3 列では本文が 560px を下回るため、コメントだけ本文の下へ回す。
   目次は sticky のまま、本文とコメントの 2 行にまたがらせて重ならないようにする */
@media (max-width: 1199px) {
  /* 属性セレクタを 2 つ並べるのは、開閉時の指定と詳細度を揃えて後勝ちさせるため */
  body[data-toc][data-comments] { --layout-width: 1080px; }
  body[data-toc="closed"][data-comments] { --layout-width: 840px; }
  #layout {
    display: grid;
    grid-template-columns: 200px minmax(0, var(--content-width));
    column-gap: 2.5rem;
    row-gap: 3rem;
  }
  body[data-toc="closed"] #layout { grid-template-columns: minmax(0, var(--content-width)); }
  #side-panel { grid-column: 1; grid-row: 1 / span 2; }
  #content, #diff { grid-column: -2; grid-row: 1; }
  #comment-panel { grid-column: -2; grid-row: 2; position: static; max-height: none; }
}
/* 880px を切ると目次の列を取る余裕がないため、すべて縦積みにする */
@media (max-width: 879px) {
  #layout { display: flex; flex-direction: column; gap: 2rem; }
  /* 縦方向の flex では flex-basis が高さとして扱われるため、列幅用の指定を外す */
  #content, #diff, #side-panel, #comment-panel { flex: none; align-self: stretch; }
  #side-panel { position: static; max-height: none; }
}
h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  line-height: 1.5;
  margin: 3rem 0 1rem;
  scroll-margin-top: 1rem;
}
h1 {
  font-size: 2rem;
  letter-spacing: 0.01em;
  border-bottom: 1px solid var(--border-strong);
  padding-bottom: 0.5rem;
}
h2 {
  font-size: 1.5rem;
  border-bottom: 1px solid var(--border-strong);
  padding-bottom: 0.5rem;
}
h3 { font-size: 1.25rem; }
h4 { font-size: 1.125rem; line-height: 1.6; }
h5, h6 { font-size: 1rem; line-height: 1.75; }
#content > :first-child, #diff > :first-child { margin-top: 0; }
/* 行送りと同じ 1 行分。WCAG 1.4.12 でフォントサイズの 2 倍に上書きされても崩れないよう em で指定する */
p { margin: 0 0 1.75em; }
a { color: var(--link); }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  /* DADS Mono: 行高 150%、字間 0 */
  line-height: 1.5;
  letter-spacing: 0;
  background: var(--code-bg);
  border-radius: 4px;
  padding: 0.125em 0.25em;
}
pre {
  background: var(--code-bg);
  border-radius: 8px;
  padding: 1rem;
  margin: 0 0 2rem;
  overflow-x: auto;
}
pre code { background: none; padding: 0; }
/* Shiki は文字色だけを CSS 変数で出力する。背景はページ側の --code-bg を使う */
.shiki, .shiki span { color: var(--shiki-light); }
@media (prefers-color-scheme: dark) {
  .shiki, .shiki span { color: var(--shiki-dark); }
}
.shiki .line { display: inline-block; min-width: 100%; }
pre.mermaid { text-align: center; }
pre.mermaid svg { max-width: 100%; height: auto; }
/* 描画前は図の定義がそのまま見えるため、コードブロックとして体裁を整える */
pre.mermaid:not([data-processed]) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.5;
  letter-spacing: 0;
  text-align: left;
}
blockquote {
  margin: 0 0 2rem;
  padding: 0 1rem;
  color: var(--quote);
  border-left: 4px solid var(--border-strong);
}
/* display: block では表が本文の幅を基準にできず、列が潰れて縦に間延びする。
   table のまま広げて列幅をブラウザに配分させ、収まらない分だけ外側の
   .table-scroll で横スクロールさせる。14px にするのは、列数が多い表でも本文幅に収めるため */
.table-scroll { overflow-x: auto; margin: 0 0 2rem; }
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.875rem;
}
/* 縦線は引かず、行の区切りだけで列を読ませる。列の間隔は左右の padding で取る */
th, td {
  border-bottom: 1px solid var(--border-strong);
  padding: 0.625rem 0.75rem;
  vertical-align: top;
  /* 日本語はどこでも改行できるため、長い URL などの列に幅を取られると
     1 文字ずつ縦に並ぶまで縮む。最低 6 字分は確保し、足りなければ横スクロールにする */
  min-width: 6em;
}
/* URL や識別子は改行位置がなく列幅を占有するため、途中で折り返せるようにする */
td a, td code { overflow-wrap: anywhere; }
th { background: var(--code-bg); font-weight: 700; }
/* 作成者の CSS は align 属性より優先されるため、列揃えの指定がない見出しだけを左揃えにする */
th:not([align]) { text-align: left; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid var(--border-strong); margin: 3rem 0; }
ul, ol { padding-left: 1.5rem; margin: 0 0 2rem; }
li { margin-bottom: 0.5rem; }
li > ul, li > ol { margin: 0.5rem 0 0; }
li > p { margin-bottom: 0.5rem; }
li input[type="checkbox"] { margin-right: 0.5rem; }

/* 目次トグルを左端、コメントトグルを右端、本文/差分の切り替えを中央に置く。
   列を固定するのは、トグルが隠れても残りのボタンが動かないようにするため */
#view-toolbar {
  max-width: var(--layout-width);
  margin: 0 auto 2rem;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
}
#toc-toggle { grid-column: 1; justify-self: start; }
#view-switch { grid-column: 2; justify-self: center; display: flex; gap: 0.5rem; }
#comment-toggle { grid-column: 3; justify-self: end; }
#view-toolbar button {
  /* DADS Medium ボタンの最小サイズ */
  min-width: 96px;
  min-height: 48px;
  padding: 0 1rem;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--fg);
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 1rem;
  white-space: nowrap;
}
/* 4 つのボタンが 1 行に収まらないため、パネルの開閉を 1 行目、本文/差分の切り替えを 2 行目に置く */
@media (max-width: 599px) {
  #view-toolbar { grid-template-columns: 1fr 1fr; }
  #toc-toggle { grid-column: 1; grid-row: 1; }
  #comment-toggle { grid-column: 2; grid-row: 1; }
  #view-switch { grid-column: 1 / -1; grid-row: 2; }
}
#view-toolbar button.active {
  background: var(--code-bg);
  font-weight: 700;
}
#view-toolbar button[aria-expanded="true"] { background: var(--code-bg); }

#diff ins { background: var(--ins-bg); text-decoration: none; }
#diff del { background: var(--del-bg); }

#side-panel {
  /* 本文ではない補助 UI のため 14px まで下げる。これ以上小さくはしない */
  font-size: 0.875rem;
}
/* 縦積みでは目次が本文と同じ流れに並ぶため、枠で囲んで本文と区別する */
@media (max-width: 879px) {
  #side-panel {
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 1rem;
  }
}
#side-panel h2 {
  font-size: 1rem;
  border-bottom: 0;
  padding-bottom: 0;
  margin: 0 0 0.75rem;
}
#toc ul, #diff-nav ul { list-style: none; padding: 0; margin: 0; }
/* 1px ではダークモードで背景に埋もれて見えなかったため 2px にする */
#toc ul { border-left: 2px solid var(--border-strong); }
#toc li { margin: 0; }
#toc a {
  display: block;
  /* リンクのターゲット領域 24x24 以上 */
  min-height: 24px;
  padding: 0.25rem 0.5rem 0.25rem 0.75rem;
  /* 左の縦線に重ねて、現在位置の印を線の上に描く */
  margin-left: -2px;
  border-left: 4px solid transparent;
  border-radius: 0 4px 4px 0;
  color: var(--quote);
  text-decoration: none;
  line-height: 1.6;
}
#toc .toc-depth-0 > a { color: var(--fg); }
#toc .toc-depth-1 > a { padding-left: 1.5rem; }
#toc .toc-depth-2 > a { padding-left: 2.25rem; }
#toc a:hover { color: var(--link); background: var(--code-bg); }
/* 線の色だけでは現在位置が目に入りにくいため、項目の背景にもリンク色を薄く敷く */
#toc a[aria-current="location"] {
  border-left-color: var(--link);
  background: color-mix(in srgb, var(--link) 18%, transparent);
  color: var(--fg);
  font-weight: 700;
}
.diff-nav-item {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-height: 44px;
  box-sizing: border-box;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  cursor: pointer;
}
.diff-nav-item:hover { border-color: var(--link); }
.diff-nav-kind {
  flex-shrink: 0;
  border-radius: 4px;
  padding: 0 0.5rem;
}
.diff-nav-ins { background: var(--ins-bg); }
.diff-nav-del { background: var(--del-bg); }
.diff-nav-mixed { background: var(--mark-bg); }
.diff-flash { animation: diff-flash 1.5s ease-out; }
@keyframes diff-flash {
  0% { box-shadow: 0 0 0 3px var(--link); }
  100% { box-shadow: 0 0 0 3px transparent; }
}

mark.annotation-mark {
  background: var(--mark-bg);
  color: inherit;
  border-radius: 2px;
  cursor: pointer;
}
mark.annotation-mark.selected { background: var(--mark-selected); }

#comment-panel { font-size: 0.875rem; }
#comment-panel h2 {
  font-size: 1rem;
  border-bottom: 0;
  padding-bottom: 0;
  margin: 0 0 0.75rem;
}
#comment-note { color: var(--quote); margin-bottom: 1rem; }
#comment-list { padding: 0; margin: 0; }
.comment-card {
  list-style: none;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
}
.comment-card.selected { border-color: var(--link); }
.comment-card.comment-missing { opacity: 0.6; }
.comment-card blockquote {
  margin: 0 0 0.5rem;
  padding: 0 0 0 0.75rem;
  border-left: 3px solid var(--border-strong);
  color: var(--quote);
}
/* コメント本文は読ませる文章のため、パネルの 14px ではなく本文と同じ 16px にする */
.comment-card p { margin: 0 0 0.5rem; font-size: 1rem; white-space: pre-wrap; }
.comment-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  color: var(--quote);
}
/* 日時が途中で折り返すと読みにくいため、収まらないときはボタンを次の行へ送る */
.comment-meta > span { white-space: nowrap; }
.comment-actions { display: flex; gap: 0.75rem; }
.comment-action {
  position: relative;
  /* DADS X-Small ボタンの最小サイズ */
  min-width: 72px;
  min-height: 28px;
  border: 1px solid var(--border-strong);
  background: none;
  color: var(--quote);
  border-radius: 4px;
  padding: 0 0.5rem;
  cursor: pointer;
  font: inherit;
}
/* X-Small は 44x44 に届かないため、見た目を変えずに当たり判定だけ広げる。
   隣のボタンと当たり判定が重ならないよう、広げる幅は .comment-actions の間隔の半分以下にする */
.comment-action::after { content: ''; position: absolute; inset: -8px -6px; }
.comment-action:hover { color: var(--link); border-color: var(--link); }
.comment-delete:hover { color: var(--danger); border-color: var(--danger); }

#annotate-button {
  position: absolute;
  z-index: 10;
  /* DADS Small ボタン相当。ターゲット領域 44x44 を満たすため高さだけ 44px に上げる */
  min-width: 80px;
  min-height: 44px;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--fg);
  border-radius: 8px;
  padding: 0 1rem;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  font: inherit;
  font-size: 1rem;
}
.comment-popover {
  position: absolute;
  z-index: 20;
  /* 削除・キャンセル・保存の 3 つのボタンが 1 行に収まる幅 */
  width: min(360px, calc(100vw - 2rem));
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.comment-popover textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--code-bg);
  color: var(--fg);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 0.5rem;
  font: inherit;
  font-size: 1rem;
  line-height: 1.75;
  resize: vertical;
}
.comment-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
.comment-popover-actions button {
  /* DADS Medium ボタンの最小サイズ */
  min-width: 96px;
  min-height: 48px;
  border: 1px solid var(--border-strong);
  background: var(--bg);
  color: var(--fg);
  border-radius: 8px;
  padding: 0 1rem;
  cursor: pointer;
  font: inherit;
  font-size: 1rem;
}
.comment-popover-actions button.primary {
  background: var(--link);
  border-color: var(--link);
  color: #ffffff;
}
/* 削除は取り消せないため、保存・キャンセルから離して左端に置く */
.comment-popover-actions button.danger {
  margin-right: auto;
  color: var(--danger);
  border-color: var(--danger);
}
.comment-popover-actions button:disabled { opacity: 0.6; cursor: default; }
`;

export function renderPage(input: PageInput): string {
  const viewSwitch =
    input.diffHtml === undefined
      ? ''
      : `<div id="view-switch">
<button type="button" id="view-content-btn" class="active">本文</button>
<button type="button" id="view-diff-btn">前回との差分</button>
</div>
`;
  const toolbar = `<nav id="view-toolbar">
<button type="button" id="toc-toggle" aria-controls="side-panel" aria-expanded="true">☰ 目次</button>
${viewSwitch}<button type="button" id="comment-toggle" aria-controls="comment-panel" aria-expanded="true">💬 コメント</button>
</nav>`;
  // htmldiff はタグの対応が崩れた HTML を出すことがある(閉じない strong など)。
  // そのまま置くと後続のコメント欄までその要素に取り込まれるため、template に隔離する。
  // ブラウザは </template> の位置で閉じていないタグを閉じ、client.ts が #diff へ移す
  const diffSection =
    input.diffHtml === undefined
      ? ''
      : `<main id="diff" hidden></main>
<template id="diff-source">
${input.diffHtml}
</template>`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>${STYLE}</style>
</head>
<body>
${toolbar}
<div id="layout">
<aside id="side-panel">
<nav id="toc"><h2>目次</h2></nav>
<nav id="diff-nav" hidden><h2>変更箇所</h2></nav>
</aside>
<main id="content">
${input.contentHtml}
</main>
${diffSection}
<aside id="comment-panel">
<h2>コメント</h2>
<div id="comment-note"></div>
<ul id="comment-list"></ul>
</aside>
</div>
<script type="module">
${input.clientJs}
</script>
</body>
</html>
`;
}
