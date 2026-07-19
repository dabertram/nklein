/**
 * F12.92 every-k-step drift critic — PURE core.
 *
 * A second local model inspects the RUNNING trajectory every few turns and emits DRIFT FLAGS + short HINTS —
 * never solutions. That distinction is the whole finding ("Steer, Don't Solve": a frozen 32B went 29.2%→65.0% on
 * SWE-bench Verified with a prompted critic): a critic that hands over the answer replaces the worker's reasoning
 * and teaches it nothing, while a critic that names the drift lets the worker recover its own plan.
 *
 * Distinct from its neighbours: the §12 turn-loop guard detects REPETITION, F12.42 scores a trajectory
 * POST-HOC, and F12.22 catches a stalled progress ledger. This one catches subgoal drift and over-commitment to
 * a wrong hypothesis MID-RUN, while there is still budget to change course.
 *
 * Pure: cadence decision + prompt construction + tolerant parsing. Running the critic model is the effectful
 * (fleet-gated) half.
 */

export interface DriftCheckDecision {
	readonly check: boolean;
	readonly reason: string;
	/** The turn to record as the last check when this decision fires (null when it does not). */
	readonly nextLastCheckTurn: number | null;
}

export interface DriftCheckInput {
	/** Current 0-based turn index. */
	readonly turn: number;
	/** Turn at which the critic last ran, or null when it never has. */
	readonly lastCheckTurn: number | null;
	/** Calm cadence in turns (default 8 — inside the paper's 5–10 window). */
	readonly everyKTurns?: number;
	/**
	 * Distress signal (edit-thrash / progress-stall flagged elsewhere): tightens the cadence, mirroring F12.21's
	 * re-anchor rule — a drifting run needs the critic sooner, not on the calm schedule.
	 */
	readonly inDistress?: boolean;
	/** Tightened cadence used while in distress (default 4). */
	readonly distressEveryKTurns?: number;
	/** Minimum turns before the FIRST check — an early run has no trajectory to judge (default 4). */
	readonly minTurnsBeforeFirst?: number;
}

/**
 * Decide whether the drift critic should run this turn. Never fires before the run has a trajectory worth
 * judging, then fires on the cadence (tightened under distress). Quiet by default: an unfired decision costs
 * nothing, which is what makes a periodic critic affordable.
 */
export function decideDriftCheck(input: DriftCheckInput): DriftCheckDecision {
	const cadence = Math.max(1, input.inDistress ? (input.distressEveryKTurns ?? 4) : (input.everyKTurns ?? 8));
	const minFirst = Math.max(0, input.minTurnsBeforeFirst ?? 4);
	if (input.turn < minFirst) {
		return {
			check: false,
			reason: `turn ${input.turn} is below the ${minFirst}-turn floor — no trajectory to judge yet`,
			nextLastCheckTurn: null,
		};
	}
	const elapsed = input.lastCheckTurn === null ? input.turn : input.turn - input.lastCheckTurn;
	if (elapsed < cadence) {
		return {
			check: false,
			reason: `only ${elapsed} turn(s) since the last drift check (cadence ${cadence})`,
			nextLastCheckTurn: null,
		};
	}
	return {
		check: true,
		reason: `${elapsed} turn(s) since the last drift check ≥ cadence ${cadence}${input.inDistress ? " (distress-tightened)" : ""}`,
		nextLastCheckTurn: input.turn,
	};
}

export interface DriftCriticPromptInput {
	/** The card's objective — the thing drift is measured AGAINST. */
	readonly taskObjective: string;
	/** The worker's own current plan, when it has one. */
	readonly focusChain?: string | null;
	/** Compact recent-activity summary (tool calls / files touched), already bounded by the caller. */
	readonly recentActivity: string;
}

/**
 * Build the drift-critic prompt. The contract is explicit and repeated because it is the finding: name the drift,
 * do NOT solve it. The critic is also told to stay silent when the run looks on-track — a critic that always
 * finds something trains the worker to ignore it.
 */
export function buildDriftCriticPrompt(input: DriftCriticPromptInput): string {
	const lines = [
		"You are a DRIFT CRITIC watching another agent work. You do NOT write code and you do NOT solve the task.",
		"",
		"## The objective the work must serve",
		input.taskObjective.trim() || "(no objective recorded)",
	];
	if (input.focusChain?.trim()) {
		lines.push("", "## The worker's own plan", input.focusChain.trim());
	}
	lines.push(
		"",
		"## What the worker has been doing recently",
		input.recentActivity.trim() || "(no recent activity recorded)",
		"",
		"## Your job",
		"Judge ONLY whether the recent work still serves the objective. Look for: drifting onto a different subgoal, over-committing to a hypothesis the evidence no longer supports, re-doing work already done, or polishing something the objective never asked for.",
		"If the work is ON TRACK, say exactly `ON_TRACK` and nothing else — do not invent a concern to seem useful.",
		"If it has DRIFTED, reply with up to three lines, each `DRIFT: <what drifted> | HINT: <the smallest nudge back>`.",
		"A HINT names the direction, never the solution: say what to reconsider, not what to write. Do not provide code, diffs, or step-by-step instructions.",
	);
	return lines.join("\n");
}

export interface DriftFlag {
	readonly drift: string;
	readonly hint: string;
}

export interface DriftCriticVerdict {
	readonly onTrack: boolean;
	readonly flags: readonly DriftFlag[];
	/** Prompt-ready feedback for the worker, or null when on-track (nothing to inject). */
	readonly workerNote: string | null;
}

const DRIFT_LINE = /^\s*(?:[-*]\s*)?DRIFT\s*:\s*(.+?)\s*\|\s*HINT\s*:\s*(.+?)\s*$/i;
/** Cap so a chatty critic cannot flood the worker's context. */
const MAX_FLAGS = 3;

/**
 * Parse the critic's reply tolerantly. An explicit `ON_TRACK`, an empty reply, or a reply with no well-formed
 * DRIFT/HINT pair all read as ON-TRACK — a critic whose output we cannot understand must not manufacture
 * feedback, since a spurious nudge is worse than none.
 */
export function parseDriftCriticVerdict(text: string): DriftCriticVerdict {
	const flags: DriftFlag[] = [];
	for (const line of text.split("\n")) {
		const match = DRIFT_LINE.exec(line);
		if (match?.[1] && match[2]) {
			flags.push({ drift: match[1], hint: match[2] });
			if (flags.length >= MAX_FLAGS) {
				break;
			}
		}
	}
	if (flags.length === 0) {
		return { onTrack: true, flags: [], workerNote: null };
	}
	const workerNote = [
		"<system-reminder>",
		"A drift check on your recent work flagged the following. These are nudges, not instructions — decide for yourself whether they apply:",
		...flags.map((flag) => `- Possible drift: ${flag.drift} — consider: ${flag.hint}`),
		"If you disagree, say why in one line and continue.",
		"</system-reminder>",
	].join("\n");
	return { onTrack: false, flags, workerNote };
}
