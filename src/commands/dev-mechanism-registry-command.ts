import {
	auditMechanismObservations,
	MECHANISM_REGISTRY,
	type MechanismFinding,
} from "../core/mechanism-observation-audit";
import { countSelfObservationsByCategory } from "../telemetry/self-observation-sink";

/**
 * P15.1c — `nklein dev mechanism-registry`: which shipped mechanisms are demonstrably firing?
 *
 * Two honesty constraints shape this command, and both are about not manufacturing confidence:
 *
 *  1. **Flag history is not knowable.** The only thing we can observe is which flags are on in THIS process. A
 *     mechanism whose flag is off right now may well have been on when the log was written, so it is reported as
 *     `unknown_enablement` rather than back-dated into "never enabled". Guessing here would excuse a real
 *     silence exactly as confidently as it would blame an innocent mechanism.
 *  2. **The observation read is CAPPED** (`readSelfObservationEvents` clamps to 500). A zero from a capped window
 *     is weaker evidence than a zero from an exhaustive one, so the cap is printed alongside the result instead
 *     of being quietly absorbed.
 */

function flagsOnNow(): Set<string> {
	const on = new Set<string>();
	for (const entry of MECHANISM_REGISTRY) {
		if (entry.enabledBy && process.env[entry.enabledBy] !== undefined && process.env[entry.enabledBy] !== "") {
			on.add(entry.enabledBy);
		}
	}
	return on;
}

function line(finding: MechanismFinding): string {
	return `  [${finding.status}] ${finding.category} (${finding.item}) — ${finding.observations} obs — ${finding.note}`;
}

export async function runDevMechanismRegistryCommand(options: { json?: boolean }): Promise<void> {
	// UNCAPPED per-category tally. The capped event read that this replaced was saturated by a single
	// high-frequency category, which made every other mechanism's count read as zero by truncation — see the
	// counter's docblock. Counting needs only the tally, so there is no reason to truncate it.
	const countsByCategory = await countSelfObservationsByCategory().catch(() => new Map<string, number>());
	const totalObservations = [...countsByCategory.values()].reduce((sum, n) => sum + n, 0);

	// Only flags we can SEE are passed as known-enabled; everything else stays unknown by construction.
	const result = auditMechanismObservations({
		registry: MECHANISM_REGISTRY,
		countsByCategory,
		knownEnabledFlags: flagsOnNow(),
		// No longer saturated: the tally is exhaustive, so a zero now genuinely means "never recorded".
		windowSaturated: false,
	});

	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ ...result, totalObservations, categoriesSeen: countsByCategory.size }, null, 2)}\n`,
		);
		return;
	}

	process.stdout.write(`${result.summary}\n\n`);
	const order: MechanismFinding["status"][] = [
		"enabled_but_silent",
		"unknown_enablement",
		"silent_but_exceptional",
		"never_enabled",
		"healthy",
	];
	for (const status of order) {
		const group = result.findings.filter((finding) => finding.status === status);
		if (group.length === 0) {
			continue;
		}
		process.stdout.write(`${status.toUpperCase()} (${group.length}):\n`);
		for (const finding of group) {
			process.stdout.write(`${line(finding)}\n`);
		}
		process.stdout.write("\n");
	}
	process.stdout.write(
		`Tallied ${totalObservations} observation(s) across ${countsByCategory.size} category(ies) — EXHAUSTIVE, not a capped window, so a zero here means never-recorded.\n`,
	);
	process.stdout.write(
		"Flag state reflects THIS process only — a mechanism whose flag is off now may have been on when the log was written, which is why those read as unknown rather than never-enabled.\n",
	);
}
