import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
const html = readFileSync('/tmp/au-bw.html', 'utf8');
const $ = cheerio.load(html);
console.log('articles', $('article').length);
$('article').slice(0, 5).each((i, el) => {
  const a = $(el).find('a[href*="/de/d/"]').first();
  console.log('---', i, a.attr('href'));
  console.log($(el).text().replace(/\s+/g,' ').trim().slice(0, 700));
});
