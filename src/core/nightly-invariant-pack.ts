/**
 * N5 — nightly INVARIANT PACKS: what "finishes properly" actually means, asserted. PURE core.
 *
 * A nightly cell that merely "didn't crash" proves very little. The pack states, per project, the terminal
 * conditions that constitute success — and it is composable so a new project asserts BY REFERENCE rather than by
 * copying a list someone will forget to update.
 *
 * ── THE SYMMETRY THAT MAKES A PACK HONEST ──
 * Two failure directions matter equally, and most suites only check one:
 *  - **A gate that MUST fire didn't** (acceptance evidence, review verdict, taint hold) — the run skipped a
 *    control and still looked green.
 *  - **A guard that must stay QUIET fired anyway** (runaway/stall/thrash on a healthy run) — a false positive,
 *    which is the failure mode that teaches people to disable the guard.
 *
 * Checking only the first produces a harness that is safe and unusable; only the second, one that is pleasant and
 * unsafe. So `mustFire` and `mustStayQuiet` are separate, both required, and a violation of either fails the pack.
 *
 * Honesty stance: an expectation that could not be EVALUATED (the signal was never watched) is reported as
 * `indeterminate`, never as satisfied. A pack that treats missing evidence as a pass is exactly the
 * silently-degrading check this project keeps finding elsewhere.
 */

export interface InvariantPack {
	readonly id: string;
	/** Terminal board lanes every card must have reached. */
	readonly expectedTerminalLanes: readonly string[];
	/** Signals that MUST have fired (gates: acceptance evidence, review verdict, taint hold). */
	readonly mustFire: readonly string[];
	/** Signals that must NOT have fired (guards: runaway, stall, thrash — false positives on a healthy run). */
	readonly mustStayQuiet: readonly string[];
	/**
	 * Per-model-profile EXEMPTIONS from `mustStayQuiet` (N5 2026-07-26). A profile whose recordings inject faults
	 * on purpose (`flaky`) legitimately produces recoverable error signals while the run still drains green — the
	 * quiet assertion for those signals is a perfect-profile claim, and keeping it on the flaky profile is the
	 * "FALSE POSITIVE that teaches people to disable the guard" the quiet check itself warns about. Exemptions are
	 * listed (not a replacement set) so the waiver names exactly what is being waived and everything else in
	 * `mustStayQuiet` keeps asserting.
	 */
	readonly quietExemptionsByProfile?: Readonly<Record<string, readonly string[]>>;
	/** Packs this one includes — composition is how a new project asserts by reference. */
	readonly includes?: readonly string[];
}

export interface DrainedState {
	readonly terminalLanesByCard: ReadonlyMap<string, string>;
	/** Signals observed during the drain. */
	readonly firedSignals: ReadonlySet<string>;
	/** Signals the harness was actually WATCHING. A signal not watched cannot be judged either way. */
	readonly watchedSignals: ReadonlySet<string>;
	readonly unmatchedAimockRequests: number;
	readonly orphanSessions: number;
	readonly orphanWorktrees: number;
	readonly orphanLeases: number;
}

export type CheckStatus = "satisfied" | "violated" | "indeterminate";

export interface InvariantCheck {
	readonly name: string;
	readonly status: CheckStatus;
	readonly detail: string;
}

export interface PackResult {
	readonly packId: string;
	readonly checks: readonly InvariantCheck[];
	readonly violated: readonly InvariantCheck[];
	readonly indeterminate: readonly InvariantCheck[];
	readonly passed: boolean;
	readonly summary: string;
}

/** Resolve a pack plus everything it includes, depth-first, without duplicating checks. */
export function resolvePack(packId: string, registry: ReadonlyMap<string, InvariantPack>): InvariantPack | null {
	const seen = new Set<string>();
	const lanes = new Set<string>();
	const mustFire = new Set<string>();
	const mustStayQuiet = new Set<string>();
	const quietExemptions = new Map<string, Set<string>>();

	const visit = (id: string): boolean => {
		if (seen.has(id)) {
			return true; // already merged; a cycle is harmless rather than fatal
		}
		const pack = registry.get(id);
		if (!pack) {
			return false;
		}
		seen.add(id);
		for (const lane of pack.expectedTerminalLanes) {
			lanes.add(lane);
		}
		for (const signal of pack.mustFire) {
			mustFire.add(signal);
		}
		for (const signal of pack.mustStayQuiet) {
			mustStayQuiet.add(signal);
		}
		for (const [profile, signals] of Object.entries(pack.quietExemptionsByProfile ?? {})) {
			const merged = quietExemptions.get(profile) ?? new Set<string>();
			for (const signal of signals) {
				merged.add(signal);
			}
			quietExemptions.set(profile, merged);
		}
		return (pack.includes ?? []).every(visit);
	};

	if (!visit(packId)) {
		return null;
	}
	return {
		id: packId,
		expectedTerminalLanes: [...lanes].sort(),
		mustFire: [...mustFire].sort(),
		mustStayQuiet: [...mustStayQuiet].sort(),
		...(quietExemptions.size > 0
			? {
					quietExemptionsByProfile: Object.fromEntries(
						[...quietExemptions.entries()].map(([profile, signals]) => [profile, [...signals].sort()]),
					),
				}
			: {}),
	};
}

/**
 * Specialize a resolved pack for the cell's model profile: drop `mustStayQuiet` entries the pack explicitly
 * exempts for that profile (see {@link InvariantPack.quietExemptionsByProfile}). Everything else is unchanged —
 * lanes and `mustFire` are profile-independent claims about a finished drain.
 */
export function applyProfileToPack(pack: InvariantPack, modelProfile: string | null | undefined): InvariantPack {
	const exempt = new Set(pack.quietExemptionsByProfile?.[modelProfile ?? ""] ?? []);
	if (exempt.size === 0) {
		return pack;
	}
	return {
		...pack,
		mustStayQuiet: pack.mustStayQuiet.filter((signal) => !exempt.has(signal)),
	};
}

/**
 * Evaluate a resolved pack against drained state.
 *
 * A pack passes only when nothing is violated AND nothing is indeterminate — an unevaluable expectation is not a
 * pass, because "we could not tell" and "it was fine" are different claims and only one of them is evidence.
 */
export function evaluatePack(pack: InvariantPack, state: DrainedState): PackResult {
	const checks: InvariantCheck[] = [];

	const unexpectedLanes = [...state.terminalLanesByCard.entries()].filter(
		([, lane]) => !pack.expectedTerminalLanes.includes(lane),
	);
	// ZERO observed cards is INDETERMINATE, not satisfied. "All 0 cards ended in done" is vacuously true and reads
	// as a pass, which is the empty-pack hazard `resolvePack` refuses — reappearing one level down in the STATE
	// rather than in the pack. Found 2026-07-20 when the nightly runner wired this up and a cell with no card
	// data reported "all 3 invariant(s) satisfied".
	checks.push(
		state.terminalLanesByCard.size === 0
			? {
					name: "terminal_lanes",
					status: "indeterminate" as const,
					detail:
						"NO cards were observed — 'all 0 cards ended correctly' is vacuously true and is not evidence that anything finished",
				}
			: {
					name: "terminal_lanes",
					status: unexpectedLanes.length === 0 ? ("satisfied" as const) : ("violated" as const),
					detail:
						unexpectedLanes.length === 0
							? `all ${state.terminalLanesByCard.size} card(s) ended in ${pack.expectedTerminalLanes.join("/")}`
							: `card(s) ended elsewhere: ${unexpectedLanes.map(([card, lane]) => `${card}→${lane}`).join(", ")}`,
				},
	);

	checks.push({
		name: "aimock_fully_matched",
		status: state.unmatchedAimockRequests === 0 ? "satisfied" : "violated",
		detail:
			state.unmatchedAimockRequests === 0
				? "zero unmatched aimock requests (F11.4c)"
				: `${state.unmatchedAimockRequests} unmatched request(s) — the recording did not cover what the run did`,
	});

	const orphans = state.orphanSessions + state.orphanWorktrees + state.orphanLeases;
	checks.push({
		name: "no_orphans_after_teardown",
		status: orphans === 0 ? "satisfied" : "violated",
		detail:
			orphans === 0
				? "no orphan sessions, worktrees or leases"
				: `${state.orphanSessions} session(s), ${state.orphanWorktrees} worktree(s), ${state.orphanLeases} lease(s) left behind`,
	});

	for (const signal of pack.mustFire) {
		if (!state.watchedSignals.has(signal)) {
			checks.push({
				name: `must_fire:${signal}`,
				status: "indeterminate",
				detail: `"${signal}" was never WATCHED, so whether it fired is unknown — not a pass`,
			});
			continue;
		}
		checks.push({
			name: `must_fire:${signal}`,
			status: state.firedSignals.has(signal) ? "satisfied" : "violated",
			detail: state.firedSignals.has(signal)
				? `"${signal}" fired as required`
				: `"${signal}" did NOT fire — the run skipped a control and still looked green`,
		});
	}

	for (const signal of pack.mustStayQuiet) {
		if (!state.watchedSignals.has(signal)) {
			checks.push({
				name: `must_stay_quiet:${signal}`,
				status: "indeterminate",
				detail: `"${signal}" was never WATCHED, so its silence proves nothing`,
			});
			continue;
		}
		checks.push({
			name: `must_stay_quiet:${signal}`,
			status: state.firedSignals.has(signal) ? "violated" : "satisfied",
			detail: state.firedSignals.has(signal)
				? `"${signal}" fired on a healthy run — a FALSE POSITIVE, the failure mode that teaches people to disable a guard`
				: `"${signal}" stayed quiet as required`,
		});
	}

	const violated = checks.filter((check) => check.status === "violated");
	const indeterminate = checks.filter((check) => check.status === "indeterminate");
	const passed = violated.length === 0 && indeterminate.length === 0;

	return {
		packId: pack.id,
		checks,
		violated,
		indeterminate,
		passed,
		summary: passed
			? `${pack.id}: all ${checks.length} invariant(s) satisfied.`
			: `${pack.id}: ${violated.length} violated, ${indeterminate.length} INDETERMINATE (unevaluable ≠ pass). ${[...violated, ...indeterminate].map((check) => `${check.name} — ${check.detail}`).join("; ")}`,
	};
}
