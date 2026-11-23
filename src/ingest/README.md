# Email Ingest

## Overview

Turns marketplace notification emails into `EmailLead` records. `ingest/email.ts` is a
regex extractor, not an IMAP client: the caller supplies the email text (or a file
path), and the module returns deduplicated listing links with a detected source and a
normalised external id. It backs the `npm run email` CLI and is deliberately
dependency-free so it stays testable against saved `.eml` fixtures.

## Interface

- `EmailSource` — union of `"mobile_de" | "autoscout24" | "kleinanzeigen" | "unknown"`
  (`email.ts:3`).
- `EmailLead` — `{ source, externalId, url, emailFile, foundAt }` (`email.ts:5`).
- `extractListingLinks(text: string, emailFile = "inline"): EmailLead[]` (`email.ts:46`).
- `parseEmailFile(path: string): EmailLead[]` (`email.ts:71`).
- Module-private helpers: `clean` (quoted-printable soft breaks and HTML entities,
  `email.ts:13`), `sourceOf` (`email.ts:21`), `externalIdOf` (`email.ts:28`).
- No subdirectories.

## Invariants

- **Source detection is host+path based**, not header based: `suchen.mobile.de` /
  `mobile.de/auto-inserat`, `autoscout24.de/angebote`, `kleinanzeigen.de/s-anzeige`
  (`email.ts:22`–`email.ts:25`).
- **Two-stage URL filtering**: the URL must match a marketplace host *and* a listing
  path fragment (`auto-inserat`, `fahrzeuge/details`, `/angebote/`, `/s-anzeige/`)
  before it becomes a lead (`email.ts:54`–`email.ts:55`).
- **Deduplication is by exact URL** via a `Set`, first occurrence wins (`email.ts:49`,
  `email.ts:56`).
- **Trailing punctuation is stripped** (`[),.;]+$`) before dedupe and storage
  (`email.ts:53`).
- **External ids are parsed per source** and fall back to the raw URL when no pattern
  matches: AutoScout24 UUID suffix, Kleinanzeigen `/{digits}-216-`, mobile.de `?id=` or
  `/{digits}.html` (`email.ts:29`–`email.ts:43`).
- `foundAt` is the extraction time (`new Date().toISOString()`), not the email date
  (`email.ts:64`).
- `unknown` is a valid detected source; leads are still emitted for known marketplace
  hosts whose path matched but whose id could not be parsed.

## Side Effects

- `parseEmailFile` performs synchronous filesystem reads (`readFileSync`, `email.ts:72`)
  and propagates read errors to the caller.
- `extractListingLinks` reads the system clock for `foundAt`.
- No network access and no database writes.

## Verification

- Run: `npm test`
