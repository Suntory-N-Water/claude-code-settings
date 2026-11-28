import { chromium } from 'playwright';

const NAVIGATION_TIMEOUT = 30 * 1000;
const RENDER_TIMEOUT = 10 * 1000;
// 空の SPA シェルと本文描画後を区別するための閾値
const MIN_BODY_TEXT_LENGTH = 500;

export async function fetchDynamicHtml(url: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
    ],
  });

  const page = await browser.newPage({
    userAgent: 'bot',
    viewport: { width: 1920, height: 1080 },
  });

  try {
    await page.goto(url, {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT,
    });
    // 任意の URL を取得するため待機対象の要素を特定できない。
    // load 完了後に本文を描画する SPA に追随するため、本文の文字数で描画完了を判定する。
    // 本文がそもそも少ないページもあるので、待機が成立しなくてもその時点の HTML を返す
    await page
      .waitForFunction(
        // biome-ignore lint/performance/useDomNodeTextContent: textContent は script 要素の中身も数えるため、本文の描画前に文字数の条件を満たしてしまう
        (min) => (document.body?.innerText ?? '').trim().length >= min,
        MIN_BODY_TEXT_LENGTH,
        { timeout: RENDER_TIMEOUT },
      )
      .catch(() => {});
    return await page.content();
  } finally {
    await page.close();
    await browser.close();
  }
}
