/**
 * Inherited debt: a pre-existing breakage is WAIVED for blame, never accepted as the new normal.
 *
 * ── WHY THIS EXISTS ──
 * `shouldWaiveAcceptanceAsPreexisting` answers a fairness question: a card whose acceptance command also fails on
 * the BASE tree inherited that failure and usually cannot fix it inside its declared file scope, so bouncing the
 * worker is wrong. That reasoning is sound and stays.
 *
 * What was wrong is what happened NEXT: the waiver marked acceptance `passed`, the card merged, and the breakage
 * simply persisted — invisible, un-owned, and re-waived by every later card, so a project could decay indefinitely
 * while every gate reported green. Waiving blame silently became accepting the defect (David, 2026-09-08:
 * "we want nklein to not directly waive pre-existing issues … the clear goal is to not carry over pre-existing
 * short-comings … pre-existing issues shall be taken up and improved/resolved as part of the plan").
 *
 * So a waiver now COSTS something: it records inherited debt against the workspace. Open debt is fed to the
 * architect as required work, so the plan takes it up, and it closes on the first baseline sample that passes.
 * Carrying breakage forward remains possible, but only when it is explicitly asked for — never as a default.
 */

/** One inherited breakage, keyed by what actually broke rather than by which card happened to meet it. */
export interface InheritedDebtRecord {
	readonly schemaVersion: 1;
	/** Stable identity of the breakage: same command + same failure ⇒ same debt, however many cards meet it. */
	readonly signature: string;
	readonly workspacePath: string | null;
	/** The acceptance command that fails on the base tree. */
	readonly command: string;
	/** The card that first met it — provenance, not ownership. */
	readonly firstSeenTaskId: string;
	readonly firstSeenAt: number;
	readonly lastSeenAt: number;
	/** How many cards have inherited it since. A rising count is the cost of not fixing it. */
	readonly encounters: number;
	/** The head of the baseline failure, so the plan can act without re-running anything. */
	readonly baselineOutputHead: string;
	readonly baselineExitCode: number | null;
	readonly status: "open" | "closed";
	readonly closedAt: number | null;
}

const SIGNATURE_OUTPUT_CHARS = 400;
const OUTPUT_HEAD_CHARS = 1200;

/** Lines that identify a failure rather than decorate it: drop timing, stack frames and progress noise. */
function meaningfulFailureLines(output: string): string[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => !/^(at\s|>|npm notice)/u.test(line))
		.filter((line) => !/duration_ms|elapsed|\d+\s*ms\b/iu.test(line))
		.slice(0, 12);
}

/**
 * The debt's identity. Two cards meeting the SAME broken command with the SAME failure share one debt; a different
 * failure of the same command is different debt (fixing one must not silently close the other).
 */
export function inheritedDebtSignature(command: string, baselineOutput: string): string {
	const normalizedCommand = command.trim().replace(/\s+/gu, " ");
	const failure = meaningfulFailureLines(baselineOutput).join("\n").slice(0, SIGNATURE_OUTPUT_CHARS);
	let hash = 0x811c9dc5;
	for (const character of `${normalizedCommand} ${failure}`) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${normalizedCommand.slice(0, 60)}#${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Should this waiver be carried as debt? Default YES — that is the point. `false` only when carrying the breakage
 * forward was explicitly requested, which is a deliberate choice about THIS project, not a global convenience.
 */
export function shouldRecordInheritedDebt(input: {
	waived: boolean;
	carryPreExistingBreakageRequested?: boolean;
}): boolean {
	return input.waived && input.carryPreExistingBreakageRequested !== true;
}

/** Fold a fresh sighting into the ledger: a new debt, or another encounter of one already open. */
export function foldInheritedDebtSighting(
	existing: readonly InheritedDebtRecord[],
	sighting: {
		signature: string;
		workspacePath: string | null;
		command: string;
		taskId: string;
		baselineOutput: string;
		baselineExitCode: number | null;
		at: number;
	},
): InheritedDebtRecord[] {
	const open = existing.find((record) => record.signature === sighting.signature && record.status === "open");
	if (open) {
		return existing.map((record) =>
			record === open ? { ...record, lastSeenAt: sighting.at, encounters: record.encounters + 1 } : record,
		);
	}
	return [
		...existing,
		{
			schemaVersion: 1,
			signature: sighting.signature,
			workspacePath: sighting.workspacePath,
			command: sighting.command.trim(),
			firstSeenTaskId: sighting.taskId,
			firstSeenAt: sighting.at,
			lastSeenAt: sighting.at,
			encounters: 1,
			baselineOutputHead: sighting.baselineOutput.slice(0, OUTPUT_HEAD_CHARS),
			baselineExitCode: sighting.baselineExitCode,
			status: "open",
			closedAt: null,
		},
	];
}

/**
 * Close every open debt for a command that now passes on the base tree. Closing is keyed on the COMMAND, not the
 * signature: the evidence "this command is green at base" retires every way it used to fail.
 */
export function closeInheritedDebtForPassingCommand(
	existing: readonly InheritedDebtRecord[],
	command: string,
	at: number,
): { records: InheritedDebtRecord[]; closed: InheritedDebtRecord[] } {
	const normalized = command.trim().replace(/\s+/gu, " ");
	const closed: InheritedDebtRecord[] = [];
	const records = existing.map((record) => {
		if (record.status !== "open" || record.command.trim().replace(/\s+/gu, " ") !== normalized) {
			return record;
		}
		const next: InheritedDebtRecord = { ...record, status: "closed", closedAt: at };
		closed.push(next);
		return next;
	});
	return { records, closed };
}

/**
 * The architect's brief for open debt. This is how "taken up as part of the plan" actually happens: the
 * decomposition prompt carries the inherited breakage as required work, so a plan that ignores it is visibly
 * incomplete rather than quietly inheriting it. Empty string when there is nothing owed.
 */
export function describeInheritedDebtForPlanning(open: readonly InheritedDebtRecord[]): string {
	const debts = open.filter((record) => record.status === "open");
	if (debts.length === 0) {
		return "";
	}
	const lines = [
		"## Pre-existing breakage you must plan to FIX (inherited debt)",
		"",
		"This workspace's acceptance command already fails on the base tree. Earlier cards were waived for it —",
		"they did not cause it and could not fix it inside their own scope — but the failure is NOT accepted: it is",
		"owed work. Include cards that repair it, and order them so dependent work is not built on the breakage.",
		"Do not plan around it, do not weaken the command, and do not mark it out of scope.",
		"",
	];
	for (const debt of debts) {
		lines.push(
			`- \`${debt.command}\` fails at base (exit ${debt.baselineExitCode ?? "?"}), first met by ${debt.firstSeenTaskId}, inherited by ${debt.encounters} card(s) so far:`,
			"  ```",
			...meaningfulFailureLines(debt.baselineOutputHead)
				.slice(0, 6)
				.map((line) => `  ${line}`),
			"  ```",
		);
	}
	lines.push("");
	return lines.join("\n");
}
