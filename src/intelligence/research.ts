import { z } from "zod";
import type { NormalisedListing } from "../core/types.js";
import type { CarEvaluation } from "../domain/cars/evaluate.js";
import { callLlmJson, readLlmConfig } from "./llm.js";

export interface ResearchSource {
  title: string;
  url: string;
}

export interface CommonProblem {
  issue: string;
  likelihood: "high" | "medium" | "low";
  symptoms: string[];
  check: string;
  costEur: string;
}

const ResearchPayloadSchema = z.object({
  summary: z.string().default(""),
  goodPoints: z.array(z.string()).default([]),
  badPoints: z.array(z.string()).default([]),
  commonProblems: z
    .array(
      z.object({
        issue: z.string(),
        likelihood: z.enum(["high", "medium", "low"]),
        symptoms: z.array(z.string()).default([]),
        check: z.string().default(""),
        costEur: z.string().default(""),
      }),
    )
    .default([]),
  inspectionChecklist: z.array(z.string()).default([]),
  sellerQuestions: z.array(z.string()).default([]),
  negotiation: z.array(z.string()).default([]),
  recalls: z.array(z.string()).default([]),
  sources: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
});

export interface ListingResearch {
  summary: string;
  goodPoints: string[];
  badPoints: string[];
  commonProblems: CommonProblem[];
  inspectionChecklist: string[];
  sellerQuestions: string[];
  negotiation: string[];
  recalls: string[];
  sources: ResearchSource[];
  researchBasis: "web+model" | "web+rules" | "model_knowledge" | "rules_only";
  provider: string;
  model: string;
  generatedAt: string;
}

const VW_SOURCES: ResearchSource[] = [
  { title: "VW Passat B7 common problems — automotive24", url: "https://automotive24.center/article/volkswagen-passat-vii-mk7-b7-typ-3c-2010-2015-common-drawbacks-and-what-to-watch-for-when-buying-used" },
  { title: "VW Polo 6R 1.2 TSI common faults — Auto Gas Gaga", url: "https://gaga.ba/en/najcesci-kvarovi/vw-polo-6r-1-2-tsi" },
  { title: "Top Gear used Volkswagen Polo buying guide", url: "https://www.topgear.com/car-news/top-gear-advice/top-gears-guide-buying-a-used-volkswagen-polo" },
];

function carText(listing: NormalisedListing): string {
  return `${listing.make ?? ""} ${listing.model ?? ""} ${listing.variant ?? ""} ${listing.title}`.toLowerCase();
}

function variantProblems(listing: NormalisedListing): CommonProblem[] {
  const text = carText(listing);
  const problems: CommonProblem[] = [];
  const diesel = (listing.fuel ?? "").toLowerCase().includes("diesel");
  const auto = (listing.transmission ?? "").toLowerCase().includes("autom");

  if (text.includes("passat")) {
    problems.push(
      {
        issue: "DSG / mechatronic wear",
        likelihood: "high",
        symptoms: ["jerky low-speed shifts", "delayed engagement", "flashing gear indicator"],
        check: "Cold and warm test drive; scan TCU for clutch adaptation and mechatronic faults; check DSG oil service.",
        costEur: "€800–€2,500",
      },
      {
        issue: "2.0 TDI injector / EGR / DPF",
        likelihood: diesel ? "high" : "low",
        symptoms: ["rough idle", "limp mode", "white/black smoke", "rising oil level"],
        check: "Read injector correction values, EGR/DPF soot mass, DPF differential pressure; check for bypassed DPF.",
        costEur: "€400–€2,000",
      },
      {
        issue: "Heater core / water ingress",
        likelihood: "medium",
        symptoms: ["sweet smell", "fogged windows", "wet passenger footwell"],
        check: "Check coolant level and carpets; pressure-test cooling system; inspect pollen filter housing.",
        costEur: "€500–€1,200",
      },
    );
  }
  if (text.includes("polo")) {
    problems.push(
      {
        issue: "1.2 TSI timing chain / tensioner",
        likelihood: "high",
        symptoms: ["rattle on cold start", "chain noise at idle", "engine warning"],
        check: "Cold-start listen; scan for cam/crank correlation; verify chain revision and service history.",
        costEur: "€500–€1,500",
      },
      {
        issue: "Water pump / thermostat housing",
        likelihood: "medium",
        symptoms: ["coolant loss", "overheating", "sweet smell"],
        check: "Pressure-test cooling system; inspect pump area and thermostat housing for residue.",
        costEur: "€300–€700",
      },
      {
        issue: "Ignition coils / misfire",
        likelihood: "medium",
        symptoms: ["rough idle", "check-engine light", "hesitation under load"],
        check: "Read misfire counters per cylinder; inspect coils and plugs; compression test if persistent.",
        costEur: "€80–€400",
      },
    );
  }
  if (text.includes("golf") || text.includes("jetta") || text.includes("touran")) {
    problems.push(
      {
        issue: "TSI timing chain / oil consumption",
        likelihood: "medium",
        symptoms: ["cold-start rattle", "oil warning", "blue smoke"],
        check: "Cold start, oil consumption history, chain revision, compression/leak-down.",
        costEur: "€500–€2,000",
      },
      {
        issue: "DSG clutch / mechatronic",
        likelihood: auto ? "high" : "low",
        symptoms: ["shudder", "jerky pull-away", "delayed reverse"],
        check: "Scan DSG adaptations; test low-speed manoeuvres; check DSG service.",
        costEur: "€800–€2,500",
      },
    );
  }
  if (diesel && !text.includes("passat")) {
    problems.push({
      issue: "Diesel DPF / EGR / turbo",
      likelihood: "medium",
      symptoms: ["limp mode", "smoke", "poor regen", "whistle"],
      check: "Scan DPF soot/ash, EGR position, boost deviation; check for deleted emissions hardware.",
      costEur: "€300–€1,800",
    });
  }
  if (auto && !problems.some((problem) => problem.issue.toLowerCase().includes("dsg"))) {
    problems.push({
      issue: "Automatic gearbox service history",
      likelihood: "medium",
      symptoms: ["jerky shifts", "delayed engagement", "slipping"],
      check: "Test cold/warm; check gearbox oil service; scan for adaptation faults.",
      costEur: "€300–€2,000",
    });
  }
  if ((listing.mileageKm ?? 0) > 150_000) {
    problems.push({
      issue: "High-mileage wear items",
      likelihood: "high",
      symptoms: ["suspension knock", "clutch slip", "brake vibration"],
      check: "Inspect shocks, bushings, clutch, brakes, tyres and service items; budget for wear.",
      costEur: "€300–€1,500",
    });
  }
  if ((listing.firstRegistration?.slice(0, 4) ?? "9999") < "2012") {
    problems.push({
      issue: "Age-related corrosion and electrics",
      likelihood: "medium",
      symptoms: ["rust at arches/sills", "window/central-lock faults", "damp smells"],
      check: "Inspect jacking points, sills, arches, boot floor, sunroof drains and electrical functions.",
      costEur: "€200–€1,500",
    });
  }
  return problems.slice(0, 6);
}

function fallbackResearch(listing: NormalisedListing, evaluation: CarEvaluation): ListingResearch {
  const problems = variantProblems(listing);
  const good: string[] = [];
  const bad: string[] = [];

  if (evaluation.hardPass) good.push("Passes all active hard gates.");
  if (evaluation.components.family >= 0.8) good.push("Strong family fit: seats, doors, ISOFIX and body type line up.");
  if (evaluation.components.deal >= 0.75) good.push("Priced well against the available median/label.");
  if (evaluation.components.mileage >= 0.7) good.push("Mileage is low relative to the 180,000 km cap.");
  if (evaluation.components.age >= 0.7) good.push("Newer end of the allowed year range.");
  if (evaluation.components.distance >= 0.6) good.push("Relatively close to the search location.");
  if (listing.hasIsofix) good.push("ISOFIX confirmed.");
  if (listing.huDue) good.push(`HU date recorded: ${listing.huDue}.`);

  for (const unknown of evaluation.unknowns) bad.push(`${unknown} is not stated in the listing.`);
  for (const failure of evaluation.hardFailures) bad.push(failure);
  if (listing.redFlags.length) bad.push(`Seller/listing red flags: ${listing.redFlags.join(", ")}.`);
  if ((listing.mileageKm ?? 0) > 150_000) bad.push("High mileage for the age; wear items are likely.");
  if (evaluation.components.age < 0.5) bad.push("Old relative to the budget; corrosion and rubber parts need attention.");
  if (!listing.description?.match(/scheckheft|service|wartung/i)) bad.push("No service-history wording in the listing.");
  if (!listing.huDue) bad.push("No HU due date in the data; ask for the report.");
  if (!bad.length) bad.push("No obvious listing-level red flag; the remaining risk is mechanical.");

  const checklist = [
    "Cold start from stone cold; listen for chain rattle, turbo whistle and misfire.",
    "Check VIN against the listing, service book and HU report.",
    "Scan all ECUs; look for pending faults, DPF/EGR edits and mileage inconsistencies.",
    "Inspect sills, jacking points, wheel arches, boot floor and underbody for corrosion.",
    "Check tyres, brakes, suspension and clutch/DSG behaviour on a test drive.",
    "Verify all keys, service invoices, timing-belt/chain history and recent repairs.",
    "Check electrics: windows, central locking, AC, lights, infotainment, parking sensors.",
    "Confirm the seller's identity and that the car is not an export/commercial-only sale.",
  ];
  if (problems.some((problem) => problem.issue.toLowerCase().includes("dsg"))) {
    checklist.push("DSG: test low-speed creep, reverse engagement and kickdown; scan TCU adaptations.");
  }
  if (problems.some((problem) => problem.issue.toLowerCase().includes("dpf"))) {
    checklist.push("Diesel: read DPF soot/ash mass and EGR position; confirm the DPF is present and not bypassed.");
  }

  const sellerQuestions = [
    "Is the car accident-free? Can you send the VIN and HU report?",
    "Is it scheckheftgepflegt? Please send the service invoices.",
    "How many previous owners, and why is it being sold?",
    "When is the next HU/AU due?",
    "Have the timing chain/belt, water pump, clutch or DSG been replaced?",
    "Are there any current warning lights, leaks, noises or faults?",
    "Is the price negotiable after an independent inspection?",
  ];

  return {
    summary:
      `Rules put this car at ${evaluation.verdict.toUpperCase()} (${evaluation.score.toFixed(1)}). ` +
      `The main variant risks are ${problems.slice(0, 3).map((problem) => problem.issue).join(", ") || "generic wear"}. ` +
      "This is a model-knowledge brief, not a verified inspection.",
    goodPoints: good,
    badPoints: bad,
    commonProblems: problems,
    inspectionChecklist: checklist,
    sellerQuestions,
    negotiation: [
      "Make the offer subject to an independent inspection and a clean ECU scan.",
      "Use missing service history, tyres/brakes and any fault codes as price arguments.",
      "Do not pay a deposit before VIN, HU and seller identity checks.",
    ],
    recalls: [],
    sources: /(passat|polo|golf|volkswagen|\bvw\b)/.test(carText(listing)) ? VW_SOURCES : [],
    researchBasis: "model_knowledge",
    provider: "none",
    model: "deterministic-variant-kb",
    generatedAt: new Date().toISOString(),
  };
}

async function firecrawlSearch(query: string): Promise<ResearchSource[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit: 5 }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: { web?: Array<{ title?: string; url?: string }> } };
    return (payload.data?.web ?? [])
      .filter((item) => item.url)
      .map((item) => ({ title: item.title ?? item.url!, url: item.url! }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function researchListing(
  listing: NormalisedListing,
  evaluation: CarEvaluation,
): Promise<ListingResearch> {
  const fallback = fallbackResearch(listing, evaluation);
  const web = await firecrawlSearch(
    `${listing.make ?? ""} ${listing.model ?? ""} ${listing.variant ?? ""} common problems buying guide inspection`,
  );
  const config = readLlmConfig();
  if (!config) {
    return {
      ...fallback,
      sources: web.length ? web : fallback.sources,
      researchBasis: web.length ? "web+rules" : "model_knowledge",
    };
  }

  const prompt = `Du bist ein deutscher Gebrauchtwagen-Analyst. Erstelle eine vorsichtige, prüfbare Analyse für dieses Fahrzeug. Erfinde keine VIN, keine Historie und keine Reparaturbelege.

Fahrzeug:
${JSON.stringify(listing, null, 2)}

Regel-Ergebnis:
${JSON.stringify(evaluation, null, 2)}

Web-Suchergebnisse (nur als Hinweise, nicht als Wahrheit):
${JSON.stringify(web, null, 2)}

Antworte ausschließlich als JSON:
{
  "summary": "string",
  "goodPoints": ["string"],
  "badPoints": ["string"],
  "commonProblems": [{"issue":"string","likelihood":"high|medium|low","symptoms":["string"],"check":"string","costEur":"string"}],
  "inspectionChecklist": ["string"],
  "sellerQuestions": ["string"],
  "negotiation": ["string"],
  "recalls": ["string"],
  "sources": [{"title":"string","url":"string"}]
}

Regeln: Keine erfundenen Quellen. Wenn du etwas nicht weißt, schreibe "unbekannt" oder lasse das Feld leer. Quellen nur aus den Web-Suchergebnissen übernehmen.`;

  const result = await callLlmJson({
    system: "Du antwortest nur mit validem JSON. Keine Halluzinationen.",
    user: prompt,
    timeoutMs: 60_000,
  });
  if (!result) {
    return {
      ...fallback,
      sources: web.length ? web : fallback.sources,
      researchBasis: web.length ? "web+rules" : "model_knowledge",
    };
  }

  const validated = ResearchPayloadSchema.safeParse(result.data);
  if (!validated.success) return fallback;
  const parsed = validated.data;
  return {
    ...fallback,
    ...parsed,
    commonProblems: parsed.commonProblems.length ? parsed.commonProblems : fallback.commonProblems,
    sources: web.length ? web : parsed.sources.length ? parsed.sources : fallback.sources,
    researchBasis: web.length ? "web+model" : "model_knowledge",
    provider: result.provider,
    model: result.model,
    generatedAt: new Date().toISOString(),
  };
}
