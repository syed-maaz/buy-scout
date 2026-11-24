# buy-scout

**Eine lokale Such- und Kaufentscheidungs-Engine: aus einem Suchauftrag wird eine
sortierte, erklärte Kandidatenliste.**

buy-scout ist aktuell ein funktionierender Prototyp für den **deutschen
Gebrauchtwagenmarkt**: Die Anwendung durchsucht mehrere Plattformen, normalisiert die
Inserate in ein gemeinsames Datenmodell, wendet deterministische Familien- und
Budgettregeln an, sortiert die Ergebnisse und ergänzt eine optionale KI-Analyse. Alles läuft
auf dem eigenen Rechner. Inserate, Entscheidungen und Zugangsdaten bleiben lokal.

> **Status:** früher öffentlicher Prototyp. Die Fahrzeug-Domäne funktioniert; die
> generische Engine und der MCP-Server sind die nächsten großen Meilensteine.
>
> **Lizenz:** MIT. **Sprache:** [English](./README.md) | Deutsch

---

## Das Ziel

Langfristig soll buy-scout eine **generische Such- und Kauf-Engine für beliebige Dinge**
sein – nicht nur für Autos.

Man beschreibt in einem strukturierten Suchauftrag, was man braucht:

```text
Kategorie      Auto, Fahrrad, Laptop, Wohnung, Kamera, ...
Budget         Kaufpreis + Reserve
Ort            Postleitzahl + Radius
Harte Kriterien  Muss-Kriterien und Ausschlüsse
Präferenzen    was höher gewichtet werden soll
Nachweise      welche Angaben bekannt sein müssen
```

Die Engine soll dann:

1. passende Angebote aus mehreren Quellen abrufen,
2. sie in eine vergleichbare Form normalisieren,
3. deterministische Filter und harte Ausschlüsse anwenden,
4. die verbleibenden Kandidaten bewerten und sortieren,
5. bei fehlenden Angaben nachfragen statt zu raten,
6. eine KI-Analyse und einen Recherche-Bericht ergänzen,
7. die Entscheidung und das Ergebnis dokumentieren,
8. aus dem Ergebnis für die nächste Suche lernen.

Die Fahrzeug-Domäne ist zuerst vollständig umgesetzt, weil der Gebrauchtwagenkauf eine
echte, folgenreiche Entscheidung mit unübersichtlichen Marktdaten ist. Der Kern ist bewusst
von den Fahrzeugregeln getrennt, damit später weitere Kategorien folgen können.

**Automatisierung ist das Ziel:** Ein geplanter Lauf soll Angebote abrufen, bewerten,
erklären und die besten Optionen anzeigen, ohne dass man die Suche jeden Tag neu aufbauen
muss. Die Bausteine dafür sind vorhanden; Zeitplanung und die MCP-Schnittstelle sind die
nächsten Schritte.

---

## Was heute funktioniert

| Bereich | Stand |
|---|---|
| AutoScout24 | Suche, Detailanreicherung, Familienfelder |
| Kleinanzeigen | Suche, Detail-HTML, Import einzelner URLs |
| AutoUncle | Jina Reader mit lokalem Chrome-Fallback, Pagination |
| mobile.de | profilgestützte Suche auf Seite 1; E-Mail-Import; standardmäßig deaktiviert |
| Normalisierung | ein Datenmodell über alle Quellen, Dedupe, Preisverlauf |
| Regeln | Budget, Entfernung, Sitze, Türen, ISOFIX, Baujahr, Laufleistung, Schäden, Händlertyp, Warnsignale |
| Urteile | `inspect`, `ask`, `watch`, `reject` |
| UI | lokale Web-Oberfläche, Kriterien, Filter, Analyse, Recherche, Entscheidungen |
| CLI | Fetch, Score, Analyse, Recherche, Health, Report, Eval, Import |
| Lokale KI | Laya für beratende Triage |
| Remote-KI | optionaler OpenAI-kompatibler LLM-Endpunkt (`LLM_*`) |
| Speicher | SQLite (WAL), Roh-Snapshots, Preisverlauf, Entscheidungen, Ergebnisse |
| MCP | **nur Design**, noch nicht implementiert |

---

## So funktioniert es

```text
Suchauftrag
    │
    ▼
Quellen-Adapter (parallel, Fehler bleiben isoliert)
    │  AutoScout24 · Kleinanzeigen · AutoUncle · mobile.de
    ▼
Roh-Snapshots + normalisierte Inserate + Dedupe
    │
    ▼
Deterministische Bewertung
    │  harte Gates → unbekannte Felder → Score → Urteil
    ├── reject   harter Ausschluss, Score 0
    ├── ask      ein blockierendes Feld ist unbekannt
    ├── watch    Gates bestanden, Score < 65
    └── inspect  Gates bestanden, vollständig, Score >= 65
    │
    ▼
Shortlist + optionale Laya-Triage + optionale LLM-Analyse/Recherche
    │
    ▼
Menschliche Entscheidung → gespeichert / Kontakt / Besichtigung / verworfen
    │
    ▼
Ergebnis + lokales Lernen
```

### Grundregeln

- **Parser extrahieren; Modelle erklären.** Die KI erfindet keine Inseratsfelder.
- **Regeln entscheiden über jeden Ausschluss.** Die KI kann ein hartes Gate oder das
  Regel-Urteil nicht ändern.
- **Unbekannt ist kein „Nein“.** Ein fehlendes Pflichtfeld führt zu `ask`, nicht zu einem
  stillen Ausschluss.
- **Ein Quellenfehler beendet den Lauf nicht.** Quellen laufen parallel und unabhängig.
- **Rohdaten bleiben unverändert.** Normalisierte Inserate sind abgeleitet und
  reproduzierbar.
- **Alles standardmäßig lokal.** SQLite, Snapshots und Zugangsdaten bleiben auf dem Rechner.
- **Keine versteckten Scraping-Tricks.** Zugriffswege und Grenzen werden dokumentiert.

Die vollständige Architektur steht in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), die
Urteilslogik in [docs/VERDICTS.md](./docs/VERDICTS.md).

---

## Lokale API

Die UI ist ein lokaler HTTP-Server unter `http://127.0.0.1:8124`. Sie stellt eine kleine
JSON-API für den Browser bereit; das ist **keine** öffentliche, authentifizierte API.

```bash
npm run ui
# http://127.0.0.1:8124
```

Lesen:

```text
GET  /api/listings
GET  /api/listing?source=...&externalId=...
GET  /api/summary
GET  /api/criteria
```

Aktionen:

```text
POST /api/fetch                 Fetch-Job starten
GET  /api/fetch/status          Fetch-Job abfragen
POST /api/analyze               LLM-Analyse starten
GET  /api/analyze/status        Analyse abfragen
POST /api/research              Deep Research für ein Inserat
POST /api/message               Verkäufernachricht entwerfen
POST /api/action                inspect | watch | skip
POST /api/save                  gespeichert / nicht gespeichert
POST /api/outcome               gekauft / verworfen / HU fehlgeschlagen / ...
POST /api/listing/gone          als verkauft/weg markieren
POST /api/listing/restore       wiederherstellen
POST /api/availability          beim Quell-Detail prüfen
POST /api/import-url            einzelne Inserats-URL importieren
POST /api/criteria              neue Kriterienversion speichern
POST /api/preferences/learn     Präferenzen aus Entscheidungen ableiten
```

Alle Endpunkte, Request-Bodies, Antwortformen und Statuscodes stehen in
**[docs/API.md](./docs/API.md)**.

Sicherheit: Der Server bindet nur an `127.0.0.1` und lehnt Cross-Origin-Mutationen ab. Er
sollte nicht direkt ins Internet gestellt werden.

---

## KI-Schicht

buy-scout trennt drei Dinge:

1. **Regeln** entscheiden Urteil und Score.
2. **Laya** ist ein kleines lokales Modell für beratende Triage.
3. **Der LLM** schreibt Analyse und Recherche, ändert aber nie das Urteil.

Der Remote-LLM ist OpenAI-kompatibel und optional:

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4.1-flash
LLM_API_KEY=<your-key>
LLM_LANGUAGE=de
```

Ohne gültige LLM-Konfiguration wird ein deterministischer lokaler Bericht erzeugt. Laya
funktioniert ohne API-Schlüssel. Details stehen in [docs/ANALYSIS.md](./docs/ANALYSIS.md).

---

## MCP

MCP ist die geplante Schnittstelle für Agenten und Editoren. Sie ist **noch nicht
implementiert**; das Design steht in **[docs/MCP.md](./docs/MCP.md)**.

Der geplante Server stellt die Engine als Werkzeuge bereit, statt SQLite direkt
freizugeben:

```text
search_brief          Suchauftrag anlegen / ändern
run_fetch             passende Inserate aus aktivierten Quellen abrufen
list_candidates       sortierte Shortlist mit Regel-Begründung
evaluate_listing      deterministische Bewertung eines Inserats
analyze_listing       optionale LLM-Analyse eines Inserats
research_listing      optionale Deep Research zu einem Inserat
record_action         inspect / watch / skip / save
record_outcome        gekauft / verkauft / verworfen / HU fehlgeschlagen
compare_candidates    Kandidaten direkt vergleichen
```

Der MCP-Server soll lokal (stdio) laufen, dieselben Kern-Services wie CLI und UI nutzen und
Zugangsdaten aus dem Modellkontext heraushalten.

---

## Fahrplan

### Jetzt — Fahrzeug-POC, lokal

- deutsche Quellen und Verfügbarkeitsprüfungen stabilisieren
- Extraktion und Vollständigkeit der Familienfelder verbessern
- UI und Berichte vollständig zweisprachig machen
- Tests und Evaluations-Fixtures härten

### Als Nächstes — generische Engine + MCP

- Kategorie-Vertrag aus dem Fahrzeug-Pack herauslösen
- eine zweite Kategorie ergänzen, um die Abstraktion zu beweisen
- MCP-Server und Tool-Schemas ergänzen
- geplante Läufe und Benachrichtigungen
- konfigurierbare Score-Profile und Nachweispflichten
- Importe für gespeicherte Suchen, E-Mail-Alerts und CSV/JSON

### Später — produktionsreife Kauf-Engine

- Mehrbenutzer- und Hosted-Betrieb
- Source-Plugin-SDK
- Preis-/Verfügbarkeitshistorie und Markttrends
- menschliche Rückmeldung und gelerntes Ranking
- mobile Oberfläche
- öffentliche API mit Authentifizierung und Rate Limits

Der Fahrplan ist bewusst offen: Das Repository ist ein früher Prototyp, kein fertiges
Produkt. Eine detaillierte Arbeitsliste steht in [docs/ROADMAP.md](./docs/ROADMAP.md).

---

## Schnellstart

Voraussetzungen: Node.js 24+, npm, macOS/Linux. Ein lokales Chrome-Profil wird nur für
mobile.de benötigt.

```bash
git clone https://github.com/syed-maaz/buy-scout.git
cd buy-scout
npm install
cp .env.example .env       # lokal bearbeiten; niemals committen
npm run typecheck
npm test
npm run ui                 # http://127.0.0.1:8124
```

Nützliche Befehle:

```bash
npm run fetch:as24 -- --pages 1 --delay 500
npm run score -- --top 20
npm run analyze
npm run analyze -- --top 10
npm run eval
npm run health
npm run report
npm run import:url -- --url "https://www.kleinanzeigen.de/s-anzeige/..."
npm run import:leads -- --dir ./data/emails
```

Der Beispiel-Suchauftrag ist eine deutsche Familiensuche: **7.000 € Fahrzeugbudget,
800 € Reserve, 200 km Radius**. Das ist ein Startpunkt, keine fest eingebaute Grenze.

Daten liegen in:

```text
data/
  buy-scout.db
  raw/<quelle>/<datum>/*.html|*.json
```

`data/` und `.env` werden von Git ignoriert.

---

## Mitmachen

Das Projekt wird derzeit **allein entwickelt**. Ich baue es öffentlich und freue mich über
Beiträge, Fehlerberichte und Korrekturen. Es gibt kein Team und keine garantierte
Antwortzeit; gute Issues und fokussierte Pull Requests sind aber sehr willkommen.

Gute Beiträge:

- eine Quelle reparsen, die nicht mehr funktioniert (mit redigiertem HTML-Beispiel)
- Fixtures für ein neues Inseratslayout ergänzen
- deutsche/englische Formulierungen verbessern
- ein Kategorie-Pack ergänzen (Fahrrad, Laptop, Wohnung, …)
- das MCP-Design prüfen
- Tests, Doku oder Barrierefreiheit verbessern

Vor einem Pull Request:

```bash
npm run typecheck
npm test
```

Bitte niemals `.env`, Datenbanken, Roh-Inserate, API-Schlüssel, personenbezogene Daten oder
Inhalte committen, die nicht weitergegeben werden dürfen. Bei Zugriffsproblemen bitte ein
Issue öffnen, statt einen Bypass einzubauen.

Es gibt kein CLA. Mit einem Beitrag erklärst du dich damit einverstanden, dass er unter der
MIT-Lizenz des Repositories steht.

---

## Datenschutz und Sicherheit

- Alle Laufzeitdaten bleiben standardmäßig lokal.
- Keine Analytics, kein Tracking, keine Telemetrie.
- `.env`, `data/`, lokale Memory-Dateien und interne Review-Notizen sind nicht im public tree.
- Der LLM sieht nur das normalisierte Inserat und das Regel-Ergebnis, keine API-Schlüssel.
- Ein Inserat wird nur ausgeblendet, wenn die Quelle es bestätigt oder du es markierst.
- Das Tool ersetzt keine Besichtigung, keinen HU/AU-Bericht, keine VIN-Prüfung und keine
  Rechtsberatung.

---

## Lizenz

MIT © 2026 Syed Muhammad Maaz Bin Muzaffar. Siehe [LICENSE](./LICENSE).
