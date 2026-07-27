/**
 * N7c — turn a drain's self-observation telemetry into the SIGNAL EVENTS N5's packs judge. PURE core.
 *
 * N7b emitted terminal lanes and the whole chain came alive for board state. Signals were the other half: every
 * `mustFire`/`mustStayQuiet` assertion reported `indeterminate` because **nothing observed signals at all.**
 *
 * ── WHY TELEMETRY IS AN HONEST SOURCE, AND NOT THE SHORTCUT N7c FORBIDS ──
 * N7c's standing warning is *"DO NOT CLOSE THIS BY WIDENING `subscriptions`"* — registering listeners for
 * signals nothing actually emits would convert `indeterminate` into a fake pass, which is worse than silence.
 *
 * This is not that. The self-observation sink is a real, always-on listener that exists before the drain starts
 * and records to `.nklein/nklein/telemetry/*.jsonl` unconditionally. Every signal a pack currently names was
 * verified to be written to it by production code:
 *   - `second_opinion_review_session` — `nklein-second-opinion-review-runner.ts`
 *   - `agent_sandbox_result_patch`    — `nklein-sandbox-review-finalizer.ts`
 *   - `board_liveness_watchdog`       — `runtime-server.ts`
 *   - `runtime_error`                 — `runtime-server.ts`
 * A subscription is therefore backed by something that genuinely was listening. **The rule to keep: a signal may
 * join a pack only after it is confirmed to reach this sink — never in advance of that.**
 *
 * ── TWO VOCABULARIES, DELIBERATELY BOTH ──
 * A record carries a coarse `signal` enum AND, for `custom` observations, a `metadata.category` naming the
 * specific event. The packs already reference both (`runtime_error` is a signal; `board_liveness_watchdog` is a
 * category), so each record contributes BOTH names as observable events. Picking one vocabulary would silently
 * make half the packs unassertable, and the half that broke would report `indeterminate` — the status that looks
 * like caution rather than like a bug.
 *
 * ── WHAT IT REFUSES TO DO ──
 * A record with no usable timestamp is DROPPED and COUNTED, never dated with a guess. The collector's entire
 * contract rests on ordering events against `drainStartedAt`; an invented timestamp would place an event inside
 * or outside the drain window arbitrarily, and the resulting verdict would be confident and meaningless.
 */

export interface ExtractedSignalEvent {
	readonly signal: string;
	readonly emittedAt: number;
}

export interface SignalExtractionResult {
	readonly events: readonly ExtractedSignalEvent[];
	/** Lines that were not valid JSON. Reported, never silently skipped. */
	readonly unparseableLines: number;
	/** Records parsed but lacking a usable numeric timestamp — undateable, so unusable. */
	readonly undatedRecords: number;
	readonly summary: string;
}

/** Signals a pack may reference. Kept explicit so "is this observable?" has one answer, checkable in review. */
export const OBSERVABLE_DRAIN_SIGNALS: readonly string[] = [
	"second_opinion_review_session",
	"agent_sandbox_result_patch",
	"board_liveness_watchdog",
	"runtime_error",
	// N2 loop_park profile (2026-07-27): the repeated-tool-call guard's park lands as a `budget_wall` telemetry
	// signal — same self-observation feed as the rest; the loop-park-terminal pack asserts it must fire.
	"budget_wall",
	// N2 syntax_guard profile (2026-07-27): the F12.63 post-edit syntax guard's host-side rejection record.
	"edit_syntax_guard",
	// N2 failover profile (2026-07-27): the F3.2 model-failover controller's re-drive decision record.
	"model_failover",
];

interface TelemetryRecord {
	readonly signal?: unknown;
	readonly createdAt?: unknown;
	readonly metadata?: { readonly category?: unknown };
}

export function extractDrainSignalEvents(telemetryJsonl: string): SignalExtractionResult {
	const events: ExtractedSignalEvent[] = [];
	let unparseableLines = 0;
	let undatedRecords = 0;

	for (const rawLine of telemetryJsonl.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		let record: TelemetryRecord;
		try {
			record = JSON.parse(line) as TelemetryRecord;
		} catch {
			unparseableLines += 1;
			continue;
		}

		const emittedAt =
			typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : null;
		const names = [record.signal, record.metadata?.category].filter(
			(name): name is string => typeof name === "string" && name.length > 0,
		);
		if (names.length === 0) {
			continue;
		}
		if (emittedAt === null) {
			undatedRecords += 1;
			continue;
		}
		for (const name of names) {
			events.push({ signal: name, emittedAt });
		}
	}

	return {
		events,
		unparseableLines,
		undatedRecords,
		summary:
			events.length === 0
				? `No signal events were readable from telemetry (${unparseableLines} unparseable line(s), ${undatedRecords} undated record(s)) — assertions over signals stay INDETERMINATE rather than passing.`
				: `${events.length} signal event(s) extracted from telemetry${
						unparseableLines > 0 || undatedRecords > 0
							? `; ${unparseableLines} unparseable line(s) and ${undatedRecords} undated record(s) were DROPPED, so this is a floor rather than a complete count`
							: ""
					}.`,
	};
}
