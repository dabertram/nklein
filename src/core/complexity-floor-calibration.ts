/**
 * F3.41 (c) — the CALIBRATION loop: measured complexity floors per model class, replacing the researched priors.
 * PURE core.
 *
 * ── WHAT THE PRIOR IS, AND WHY IT MUST NOT STAY ONE ──
 * `requiredCapabilityForCard` / `maxComplexityForCapability` map a card's decomposition complexity to the
 * capability a class needs — a researched prior anchored on published benchmarks. The decomposer's granularity
 * line ("keep every child at complexity ≤ N for this class") is derived from it. Until the fleet's own drains
 * confirm or refute it, that number is a plausible value standing in for a fact never established.
 *
 * ── THE MEASUREMENT ──
 * A card's OUTCOME after review (`delivered` = the class did it; `bounced` / `parked` = it did not), the WORKER
 * model that attempted it (the attempt ledger) and the card's persisted complexity (the plan sizing verdict /
 * `difficultyFacts`) are three streams keyed by task id. Joined, they say per class and complexity band how often
 * that class actually completes cards of that size. The measured floor is the highest band the class still passes
 * at `passRateFloor` with at least `minSample` judged cards — walked from the easiest band up, stopping at the
 * first defensible band that fails (a class that fails ≤35 is not credited with >50 because a thin sample there
 * happened to pass).
 *
 * ── HONESTY RULES ──
 * A band without `minSample` judgments neither passes nor fails — it is skipped, never inferred. A class with no
 * defensible band at all is `insufficient` and keeps the prior (the caller says so). Bounces and parks are both
 * failures of the CLASS for that card: a bounce means the work did not clear review, a park means nobody could
 * finish it — either way the card was too big for the class as sized.
 */
import { complexityBand } from "./task-diff-size-predictor";

export type ComplexityBandLabel = ReturnType<typeof complexityBand>;

/** Upper complexity edge of each band — the number the granularity line states. */
export const COMPLEXITY_BAND_UPPER: Readonly<Record<ComplexityBandLabel, number>> = {
	"≤20": 20,
	"≤35": 35,
	"≤50": 50,
	">50": 100,
};
const BAND_ORDER: readonly ComplexityBandLabel[] = ["≤20", "≤35", "≤50", ">50"];

export const COMPLEXITY_FLOOR_MIN_SAMPLE = 5;
export const COMPLEXITY_FLOOR_PASS_RATE = 0.7;

export interface ComplexityOutcomeRow {
	readonly classKey: string;
	readonly complexity: number;
	readonly passed: boolean;
}

export interface ComplexityBandEvidence {
	readonly band: ComplexityBandLabel;
	readonly sample: number;
	readonly passed: number;
	readonly passRate: number;
}

export interface CalibratedComplexityFloor {
	readonly classKey: string;
	/** The highest complexity the class is MEASURED to handle; null when no band has a defensible sample. */
	readonly measuredMaxComplexity: number | null;
	readonly basis: "measured" | "insufficient";
	/** Judged cards behind the verdict (all bands). */
	readonly sample: number;
	readonly bands: readonly ComplexityBandEvidence[];
}

export interface CalibrateComplexityFloorsInput {
	readonly rows: readonly ComplexityOutcomeRow[];
	readonly minSample?: number;
	readonly passRateFloor?: number;
}

function finiteComplexity(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function calibrateComplexityFloors(
	input: CalibrateComplexityFloorsInput,
): Map<string, CalibratedComplexityFloor> {
	const minSample = Math.max(1, Math.floor(input.minSample ?? COMPLEXITY_FLOOR_MIN_SAMPLE));
	const passRateFloor = input.passRateFloor ?? COMPLEXITY_FLOOR_PASS_RATE;
	const byClass = new Map<string, Map<ComplexityBandLabel, { sample: number; passed: number }>>();
	for (const row of input.rows) {
		if (!row || !row.classKey || !finiteComplexity(row.complexity)) {
			continue;
		}
		const band = complexityBand(row.complexity);
		const bands = byClass.get(row.classKey) ?? new Map();
		const cell = bands.get(band) ?? { sample: 0, passed: 0 };
		cell.sample += 1;
		cell.passed += row.passed ? 1 : 0;
		bands.set(band, cell);
		byClass.set(row.classKey, bands);
	}
	const floors = new Map<string, CalibratedComplexityFloor>();
	for (const [classKey, bands] of byClass) {
		const evidence: ComplexityBandEvidence[] = BAND_ORDER.map((band) => {
			const cell = bands.get(band) ?? { sample: 0, passed: 0 };
			return {
				band,
				sample: cell.sample,
				passed: cell.passed,
				passRate: cell.sample > 0 ? cell.passed / cell.sample : 0,
			};
		});
		let measured: number | null = null;
		let anyDefensible = false;
		for (const band of evidence) {
			if (band.sample < minSample) {
				continue; // neither passes nor fails — skipped, never inferred
			}
			anyDefensible = true;
			if (band.passRate >= passRateFloor) {
				measured = COMPLEXITY_BAND_UPPER[band.band];
			} else {
				if (measured === null) {
					measured = 0; // the easiest defensible band already fails: nothing is credited
				}
				break; // the first defensible failing band caps the floor
			}
		}
		floors.set(classKey, {
			classKey,
			measuredMaxComplexity: anyDefensible ? measured : null,
			basis: anyDefensible ? "measured" : "insufficient",
			sample: evidence.reduce((sum, band) => sum + band.sample, 0),
			bands: evidence,
		});
	}
	return floors;
}

// ── The join: three streams keyed by task id → outcome rows ──

export interface CardOutcomeRecord {
	readonly taskId: string;
	/** `delivered` passes; `bounced` and `parked` fail; anything else is not a judgment. */
	readonly outcome: string;
}

export interface WorkerAttemptRecord {
	readonly taskId: string;
	readonly modelId: string;
	/** Newest attempt wins when a card was attempted by several models. */
	readonly recordedAt: number;
}

export interface JoinComplexityOutcomeRowsInput {
	readonly outcomes: readonly CardOutcomeRecord[];
	readonly attempts: readonly WorkerAttemptRecord[];
	readonly complexityByTaskId: ReadonlyMap<string, number>;
	/** Maps a served model id to the fleet class key (registry key); unmapped ids key by the model id itself. */
	readonly classKeyByModelId?: ReadonlyMap<string, string>;
}

const PASS_OUTCOMES: ReadonlySet<string> = new Set(["delivered"]);
const FAIL_OUTCOMES: ReadonlySet<string> = new Set(["bounced", "parked"]);

export function joinComplexityOutcomeRows(input: JoinComplexityOutcomeRowsInput): ComplexityOutcomeRow[] {
	const newestAttemptByTask = new Map<string, WorkerAttemptRecord>();
	for (const attempt of input.attempts) {
		if (!attempt.taskId || !attempt.modelId) {
			continue;
		}
		const current = newestAttemptByTask.get(attempt.taskId);
		if (!current || attempt.recordedAt >= current.recordedAt) {
			newestAttemptByTask.set(attempt.taskId, attempt);
		}
	}
	const seen = new Set<string>();
	const rows: ComplexityOutcomeRow[] = [];
	for (const record of input.outcomes) {
		if (seen.has(record.taskId)) {
			continue; // one judgment per card: the first (newest) row wins
		}
		const passed = PASS_OUTCOMES.has(record.outcome) ? true : FAIL_OUTCOMES.has(record.outcome) ? false : null;
		const complexity = input.complexityByTaskId.get(record.taskId);
		const attempt = newestAttemptByTask.get(record.taskId);
		if (passed === null || !finiteComplexity(complexity) || !attempt) {
			continue;
		}
		seen.add(record.taskId);
		rows.push({
			classKey: input.classKeyByModelId?.get(attempt.modelId) ?? attempt.modelId,
			complexity,
			passed,
		});
	}
	return rows;
}
