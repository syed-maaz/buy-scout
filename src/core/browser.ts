import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((value): value is string => Boolean(value));

export interface BrowserPage {
  html: string;
  finalUrl: string;
}

export function isChallengePage(html: string): boolean {
  return /Just a moment|cf_chl|Enable JavaScript and cookies|Attention Required|Cloudflare/i.test(html);
}

/**
 * Last-resort page fetch for sites that fingerprint plain HTTP. This is not a
 * CAPTCHA solver: if the challenge remains, the caller gets an error.
 */
export async function fetchHtmlWithBrowser(url: string): Promise<BrowserPage> {
  const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  const contextOptions = {
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const profileDir = process.env.BUY_SCOUT_CHROME_PROFILE;
  const browser = profileDir
    ? null
    : await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
  const context = profileDir
    ? await chromium.launchPersistentContext(profileDir, {
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
        ...contextOptions,
      })
    : await browser!.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3_000);
    let html = await page.content();
    if (isChallengePage(html)) {
      await page.waitForTimeout(5_000);
      html = await page.content();
    }
    if (isChallengePage(html)) {
      throw new Error("browser fallback hit a challenge page");
    }
    return { html, finalUrl: page.url() };
  } finally {
    await context.close();
    if (browser) await browser.close();
  }
}

/**
 * Fetch several pages inside one browser context. Sites such as mobile.de tie
 * pagination to the search session; opening a new browser for page 2 can drop
 * the session and return a block page.
 */
export async function fetchHtmlPagesWithBrowser(urls: string[]): Promise<BrowserPage[]> {
  const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  const contextOptions = {
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const profileDir = process.env.BUY_SCOUT_CHROME_PROFILE;
  const browser = profileDir
    ? null
    : await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
  const context = profileDir
    ? await chromium.launchPersistentContext(profileDir, {
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
        ...contextOptions,
      })
    : await browser!.newContext(contextOptions);
  try {
    const page = await context.newPage();
    const results: BrowserPage[] = [];
    for (const url of urls) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3_000);
      let html = await page.content();
      if (isChallengePage(html)) {
        await page.waitForTimeout(5_000);
        html = await page.content();
      }
      results.push({ html, finalUrl: page.url() });
    }
    return results;
  } finally {
    await context.close();
    if (browser) await browser.close();
  }
}

/**
 * Walk a paginated search UI by clicking its page controls. Some sites bind
 * page 2 to the current search session; reusing the URL in a new context
 * returns a block page.
 */
export async function fetchPagedSearchWithBrowser(firstUrl: string, maxPages: number): Promise<BrowserPage[]> {
  const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  const contextOptions = {
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const profileDir = process.env.BUY_SCOUT_CHROME_PROFILE;
  const browser = profileDir
    ? null
    : await chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
  const context = profileDir
    ? await chromium.launchPersistentContext(profileDir, {
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
        ...contextOptions,
      })
    : await browser!.newContext(contextOptions);
  try {
    const page = await context.newPage();
    const results: BrowserPage[] = [];
    await page.goto(firstUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3_000);
    results.push({ html: await page.content(), finalUrl: page.url() });

    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber += 1) {
      const exact = page.getByRole("button", { name: `Seite ${pageNumber}`, exact: true });
      const next = (await exact.count()) > 0
        ? exact.first()
        : page.getByRole("button", { name: "Weiter", exact: true }).first();
      if ((await next.count()) === 0) break;
      await next.click();
      await page.waitForTimeout(8_000);
      results.push({ html: await page.content(), finalUrl: page.url() });
    }
    return results;
  } finally {
    await context.close();
    if (browser) await browser.close();
  }
}
