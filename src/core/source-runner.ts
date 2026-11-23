import { classifyAccessFailure, recommendStrategies } from "../acquisition/playbook.js";
import type {
  ParallelFetchResult,
  SearchBrief,
  SearchOptions,
  SourceAdapter,
  SourceFailure,
  SourceSearchResult,
} from "./types.js";

/**
 * A result is usable only when the source honoured the filters and returned
 * at least one reference. A filter-invalid result is not a success, even when
 * it contains references: the CLI deliberately refuses to persist it.
 */
export function isUsableSourceResult(result: SourceSearchResult): boolean {
  return result.integrity.ok && result.refs.length > 0;
}

/**
 * Run every enabled source concurrently. There is no source priority:
 * a slow or blocked source must never hold back the others.
 */
export async function runSources(
  adapters: SourceAdapter[],
  brief: SearchBrief,
  opts: SearchOptions = {},
): Promise<ParallelFetchResult> {
  const active = adapters.filter((adapter) => adapter.enabled);
  const settled = await Promise.allSettled(
    active.map((adapter) => adapter.search(brief, opts)),
  );

  const results: SourceSearchResult[] = [];
  const failures: SourceFailure[] = [];

  settled.forEach((entry, index) => {
    const adapter = active[index];
    if (entry.status === "fulfilled") {
      results.push(entry.value);
    } else {
      const symptom = classifyAccessFailure(entry.reason);
      failures.push({
        source: adapter.id,
        error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
        symptom,
        recommendations: recommendStrategies(symptom).map((rec) => rec.strategy),
      });
    }
  });

  return { results, failures };
}
