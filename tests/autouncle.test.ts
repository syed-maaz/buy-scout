import test from "node:test";
import assert from "node:assert/strict";
import { parseAutoUncleCards, normaliseAutoUncleCard, estimateDistanceFromWiesloch } from "../src/sources/autouncle.js";

const html = `
<html><body>
<article>
  <a href="/de/d/188210798-gebraucht-2015-nissan-pulsar-tekna-110-ps">
    Gebraucht (2015) Nissan Pulsar Tekna 110 PS | Superpreis
  </a>
  <div>
    Zu Favoriten hinzufügen-31%1 / 4Gebraucht (2015) Nissan Pulsar Tekna 110 PS | SuperpreisTekna
    Jun 2015145.957 kmAusstattungslinie: Tekna1.5L DieselKleinwagenSchaltgetriebe110 PS (80 kW)
    CO2-Klasse: B94 g CO2/km komb.3.6 L/100KmDetailsSuperpreis5.499 €7.999 €
    Unter dem Marktpreis1.801 €Preisänderung↓ -31%Tage inseriert590
    Autoscout2470376 Stuttgart, Baden-Württemberg
  </div>
</article>
</body></html>`;

test("parses AutoUncle card with concatenated year and mileage", () => {
  const cards = parseAutoUncleCards(html);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.externalId, "188210798");
  assert.equal(card.title, "Nissan Pulsar Tekna 110 PS");
  assert.equal(card.priceEur, 5499);
  assert.equal(card.mileageKm, 145957);
  assert.equal(card.firstRegistration, "2015-06-01");
  assert.equal(card.fuel, "Diesel");
  assert.equal(card.bodyType, "Kleinwagen");
  assert.equal(card.priceLabel, "Superpreis");
  assert.equal(card.city, "Stuttgart");
  assert.equal(card.zip, "70376");
});

test("normalises AutoUncle card into a listing with unknown family fields", () => {
  const card = parseAutoUncleCards(html)[0];
  const listing = normaliseAutoUncleCard(card);
  assert.equal(listing.source, "autouncle");
  assert.equal(listing.make, "Nissan");
  assert.equal(listing.model, "Pulsar Tekna 110 PS");
  assert.equal(listing.seats, null);
  assert.equal(listing.doors, null);
  assert.equal(listing.hasIsofix, null);
  assert.equal(listing.priceLabel, "Superpreis");
});

test("estimates distance from ZIP prefix for AutoUncle cards", () => {
  assert.equal(estimateDistanceFromWiesloch("69168"), 5);
  assert.equal(estimateDistanceFromWiesloch("70376"), 90);
  assert.equal(estimateDistanceFromWiesloch("68309"), 25);
  assert.equal(estimateDistanceFromWiesloch(null), null);
});
