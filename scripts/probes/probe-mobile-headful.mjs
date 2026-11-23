import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const page = await ctx.newPage();
await page.goto('https://suchen.mobile.de/auto/wiesloch.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(1500);
for (const label of ['Ablehnen', 'Einverstanden']) {
  const btn = page.getByRole('button', { name: label }).first();
  if (await btn.count()) { console.log('clicking', label); await btn.click().catch(()=>{}); break; }
}
await page.waitForTimeout(4000);
console.log('title:', await page.title());
console.log('detail links:', await page.locator('a[href*="fahrzeuge/details"]').count());
console.log('body text:', (await page.locator('body').innerText()).slice(0, 700));
await browser.close();
