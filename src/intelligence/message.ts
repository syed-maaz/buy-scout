import type { NormalisedListing } from "../core/types.js";
import type { CarEvaluation } from "../domain/cars/evaluate.js";
import type { ListingResearch } from "./research.js";

export type MessageLanguage = "de" | "en";

export interface SellerMessage {
  language: MessageLanguage;
  detectedLanguage: MessageLanguage;
  text: string;
  model: string;
  generatedAt: string;
}

const GERMAN_WORDS = /\b(der|die|das|und|mit|für|fahrzeug|baujahr|kilometer|schaltgetriebe|automatik|benzin|diesel|unfall|scheckheft|tüv|hu|au|verkauf|preis|innenraum|ausstattung|garantie|vorbesitzer|fahrbereit)\b/gi;
const ENGLISH_WORDS = /\b(the|and|with|vehicle|car|mileage|petrol|diesel|accident|service|history|warranty|owner|price|gearbox|automatic|interior|equipment|available|please|thank)\b/gi;

function countMatches(text: string, regex: RegExp): number {
  return text.match(regex)?.length ?? 0;
}

export function detectAdLanguage(listing: NormalisedListing): MessageLanguage {
  const text = `${listing.title} ${listing.variant ?? ""} ${listing.description ?? ""}`.toLowerCase();
  if (!text.trim()) return /[äöüß]/i.test(listing.title) ? "de" : "de";
  const de = countMatches(text, GERMAN_WORDS) + (/[äöüß]/i.test(text) ? 4 : 0);
  const en = countMatches(text, ENGLISH_WORDS) + (/\b(and|the|with|from|this)\b/i.test(text) ? 2 : 0);
  return en > de ? "en" : "de";
}

function carLine(listing: NormalisedListing): string {
  const bits = [
    listing.title,
    listing.firstRegistration?.slice(0, 10),
    listing.mileageKm === null ? "mileage unknown" : `${listing.mileageKm.toLocaleString("de-DE")} km`,
    listing.priceEur === null ? "price unknown" : `${listing.priceEur.toLocaleString("de-DE")} €`,
  ];
  return bits.join(" · ");
}

function variantQuestions(_listing: NormalisedListing, research: ListingResearch | null): string[] {
  const problems = research?.commonProblems ?? [];
  return problems.map((problem) => {
    if (problem.issue.toLowerCase().includes("dsg") || problem.issue.toLowerCase().includes("mechatronic")) {
      return "Wurde das DSG-Getriebeöl und die Mechatronik gewartet? Gibt es Auffälligkeiten beim Schalten, insbesondere beim Anfahren und im Rückwärtsgang?";
    }
    if (problem.issue.toLowerCase().includes("timing") || problem.issue.toLowerCase().includes("kette")) {
      return "Wurde die Steuerkette bzw. der Zahnriemen bereits ersetzt? Bitte um Rechnungen und Angabe des Kilometerstands.";
    }
    if (problem.issue.toLowerCase().includes("water pump") || problem.issue.toLowerCase().includes("kühlmittel")) {
      return "Wurde die Wasserpumpe bzw. das Thermostatgehäuse bereits erneuert? Gibt es Kühlmittelverlust oder Überhitzung?";
    }
    if (problem.issue.toLowerCase().includes("injector") || problem.issue.toLowerCase().includes("egr") || problem.issue.toLowerCase().includes("dpf")) {
      return "Gibt es Auffälligkeiten an Injektoren, EGR oder DPF? Bitte um Fehlerspeicher-Ausdruck und DPF-Werte.";
    }
    if (problem.issue.toLowerCase().includes("heater")) {
      return "Gab es bereits Probleme mit dem Wärmetauscher oder Wassereintritt im Innenraum?";
    }
    return `Gibt es zu folgendem bekannten Punkt Auffälligkeiten: ${problem.issue}?`;
  });
}

function germanMessage(listing: NormalisedListing, _evaluation: CarEvaluation, research: ListingResearch | null): string {
  const problems = research?.commonProblems ?? [];
  const lines: string[] = [];
  lines.push("Sehr geehrte Damen und Herren,");
  lines.push("");
  lines.push(`ich interessiere mich für Ihr Fahrzeug ${carLine(listing)} (Inserat ${listing.externalId}).`);
  lines.push("Bevor ich eine Besichtigung vereinbare, möchte ich die wichtigsten Punkte verbindlich klären:");
  lines.push("");
  const questions = [
    "Bitte senden Sie mir die vollständige Fahrzeugidentifikationsnummer (FIN/VIN) und bestätigen Sie, dass das Fahrzeug unfallfrei ist.",
    "Wann ist die nächste HU/AU fällig? Bitte senden Sie den letzten HU-Bericht.",
    "Ist das Fahrzeug scheckheftgepflegt? Bitte senden Sie alle Service- und Reparaturrechnungen.",
    "Wie viele Vorbesitzer hat das Fahrzeug, und aus welchem Grund wird es verkauft?",
    "Gibt es aktuell Warnleuchten, Fehlerspeichereinträge, Ölverlust, Kühlmittelverlust, ungewöhnliche Geräusche oder Rauchbildung?",
    "Wurden Verschleißteile wie Bremsen, Reifen, Kupplung und Stoßdämpfer bereits erneuert? Bitte um Angabe von Restprofil und Rechnungen.",
    "Gibt es Rost an Schwellen, Radhäusern, Unterboden oder Kofferraumboden? Wurden Unfallschäden fachgerecht repariert?",
    "Ist das Fahrzeug jederzeit fahrbereit und für eine Probefahrt mit Kaltstart verfügbar?",
    ...variantQuestions(listing, research),
  ];
  questions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
  lines.push("");
  if (problems.length) {
    lines.push("Besonders wichtig sind für mich die modelltypischen Punkte:");
    for (const problem of problems.slice(0, 4)) {
      lines.push(`- ${problem.issue}: ${problem.check}`);
    }
    lines.push("");
  }
  lines.push("Bitte senden Sie zusätzlich Fotos vom Motorraum, vom Serviceheft, vom HU-Bericht, von den Schwellen/Radhäusern und vom Kofferraumboden.");
  lines.push("");
  lines.push("Ich bin an einer transparenten Abwicklung interessiert und würde das Fahrzeug nach der Besichtigung unabhängig prüfen lassen. Bitte teilen Sie mir mit, ob der Preis nach einer nachvollziehbaren Prüfung verhandelbar ist.");
  lines.push("");
  lines.push("Vielen Dank für Ihre Rückmeldung. Bitte nennen Sie mir einen Termin für eine Besichtigung.");
  lines.push("");
  lines.push("Mit freundlichen Grüßen");
  lines.push("[Ihr Name]");
  lines.push("[Ihre Telefonnummer]");
  return lines.join("\n");
}

function englishMessage(listing: NormalisedListing, _evaluation: CarEvaluation, research: ListingResearch | null): string {
  const problems = research?.commonProblems ?? [];
  const lines: string[] = [];
  lines.push("Dear Sir or Madam,");
  lines.push("");
  lines.push(`I am interested in your vehicle ${carLine(listing)} (listing ${listing.externalId}).`);
  lines.push("Before arranging a viewing, I would like to clarify the following points:");
  lines.push("");
  const questions = [
    "Please send me the full VIN and confirm that the vehicle has no accident history.",
    "When is the next MOT/roadworthiness inspection due? Please send the latest report.",
    "Is the vehicle fully serviced? Please send all service and repair invoices.",
    "How many previous owners are there, and why is the vehicle being sold?",
    "Are there any warning lights, stored fault codes, oil/coolant leaks, unusual noises or smoke?",
    "Have wear items such as brakes, tyres, clutch and shock absorbers been replaced? Please provide tread depths and invoices.",
    "Is there any rust on the sills, wheel arches, underbody or boot floor? Have accident repairs been carried out?",
    "Is the car available for a cold-start test drive and an independent inspection?",
    ...problems.slice(0, 5).map((problem) => `Could you comment on the known ${problem.issue} issue: ${problem.check}`),
  ];
  questions.forEach((question, index) => lines.push(`${index + 1}. ${question}`));
  lines.push("");
  lines.push("Please also send photos of the engine bay, service book, MOT report, sills/wheel arches and boot floor.");
  lines.push("");
  lines.push("I am looking for a transparent purchase and would have the car independently inspected after viewing. Please let me know whether the price is negotiable after an inspection.");
  lines.push("");
  lines.push("Thank you for your reply. Please suggest a time for a viewing.");
  lines.push("");
  lines.push("Kind regards");
  lines.push("[Your name]");
  lines.push("[Your phone number]");
  return lines.join("\n");
}

export function generateSellerMessage(
  listing: NormalisedListing,
  evaluation: CarEvaluation,
  research: ListingResearch | null,
  requested: MessageLanguage | "auto" = "auto",
): SellerMessage {
  const detected = detectAdLanguage(listing);
  const language = requested === "auto" ? detected : requested;
  const text = language === "de"
    ? germanMessage(listing, evaluation, research)
    : englishMessage(listing, evaluation, research);
  return {
    language,
    detectedLanguage: detected,
    text,
    model: "rules+research-template",
    generatedAt: new Date().toISOString(),
  };
}
