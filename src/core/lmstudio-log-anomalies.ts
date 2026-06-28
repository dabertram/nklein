/**
 * LM Studio dev-log anomaly detector (todo §5.Z, user 2026-06-28: "the test harness should keep an eye on the LM Studio
 * dev log"). The sweep harness already CAPTURES the log; this PURE core scans the captured lines and flags the four
 * anomaly classes the live work surfaced, so a run can surface them instead of burying them:
 *
 *  (a) **catalog hammering** — too many `/api/v0/models` (or `/v1/models`) hits in a run window (the 2026-06-28 incident:
 *      an uncached roster-discovery path hit it ~1/s; mitigated by the 30 s TTL cache, but alarm if it recurs).
 *  (b) **request errors** — non-2xx responses / error lines.
 *  (c) **load events** — model load / unload / load-failure / out-of-resources (e.g. deepseek dropping mid-run, or a
 *      35B `@8bit` refusing to load: "insufficient system resources … would overload your system").
 *  (d) **slow warnings** — slow-prefill / low-throughput notes (feed the MCSR speed priors + power-aware reasoning).
 *
 * Pure + line-based (no I/O) so it is trivially testable on sample lines; the harness pipes its captured log through it
 * and prints {@link summarizeLmStudioLogAnomalies}, folding notable events into the sweep-log note column.
 */

export interface LmStudioLogAnomalies {
	/** Count of catalog-endpoint (`/api/v0/models` | `/v1/models`) requests seen in the captured window. */
	catalogHits: number;
	/** True when `catalogHits` exceeds the threshold — the hammering alarm. */
	catalogHammering: boolean;
	/** Lines indicating a non-2xx / error response. */
	errors: string[];
	/** Lines indicating a model load / unload / load-failure / out-of-resources event. */
	loadEvents: string[];
	/** Lines indicating slow prefill / low throughput. */
	slowWarnings: string[];
}

export interface DetectLmStudioLogOptions {
	/** Max tolerated catalog hits in the captured window before flagging hammering (default 10). */
	catalogHitThreshold?: number;
}

const CATALOG_REQUEST = /\/(?:api\/v0|v1)\/models\b/i;
const HTTP_STATUS = /\b(?:HTTP\/\d(?:\.\d)?\s+)?([45]\d\d)\b/;
const ERROR_LINE = /\b(?:error|exception|failed|refused|ECONN\w*|traceback)\b/i;
const LOAD_EVENT =
	/\b(?:loading model|model loaded|loaded model|unload(?:ed|ing)?|failed to load|cannot load|insufficient (?:system )?resources|out of memory|\boom\b|would overload|crash(?:ed)?|disconnected)\b/i;
const SLOW_WARNING = /\b(?:slow prefill|prefill .*slow|low throughput|slow(?:er)? than|stall(?:ed|ing)?)\b/i;

const DEFAULT_CATALOG_HIT_THRESHOLD = 10;

/** Scan captured LM Studio dev-log lines for the four anomaly classes. Pure; case-insensitive; order-preserving. */
export function detectLmStudioLogAnomalies(
	lines: readonly string[],
	options: DetectLmStudioLogOptions = {},
): LmStudioLogAnomalies {
	const threshold = Math.max(0, options.catalogHitThreshold ?? DEFAULT_CATALOG_HIT_THRESHOLD);
	let catalogHits = 0;
	const errors: string[] = [];
	const loadEvents: string[] = [];
	const slowWarnings: string[] = [];

	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) {
			continue;
		}
		if (CATALOG_REQUEST.test(line)) {
			catalogHits += 1;
		}
		// A 4xx/5xx status OR an explicit error word (but not the catalog-request lines, which are usually 200s).
		const status = line.match(HTTP_STATUS);
		if (status || (ERROR_LINE.test(line) && !CATALOG_REQUEST.test(line))) {
			errors.push(line);
		}
		if (LOAD_EVENT.test(line)) {
			loadEvents.push(line);
		}
		if (SLOW_WARNING.test(line)) {
			slowWarnings.push(line);
		}
	}

	return {
		catalogHits,
		catalogHammering: catalogHits > threshold,
		errors,
		loadEvents,
		slowWarnings,
	};
}

/**
 * One-line human summary of the anomalies, or "" when the log is clean. For the harness's per-run summary + the
 * sweep-log note column. Caps each list in the summary so a noisy log stays one readable line.
 */
export function summarizeLmStudioLogAnomalies(anomalies: LmStudioLogAnomalies, maxPerClass = 2): string {
	const parts: string[] = [];
	if (anomalies.catalogHammering) {
		parts.push(`🐞 catalog hammering (${anomalies.catalogHits} hits — expected ≤ a few/run with the 30s TTL cache)`);
	}
	if (anomalies.loadEvents.length > 0) {
		parts.push(`load/unload events ×${anomalies.loadEvents.length}: ${capList(anomalies.loadEvents, maxPerClass)}`);
	}
	if (anomalies.errors.length > 0) {
		parts.push(`errors ×${anomalies.errors.length}: ${capList(anomalies.errors, maxPerClass)}`);
	}
	if (anomalies.slowWarnings.length > 0) {
		parts.push(`slow ×${anomalies.slowWarnings.length}: ${capList(anomalies.slowWarnings, maxPerClass)}`);
	}
	return parts.length > 0 ? `LM Studio log anomalies — ${parts.join(" · ")}` : "";
}

function capList(lines: readonly string[], max: number): string {
	const shown = lines.slice(0, Math.max(1, max)).map((line) => (line.length > 120 ? `${line.slice(0, 117)}…` : line));
	const extra = lines.length - shown.length;
	return `${shown.join(" | ")}${extra > 0 ? ` (+${extra} more)` : ""}`;
}
