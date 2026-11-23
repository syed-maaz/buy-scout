import type { CarEvaluation } from "../domain/cars/evaluate.js";
import type { NormalisedListing, SearchBrief } from "../core/types.js";

export interface ReportItem {
  listing: NormalisedListing;
  evaluation: CarEvaluation;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eur(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("de-DE")} €`;
}

function km(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("de-DE")} km`;
}

const VERDICT_HELP: Record<CarEvaluation["verdict"], string> = {
  inspect: "Passes hard gates and family fields are known; relative score >= 65. Worth a viewing, not a guarantee.",
  ask: "Passes hard gates, but seats/doors/ISOFIX/body type are unknown. Ask the seller before booking.",
  watch: "Passes hard gates, but relative score is below 65. Keep watching.",
  reject: "Failed a hard gate or red flag; score 0. Revisit only if data or criteria change.",
};

function badge(verdict: CarEvaluation["verdict"]): string {
  const map: Record<CarEvaluation["verdict"], string> = {
    inspect: "var(--good)",
    ask: "var(--ask)",
    watch: "var(--watch)",
    reject: "var(--bad)",
  };
  return `<span class="badge" title="${esc(VERDICT_HELP[verdict])}" style="background:${map[verdict]}">${esc(verdict.toUpperCase())}</span>`;
}

export function renderReport(args: {
  items: ReportItem[];
  generatedAt: string;
  criteriaVersion: number;
  brief: SearchBrief;
  counts: { listings: number; decisions: number; observations: number };
  sources: Array<{ id: string; label: string; status: string; note: string; runs: number; avgFound: number | null }>;
}): string {
  const passed = args.items.filter((item) => item.evaluation.verdict === "inspect").length;
  const ask = args.items.filter((item) => item.evaluation.verdict === "ask").length;

  const rows = args.items
    .map(({ listing, evaluation }) => {
      const flags = listing.redFlags.length ? `<div class="flags">Flags: ${esc(listing.redFlags.join(", "))}</div>` : "";
      const detail =
        evaluation.hardFailures.length > 0
          ? evaluation.hardFailures.map(esc).join(" · ")
          : evaluation.unknowns.length > 0
            ? `Unknowns: ${esc(evaluation.unknowns.join(", "))}`
            : evaluation.reasons.map(esc).join(" · ");
      return `<article class="card">
        <div class="card-head">
          ${badge(evaluation.verdict)}
          <span class="score">${evaluation.score.toFixed(1)}</span>
          <a class="title" href="${esc(listing.url)}" target="_blank" rel="noreferrer">${esc(listing.title)}</a>
        </div>
        <div class="meta">
          <span>${eur(listing.priceEur)}</span>
          <span>${km(listing.mileageKm)}</span>
          <span>${esc(listing.firstRegistration?.slice(0, 7) ?? "—")}</span>
          <span>${esc(listing.fuel ?? "—")}</span>
          <span>${esc(listing.transmission ?? "—")}</span>
          <span>${esc(listing.city ?? "—")} · ${listing.distanceKm ?? "?"} km</span>
        </div>
        <div class="family">
          Seats ${esc(listing.seats ?? "?")} · Doors ${esc(listing.doors ?? "?")} ·
          ISOFIX ${listing.hasIsofix === null ? "?" : listing.hasIsofix ? "yes" : "no"} ·
          ${esc(listing.bodyType ?? "body ?")}
        </div>
        <div class="detail">${detail}</div>
        ${flags}
        <div class="foot">confidence ${evaluation.confidence.toFixed(2)} · ${esc(listing.source)} · ${esc(listing.externalId)}</div>
      </article>`;
    })
    .join("\n");

  const sourceRows = args.sources
    .map(
      (source) => `<tr>
        <td>${esc(source.id)}</td>
        <td>${esc(source.status)}</td>
        <td>${source.runs}</td>
        <td>${source.avgFound ?? "—"}</td>
        <td>${esc(source.note)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>buy-scout — shortlist</title>
  <style>
    :root { --bg:#0c0f14; --panel:#141a22; --text:#e8eef6; --muted:#93a1b5; --line:#263140; --good:#1f9d55; --ask:#b7791f; --watch:#4a5568; --bad:#c53030; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    header { padding:28px 24px 18px; border-bottom:1px solid var(--line); }
    h1 { margin:0 0 6px; font-size:24px; letter-spacing:-0.02em; }
    .sub { color:var(--muted); }
    .stats { display:flex; gap:18px; flex-wrap:wrap; margin-top:16px; }
    .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px; }
    .stat b { display:block; font-size:20px; }
    main { max-width:1100px; margin:0 auto; padding:22px 24px 60px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin:12px 0; }
    .card-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .badge { color:#fff; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:700; letter-spacing:.04em; }
    .score { font-variant-numeric:tabular-nums; color:var(--muted); font-weight:600; }
    .title { color:var(--text); font-weight:650; text-decoration:none; }
    .title:hover { text-decoration:underline; }
    .meta, .family { display:flex; gap:12px; flex-wrap:wrap; color:var(--muted); margin-top:8px; font-size:13px; }
    .detail { margin-top:8px; color:#c7d2e0; font-size:13px; }
    .flags { margin-top:6px; color:#feb2b2; font-size:13px; }
    .foot { margin-top:8px; color:#6f7f93; font-size:11px; }
    table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; }
    th { color:var(--muted); font-weight:600; }
    h2 { margin:30px 0 10px; font-size:17px; }
    .disclaimer-bar { margin-top:14px; padding:9px 12px; border:1px solid #5a4a1f; background:#1c180d; color:#f6e05e; border-radius:9px; font-size:13px; }
    .legend { margin-top:12px; border:1px solid var(--line); border-radius:10px; background:var(--panel); padding:12px 14px; }
    .legend summary { cursor:pointer; color:var(--muted); font-size:13px; }
    .legend-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:10px; margin-top:10px; }
    .legend-item { border:1px solid var(--line); border-radius:8px; padding:9px 11px; color:#c7d2e0; font-size:13px; }
    .legend-item b { display:inline-block; margin-right:6px; }
    .legend-note { margin-top:10px; color:var(--muted); font-size:12px; line-height:1.5; }
  </style>
</head>
<body>
<header>
  <h1>buy-scout — family car shortlist</h1>
  <div class="sub">${esc(args.brief.location.zip)} · up to ${eur(args.brief.purchaseMaxEur)} · ${eur(args.brief.budgetAllInEur)} all-in · ${args.brief.location.radiusKm} km · criteria v${args.criteriaVersion} · generated ${esc(args.generatedAt)}</div>
  <div class="stats">
    <div class="stat"><b>${args.counts.listings}</b>listings</div>
    <div class="stat"><b>${passed}</b>inspect</div>
    <div class="stat"><b>${ask}</b>ask</div>
    <div class="stat"><b>${args.counts.decisions}</b>decisions</div>
    <div class="stat"><b>${args.counts.observations}</b>memory rows</div>
  </div>
  <div class="disclaimer-bar">Screening labels only — not a purchase recommendation. Verify VIN, HU/AU, service history, accident history and test-drive before buying.</div>
  <details class="legend">
    <summary>What do INSPECT / ASK / WATCH / REJECT mean?</summary>
    <div class="legend-grid">
      <div class="legend-item"><span class="badge" style="background:var(--good)">INSPECT</span><b>Worth a viewing.</b> Passes all hard gates, family fields are known, score >= 65. Shortlist label, not an approval.</div>
      <div class="legend-item"><span class="badge" style="background:var(--ask)">ASK</span><b>Ask the seller first.</b> Passes hard gates, but seats/doors/ISOFIX/body type are unknown. Not a rejection.</div>
      <div class="legend-item"><span class="badge" style="background:var(--watch)">WATCH</span><b>Keep watching.</b> Passes hard gates, family fields known, score below 65.</div>
      <div class="legend-item"><span class="badge" style="background:var(--bad)">REJECT</span><b>Failed a hard rule.</b> Price, distance, seats, doors, ISOFIX, year, mileage, damage, commercial-only seller or red flag. Score 0.</div>
    </div>
    <div class="legend-note"><b>Score</b> is a 0–100 relative fit ranking, not a probability or quality rating. <b>Confidence</b> is data completeness (0–1), not model certainty. A badge never verifies seller claims. Check VIN, HU/AU, service history, accident history, mileage, ownership, cold start, test drive and an independent inspection.</div>
  </details>
</header>
<main>
  ${rows || "<p>No listings yet. Run <code>npm run fetch:as24</code>.</p>"}
  <h2>Sources</h2>
  <table>
    <thead><tr><th>Source</th><th>Status</th><th>Runs</th><th>Avg found</th><th>Note</th></tr></thead>
    <tbody>${sourceRows}</tbody>
  </table>
</main>
</body>
</html>`;
}
