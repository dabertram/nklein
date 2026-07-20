import {
	auditMechanismObservations,
	MECHANISM_REGISTRY,
	type MechanismFinding,
} from "../core/mechanism-observation-audit";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";

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

const READ_LIMIT = 500;

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
	const events = await readSelfObservationEvents({ limit: READ_LIMIT }).catch(() => []);
	const countsByCategory = new Map<string, number>();
	for (const event of events) {
		const category = (event.metadata as { category?: unknown } | undefined)?.category;
		if (typeof category === "string") {
			countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
		}
	}

	// Only flags we can SEE are passed as known-enabled; everything else stays unknown by construction.
	const result = auditMechanismObservations({
		registry: MECHANISM_REGISTRY,
		countsByCategory,
		knownEnabledFlags: flagsOnNow(),
		// A full read means older events were truncated — see the core's docblock for the live case where this
		// alone produced a false ENABLED_BUT_SILENT finding.
		windowSaturated: events.length >= READ_LIMIT,
	});

	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ ...result, observationsRead: events.length, readLimit: READ_LIMIT }, null, 2)}\n`,
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
		`Read ${events.length} observation(s) (cap ${READ_LIMIT}). A zero from a capped window is weaker evidence than an exhaustive one.\n`,
	);
	process.stdout.write(
		"Flag state reflects THIS process only — a mechanism whose flag is off now may have been on when the log was written, which is why those read as unknown rather than never-enabled.\n",
	);
}
