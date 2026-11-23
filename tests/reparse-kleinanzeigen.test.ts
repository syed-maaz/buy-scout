import test from "node:test";
import assert from "node:assert/strict";
import { listingsFromRawHtml } from "../src/cli/reparse.js";
import {
  normaliseKleinanzeigenCard,
  parseKleinanzeigenCards,
} from "../src/sources/kleinanzeigen.js";

const searchHtml = `<!doctype html>
<html><body>
<main>
  <article data-adid="2876543210" data-href="/s-anzeige/kia-ceed-sw-1-6-crdi/2876543210-216-1200">
    <div class="flex items-center gap-xxsmall text-onSurfaceNonessential"><span>68753 Waghäusel</span></div>
    <h3 class="mb-xsmall line-clamp-2 text-title3 font-strong"><a href="/s-anzeige/kia-ceed-sw-1-6-crdi/2876543210-216-1200">Kia Ceed SW 1.6 CRDi</a></h3>
    <p class="mb-xsmall text-bodyRegular text-onSurfaceSubdued">Familienkombi, 5 Sitze, scheckheftgepflegt.</p>
    <p class="my-xsmall text-title3 font-strong text-secondary">4.250 € VB</p>
  </article>
  <article>
    <h3><a href="/s-anzeige/ignored/1-216-1200">Ignored advert</a></h3>
    <p>99 €</p>
  </article>
</main>
</body></html>`;

test("parses a Kleinanzeigen search fixture into a card", () => {
  const cards = parseKleinanzeigenCards(searchHtml);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.externalId, "2876543210");
  assert.equal(card.title, "Kia Ceed SW 1.6 CRDi");
  assert.equal(card.priceEur, 4250);
  assert.equal(card.zip, "68753");
  assert.equal(card.city, "Waghäusel");
  assert.equal(
    card.url,
    "https://www.kleinanzeigen.de/s-anzeige/kia-ceed-sw-1-6-crdi/2876543210-216-1200",
  );
});

test("normalises a Kleinanzeigen card into a listing", () => {
  const card = parseKleinanzeigenCards(searchHtml)[0];
  const listing = normaliseKleinanzeigenCard(card);
  assert.equal(listing.source, "kleinanzeigen");
  assert.equal(listing.externalId, "2876543210");
  assert.equal(listing.priceEur, 4250);
  assert.equal(listing.title, "Kia Ceed SW 1.6 CRDi");
  assert.equal(listing.currency, "EUR");
  assert.equal(listing.zip, "68753");
  assert.equal(listing.city, "Waghäusel");
  assert.equal(
    listing.url,
    "https://www.kleinanzeigen.de/s-anzeige/kia-ceed-sw-1-6-crdi/2876543210-216-1200",
  );
});

test("reparse source dispatch routes Kleinanzeigen HTML to the card parser", () => {
  const listings = listingsFromRawHtml("kleinanzeigen", searchHtml);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].source, "kleinanzeigen");
  assert.equal(listings[0].externalId, "2876543210");
  assert.equal(listings[0].priceEur, 4250);
  assert.equal(listings[0].title, "Kia Ceed SW 1.6 CRDi");
});
