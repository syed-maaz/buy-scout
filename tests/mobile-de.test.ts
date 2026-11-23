import test from "node:test";
import assert from "node:assert/strict";
import { parseMobileDeCards } from "../src/sources/mobile-de.js";

test("parses mobile.de search cards", () => {
  const html = `
    <article data-testid="base-result-listing-1">
      <a href="https://suchen.mobile.de/fahrzeuge/details.html?id=442270519&vc=Car">Volkswagen Scirocco</a>
      <div>Volkswagen Scirocco 1.4 TSI 6.490 € Finanzierung ab 46 € mtl. EZ 03/2011 • 167.000 km • 118 kW (160 PS) • Benzin Autozentrum Zollernalb 72355 Schömberg</div>
    </article>
    <article data-testid="top-result-listing-1">
      <a href="https://suchen.mobile.de/fahrzeuge/details.html?id=53019727739520&vc=Car">Ford Mondeo</a>
      <div>Top Gesponsert Ford Mondeo 4.950 € EZ 06/2013 • 226.112 km • 103 kW (140 PS) • Diesel 78532 Tuttlingen</div>
    </article>`;
  const cards = parseMobileDeCards(html);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].externalId, "442270519");
  assert.equal(cards[0].priceEur, 6490);
  assert.equal(cards[0].mileageKm, 167000);
  assert.equal(cards[0].firstRegistration, "2011-03-01");
  assert.equal(cards[0].powerKw, 118);
  assert.equal(cards[0].powerPs, 160);
  assert.equal(cards[0].fuel, "Benzin");
  assert.equal(cards[0].zip, "72355");
  assert.equal(cards[1].externalId, "53019727739520");
  assert.equal(cards[1].fuel, "Diesel");
});
