// ブラウザ上で実行されるコード。フックが Bun.Transpiler で JS 化し、
// <script type="module"> としてページにインライン展開する。
// mermaid(サイズが大きいためサーバから配信)を除き、外部依存や import は持たない
// (自己完結 HTML を保つため)

interface Annotation {
  id: string;
  exact: string;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  resolved?: boolean;
}

interface Selector {
  exact: string;
  prefix: string;
  suffix: string;
}

const CONTEXT_LENGTH = 32;

const content = document.getElementById('content');
const commentList = document.getElementById('comment-list');
const commentNote = document.getElementById('comment-note');

const docPath = decodeURIComponent(location.pathname.replace(/^\//, ''));

function apiUrl(): string {
  return `/api/comments?doc=${encodeURIComponent(docPath)}`;
}

function note(message: string): void {
  if (commentNote) {
    commentNote.textContent = message;
  }
}

function setupToc(): boolean {
  const toc = document.getElementById('toc');
  if (!toc || !content) {
    return false;
  }
  const headings = Array.from(content.querySelectorAll('h1, h2, h3')).filter(
    (heading): heading is HTMLElement => heading instanceof HTMLElement,
  );
  if (headings.length < 2) {
    toc.hidden = true;
    return false;
  }
  const list = document.createElement('ul');
  headings.forEach((heading, index) => {
    if (heading.id === '') {
      heading.id = `heading-${index}`;
    }
    const item = document.createElement('li');
    item.className = `toc-level-${heading.tagName.toLowerCase()}`;
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent ?? '';
    item.append(link);
    list.append(item);
  });
  toc.append(list);
  return true;
}

interface PanelPrefs {
  toc: boolean;
  comments: boolean;
}

const PANEL_PREFS_KEY = 'md-to-html:panels';

function loadPanelPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(PANEL_PREFS_KEY);
    if (raw === null) {
      return { toc: true, comments: true };
    }
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return { toc: parsed.toc !== false, comments: parsed.comments !== false };
  } catch {
    // file: で開いた場合やストレージ拒否設定では localStorage が例外を投げる
    return { toc: true, comments: true };
  }
}

function savePanelPrefs(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できない環境では開閉状態を覚えないだけで、操作自体は続けられる
  }
}

function applyPanel(
  key: 'toc' | 'comments',
  toggle: HTMLElement | null,
  usable: boolean,
  open: boolean,
): void {
  const shown = usable && open;
  // 本文の幅とパネルの表示は CSS 側がこの属性を見て決める
  document.body.dataset[key] = shown ? 'open' : 'closed';
  if (toggle) {
    toggle.hidden = !usable;
    toggle.setAttribute('aria-expanded', String(shown));
  }
}

// 戻り値は差分表示への切り替えを伝える関数
function setupPanels(tocAvailable: boolean): (showDiff: boolean) => void {
  const tocToggle = document.getElementById('toc-toggle');
  const commentToggle = document.getElementById('comment-toggle');
  const prefs = loadPanelPrefs();
  let diffMode = false;

  const apply = (): void => {
    // 差分表示中はサイドパネルが変更箇所の一覧に変わり、
    // コメントは本文の位置に紐づくため出せない
    applyPanel('toc', tocToggle, diffMode || tocAvailable, prefs.toc);
    applyPanel('comments', commentToggle, !diffMode, prefs.comments);
    if (tocToggle) {
      tocToggle.textContent = diffMode ? '☰ 変更箇所' : '☰ 目次';
    }
  };

  tocToggle?.addEventListener('click', () => {
    prefs.toc = !prefs.toc;
    savePanelPrefs(prefs);
    apply();
  });
  commentToggle?.addEventListener('click', () => {
    prefs.comments = !prefs.comments;
    savePanelPrefs(prefs);
    apply();
  });

  apply();
  return (showDiff: boolean): void => {
    diffMode = showDiff;
    apply();
  };
}

// htmldiff は ins/del をインラインに散らすため、ブロック要素単位に
// まとめて「変更箇所」として一覧化する
const DIFF_BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th';

function diffKind(block: Element): 'ins' | 'del' | 'mixed' {
  const hasIns = block.matches('ins') || block.querySelector('ins') !== null;
  const hasDel = block.matches('del') || block.querySelector('del') !== null;
  if (hasIns && hasDel) {
    return 'mixed';
  }
  return hasDel ? 'del' : 'ins';
}

function setupDiffNav(): void {
  const diff = document.getElementById('diff');
  const nav = document.getElementById('diff-nav');
  const diffBtn = document.getElementById('view-diff-btn');
  if (!diff || !nav) {
    return;
  }
  const blocks: Element[] = [];
  for (const change of Array.from(diff.querySelectorAll('ins, del'))) {
    const block = change.closest(DIFF_BLOCK_SELECTOR) ?? change;
    if (!blocks.includes(block)) {
      blocks.push(block);
    }
  }
  if (diffBtn) {
    diffBtn.textContent = `前回との差分(${blocks.length})`;
  }
  const kindLabel = { ins: '追加', del: '削除', mixed: '変更' } as const;
  const list = document.createElement('ul');
  for (const block of blocks) {
    const item = document.createElement('li');
    item.className = 'diff-nav-item';
    const kind = diffKind(block);
    const badge = document.createElement('span');
    badge.className = `diff-nav-kind diff-nav-${kind}`;
    badge.textContent = kindLabel[kind];
    const excerpt = document.createElement('span');
    const text = (block.textContent ?? '').trim().replace(/\s+/g, ' ');
    excerpt.textContent = text.length > 60 ? `${text.slice(0, 60)}…` : text;
    item.append(badge, excerpt);
    item.addEventListener('click', () => {
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      block.classList.remove('diff-flash');
      // クラスを付け直しただけではアニメーションが再生されないため、
      // フレームを挟んでから追加する
      requestAnimationFrame(() => {
        requestAnimationFrame(() => block.classList.add('diff-flash'));
      });
    });
    list.append(item);
  }
  nav.append(list);
}

function setupDiffToggle(tocAvailable: boolean, setDiffMode: (showDiff: boolean) => void): void {
  const diff = document.getElementById('diff');
  const contentBtn = document.getElementById('view-content-btn');
  const diffBtn = document.getElementById('view-diff-btn');
  const toc = document.getElementById('toc');
  const diffNav = document.getElementById('diff-nav');
  if (!diff || !contentBtn || !diffBtn || !content) {
    return;
  }
  const select = (showDiff: boolean): void => {
    diff.hidden = !showDiff;
    content.hidden = showDiff;
    if (toc) {
      toc.hidden = showDiff || !tocAvailable;
    }
    if (diffNav) {
      diffNav.hidden = !showDiff;
    }
    setDiffMode(showDiff);
    diffBtn.classList.toggle('active', showDiff);
    contentBtn.classList.toggle('active', !showDiff);
  };
  contentBtn.addEventListener('click', () => select(false));
  diffBtn.addEventListener('click', () => select(true));
}

// 図の定義を SVG に置き換えるとテキスト内容が変わるため、コメントの位置計算
// (reload)より先に描画を終わらせる必要がある
const MERMAID_MODULE_PATH = '/_assets/mermaid/mermaid.esm.min.mjs';

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  run(options: { nodes: HTMLElement[] }): Promise<void>;
}

function mermaidBlocks(): HTMLElement[] {
  if (!content) {
    return [];
  }
  // 差分表示側は ins/del が定義に混ざって描画できないため対象にしない
  return Array.from(content.querySelectorAll('pre.mermaid')).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

async function renderMermaid(): Promise<void> {
  const nodes = mermaidBlocks();
  if (nodes.length === 0) {
    return;
  }
  try {
    const loaded = (await import(MERMAID_MODULE_PATH)) as {
      default: MermaidApi;
    };
    loaded.default.initialize({
      startOnLoad: false,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
    });
    await loaded.default.run({ nodes });
  } catch (err) {
    // 失敗しても図の定義がコードブロックとして残るため、通知は行わない
    console.error('mermaid の描画に失敗しました', err);
  }
}

function collectTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current !== null) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function contentText(): string {
  if (!content) {
    return '';
  }
  return collectTextNodes(content)
    .map((node) => node.data)
    .join('');
}

function selectorFromSelection(): Selector | undefined {
  const selection = window.getSelection();
  if (!content || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) {
    return undefined;
  }
  // 本文先頭から選択開始位置までの Range を作ると、その文字列長が
  // 全文テキスト上のオフセットと一致する(どちらも Text ノードの連結のため)
  const preRange = document.createRange();
  preRange.selectNodeContents(content);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  const exact = range.toString();
  if (exact.trim() === '') {
    return undefined;
  }
  const docText = contentText();
  return {
    exact,
    prefix: docText.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: docText.slice(start + exact.length, start + exact.length + CONTEXT_LENGTH),
  };
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length++;
  }
  return length;
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length++;
  }
  return length;
}

function locateAnnotation(annotation: Annotation, docText: string): number {
  const candidates: number[] = [];
  let index = docText.indexOf(annotation.exact);
  while (index !== -1) {
    candidates.push(index);
    index = docText.indexOf(annotation.exact, index + 1);
  }
  const first = candidates[0];
  if (first === undefined) {
    return -1;
  }
  if (candidates.length === 1) {
    return first;
  }
  let best = first;
  let bestScore = -1;
  for (const candidate of candidates) {
    const prefix = docText.slice(Math.max(0, candidate - annotation.prefix.length), candidate);
    const suffixStart = candidate + annotation.exact.length;
    const suffix = docText.slice(suffixStart, suffixStart + annotation.suffix.length);
    const score =
      commonSuffixLength(prefix, annotation.prefix) + commonPrefixLength(suffix, annotation.suffix);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function wrapTextSlice(node: Text, start: number, end: number, id: string): void {
  if (start >= end) {
    return;
  }
  const target = start > 0 ? node.splitText(start) : node;
  if (end - start < target.data.length) {
    target.splitText(end - start);
  }
  const mark = document.createElement('mark');
  mark.className = 'annotation-mark';
  mark.dataset.annotationId = id;
  target.parentNode?.insertBefore(mark, target);
  mark.appendChild(target);
}

function highlightRange(start: number, end: number, id: string): void {
  if (!content) {
    return;
  }
  const nodes = collectTextNodes(content);
  let total = 0;
  for (const node of nodes) {
    const nodeStart = total;
    const nodeEnd = total + node.data.length;
    total = nodeEnd;
    if (nodeEnd <= start) {
      continue;
    }
    if (nodeStart >= end) {
      break;
    }
    wrapTextSlice(
      node,
      Math.max(start, nodeStart) - nodeStart,
      Math.min(end, nodeEnd) - nodeStart,
      id,
    );
  }
}

function clearHighlights(): void {
  if (!content) {
    return;
  }
  for (const mark of Array.from(content.querySelectorAll('mark.annotation-mark'))) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }
  content.normalize();
}

function selectAnnotation(id: string): void {
  for (const card of Array.from(document.querySelectorAll('.comment-card'))) {
    card.classList.toggle(
      'selected',
      card instanceof HTMLElement && card.dataset.annotationId === id,
    );
  }
  for (const mark of Array.from(document.querySelectorAll('mark.annotation-mark'))) {
    mark.classList.toggle(
      'selected',
      mark instanceof HTMLElement && mark.dataset.annotationId === id,
    );
  }
}

function scrollToMark(id: string): void {
  const mark = document.querySelector(`mark.annotation-mark[data-annotation-id="${id}"]`);
  mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderCommentList(annotations: Annotation[], missingIds: Set<string>): void {
  if (!commentList) {
    return;
  }
  commentList.textContent = '';
  for (const annotation of annotations) {
    const card = document.createElement('li');
    card.className = 'comment-card';
    card.dataset.annotationId = annotation.id;
    if (missingIds.has(annotation.id)) {
      card.classList.add('comment-missing');
    }

    const quote = document.createElement('blockquote');
    quote.textContent =
      annotation.exact.length > 80 ? `${annotation.exact.slice(0, 80)}…` : annotation.exact;

    const body = document.createElement('p');
    body.textContent = annotation.comment;

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const time = document.createElement('span');
    time.textContent = missingIds.has(annotation.id)
      ? `${formatDate(annotation.createdAt)} · 本文中に見つかりません`
      : formatDate(annotation.createdAt);
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'comment-delete';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (window.confirm('このコメントを削除しますか?')) {
        void deleteAnnotation(annotation.id);
      }
    });
    meta.append(time, deleteBtn);

    card.append(quote, body, meta);
    card.addEventListener('click', () => {
      selectAnnotation(annotation.id);
      scrollToMark(annotation.id);
    });
    commentList.append(card);
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ja-JP');
}

async function fetchAnnotations(): Promise<Annotation[]> {
  const res = await fetch(apiUrl());
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { annotations?: Annotation[] };
  return data.annotations ?? [];
}

async function createAnnotation(selector: Selector, comment: string): Promise<void> {
  const res = await fetch(apiUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...selector, comment }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

async function deleteAnnotation(id: string): Promise<void> {
  try {
    const res = await fetch(`${apiUrl()}&id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch {
    note('コメントの削除に失敗しました');
    return;
  }
  await reload();
}

async function reload(): Promise<void> {
  if (!content) {
    return;
  }
  let annotations: Annotation[];
  try {
    // resolved は Claude が対応済みにしたもの。一覧・ハイライトには出さず、
    // JSON からの削除はユーザー操作(ブラウザの削除ボタン)に委ねる
    annotations = (await fetchAnnotations()).filter((annotation) => annotation.resolved !== true);
  } catch {
    note('コメントを読み込めませんでした(保存サーバが起動していません)');
    return;
  }
  clearHighlights();
  const docText = contentText();
  const located: { annotation: Annotation; start: number }[] = [];
  const missing: Annotation[] = [];
  for (const annotation of annotations) {
    const start = locateAnnotation(annotation, docText);
    if (start === -1) {
      missing.push(annotation);
    } else {
      located.push({ annotation, start });
    }
  }
  located.sort((a, b) => a.start - b.start);
  // テキスト内容は wrap しても変わらないため、全アノテーションの位置を
  // 確定させてから順に DOM を分割・装飾しても位置はずれない
  for (const { annotation, start } of located) {
    highlightRange(start, start + annotation.exact.length, annotation.id);
  }
  renderCommentList(
    [...located.map((entry) => entry.annotation), ...missing],
    new Set(missing.map((entry) => entry.id)),
  );
  note(annotations.length === 0 ? '本文を範囲選択するとコメントを追加できます' : '');
}

let pendingSelector: Selector | undefined;
let popover: HTMLElement | undefined;

const annotateButton = document.createElement('button');
annotateButton.id = 'annotate-button';
annotateButton.type = 'button';
annotateButton.textContent = '💬 コメント';
annotateButton.hidden = true;
document.body.append(annotateButton);

function hideAnnotateButton(): void {
  annotateButton.hidden = true;
  pendingSelector = undefined;
}

function closePopover(): void {
  popover?.remove();
  popover = undefined;
}

function updateAnnotateButton(): void {
  if (popover) {
    return;
  }
  const selector = selectorFromSelection();
  const selection = window.getSelection();
  if (!selector || !selection || selection.rangeCount === 0) {
    hideAnnotateButton();
    return;
  }
  pendingSelector = selector;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  annotateButton.hidden = false;
  annotateButton.style.top = `${window.scrollY + rect.bottom + 8}px`;
  annotateButton.style.left = `${window.scrollX + rect.left}px`;
}

function openPopover(): void {
  if (!pendingSelector) {
    return;
  }
  const selector = pendingSelector;
  closePopover();

  const container = document.createElement('div');
  container.className = 'comment-popover';
  container.style.top = annotateButton.style.top;
  container.style.left = annotateButton.style.left;

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'コメントを入力';
  textarea.rows = 4;

  const actions = document.createElement('div');
  actions.className = 'comment-popover-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => closePopover());
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', () => {
    const comment = textarea.value.trim();
    if (comment === '') {
      textarea.focus();
      return;
    }
    saveBtn.disabled = true;
    void createAnnotation(selector, comment)
      .then(() => {
        closePopover();
        window.getSelection()?.removeAllRanges();
        return reload();
      })
      .catch(() => {
        saveBtn.disabled = false;
        note('コメントの保存に失敗しました');
      });
  });
  actions.append(cancelBtn, saveBtn);

  container.append(textarea, actions);
  document.body.append(container);
  popover = container;
  textarea.focus();
  hideAnnotateButton();
}

function setupSelectionUi(): void {
  document.addEventListener('mouseup', (event) => {
    if (
      event.target instanceof Node &&
      (annotateButton.contains(event.target) || popover?.contains(event.target) === true)
    ) {
      return;
    }
    // mouseup 直後は Selection が確定していないことがあるため遅延させる
    window.setTimeout(updateAnnotateButton, 10);
  });
  // クリックで選択が解除される前にボタンを処理するため mousedown を使う
  annotateButton.addEventListener('mousedown', (event) => {
    event.preventDefault();
    openPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePopover();
      hideAnnotateButton();
    }
  });
  if (content) {
    content.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const mark = event.target.closest('mark.annotation-mark');
      if (!(mark instanceof HTMLElement) || !mark.dataset.annotationId) {
        return;
      }
      const id = mark.dataset.annotationId;
      selectAnnotation(id);
      document
        .querySelector(`.comment-card[data-annotation-id="${id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

const tocAvailable = setupToc();
setupDiffNav();
const setDiffMode = setupPanels(tocAvailable);
setupDiffToggle(tocAvailable, setDiffMode);
if (location.protocol === 'file:') {
  const features = mermaidBlocks().length > 0 ? 'コメント機能と Mermaid 図の描画' : 'コメント機能';
  note(
    `${features}は http://localhost 経由で開いたときのみ使えます。` +
      'Markdown を再変換すると localhost の URL が案内されます。',
  );
} else {
  setupSelectionUi();
  void renderMermaid().then(reload);
}
