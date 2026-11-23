import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
for (const url of ['https://www.autouncle.de/de/gebrauchtwagen', 'https://www.autouncle.de/de/gebrauchtwagen?location=69168&distance=50&price_to=6000']) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    console.log('url:', page.url());
    console.log('title:', await page.title());
    console.log('body:', (await page.locator('body').innerText()).slice(0, 300).replace(/\n/g,' | '));
    console.log('links:', await page.locator('a[href*="/de/d/"]').count());
  } catch (e) { console.log('ERR', e.message); }
}
await browser.close();
