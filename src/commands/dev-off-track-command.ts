/**
 * `nklein dev off-track` — compact, restart, park, or continue? (P18.4)
 *
 * The decision core shipped with no consumer, waiting on the compaction seam (P18.4b, model-gated). But the
 * DECISION is pure and settles from four scalars, so a command can exercise it now — and its `--matrix` mode
 * makes the asymmetry the core exists for visible at a glance: a full window and a derailed card look identical
 * (both large) yet demand opposite remedies, and reaching for compaction on the derailed one launders the drift
 * into a shorter, cleaner, more authoritative record of the wrong decision.
 */

import { decideOffTrackRemedy, type OffTrackSignals } from "../core/off-track-intervention";

function parseBool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) {
		return fallback;
	}
	return value === "true" || value === "1" || value === "yes";
}

function renderMatrix(): string {
	const lines: string[] = ["DECISION MATRIX — the same 'large conversation' symptom, opposite remedies:\n"];
	const utilisations = [0.5, 0.9];
	for (const onTrack of [true, false]) {
		for (const captured of [false, true]) {
			for (const util of utilisations) {
				const signals: OffTrackSignals = {
					onTrack,
					contextUtilisation: util,
					restartsSoFar: 0,
					hasCapturedWork: captured,
				};
				const decision = decideOffTrackRemedy(signals);
				lines.push(
					`  on_track=${onTrack ? "Y" : "N"} captured=${captured ? "Y" : "N"} ctx=${Math.round(util * 100)}%  →  ${decision.remedy}`,
				);
			}
		}
	}
	lines.push(
		"\nNote the OFF-track rows never reach `compact_and_continue`, even at 90% context — off-track is checked",
		"BEFORE context pressure, so a derailed card cannot fall into the compaction branch on its way past.",
	);
	return lines.join("\n");
}

export function runDevOffTrackCommand(options: {
	onTrack?: string;
	context?: string;
	restarts?: string;
	capturedWork?: string;
	matrix?: boolean;
	json?: boolean;
}): void {
	if (options.matrix) {
		process.stdout.write(`${renderMatrix()}\n`);
		return;
	}

	const signals: OffTrackSignals = {
		onTrack: parseBool(options.onTrack, true),
		contextUtilisation: Number.parseFloat(options.context ?? "0") || 0,
		restartsSoFar: Number.parseInt(options.restarts ?? "0", 10) || 0,
		hasCapturedWork: parseBool(options.capturedWork, false),
	};
	const decision = decideOffTrackRemedy(signals);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ signals, decision }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`REMEDY: ${decision.remedy}\n\n${decision.reason}\n`);
}
