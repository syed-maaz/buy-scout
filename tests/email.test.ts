import test from "node:test";
import assert from "node:assert/strict";
import { extractListingLinks } from "../src/ingest/email.js";

const sample = `
<p>Neue Angebote</p>
<a href="https://suchen.mobile.de/fahrzeuge/details.html?id=123456789&utm=1">mobile</a>
<a href="https://www.autoscout24.de/angebote/kia-ceed-abc-0eb02f7a-77a1-46c3-9e05-231e267fbd13">as24</a>
<a href="https://www.kleinanzeigen.de/s-anzeige/opel-corsa/3552981124-216-8259">ka</a>
`;

test("extracts listing links from email HTML", () => {
  const leads = extractListingLinks(sample);
  assert.equal(leads.length, 3);
  assert.equal(leads.find((l) => l.source === "mobile_de")?.externalId, "123456789");
  assert.equal(leads.find((l) => l.source === "autoscout24")?.externalId, "0eb02f7a-77a1-46c3-9e05-231e267fbd13");
  assert.equal(leads.find((l) => l.source === "kleinanzeigen")?.externalId, "3552981124");
});

test("deduplicates repeated links", () => {
  const leads = extractListingLinks(sample + sample);
  assert.equal(leads.length, 3);
});

test("handles quoted-printable line breaks", () => {
  const leads = extractListingLinks("https://www.autoscout24.de/angebote/=\r\nkia-ceed-abc-0eb02f7a-77a1-46c3-9e05-231e267fbd13");
  assert.equal(leads.length, 1);
});
