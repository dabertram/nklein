/**
 * Dev-test sweep orchestrator (todo §5.O) — run the dev-test scenarios across a set of presets, then
 * aggregate each run's terminal classification ([dev-test-outcome.ts](./dev-test-outcome.ts)) into one
 * pass/fail report. The per-preset execution is injected (`runPreset`), so this orchestration core is pure
 * and fully unit-testable; the CLI (`nklein dev sweep`) wires `runPreset` to a real live dev-test run.
 *
 * The actual robustness *sweep* across model size × family × quant (§5.O "Model-matrix robustness") is gated
 * on the user supplying those configs; this is the orchestrator that drives one model's pass across the
 * parallel-fan-out presets and summarizes the outcomes.
 */
import type { DevTestRunOutcome } from "./dev-test-outcome";

export interface DevTestSweepEntry {
	preset: string;
	scenarioTitle: string;
	/** False when the seed task could not be started (the run never really began). */
	started: boolean;
	startMessage: string | null;
	outcome: DevTestRunOutcome;
	/** True only for the `completed` outcome — every non-trash card reached Completed. */
	success: boolean;
	incompleteCardCount: number;
	summary: string;
	evidenceBundlePath: string | null;
	durationMs: number;
}

export interface DevTestSweepSummary {
	total: number;
	succeeded: number;
	failed: number;
	notStarted: number;
	byOutcome: Record<DevTestRunOutcome, number>;
	allSucceeded: boolean;
	entries: readonly DevTestSweepEntry[];
}

const ALL_DEV_TEST_OUTCOMES: readonly DevTestRunOutcome[] = [
	"completed",
	"acceptance_green_workflow_incomplete",
	"blocked_by_review_cards",
	"stagnant",
	"runtime_down",
	"failed",
];

export function summarizeDevTestSweep(entries: readonly DevTestSweepEntry[]): DevTestSweepSummary {
	const byOutcome = Object.fromEntries(ALL_DEV_TEST_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
		DevTestRunOutcome,
		number
	>;
	let succeeded = 0;
	let failed = 0;
	let notStarted = 0;
	for (const entry of entries) {
		byOutcome[entry.outcome] += 1;
		if (!entry.started) {
			notStarted += 1;
		}
		if (entry.success) {
			succeeded += 1;
		} else {
			failed += 1;
		}
	}
	return {
		total: entries.length,
		succeeded,
		failed,
		notStarted,
		byOutcome,
		allSucceeded: entries.length > 0 && succeeded === entries.length,
		entries: [...entries],
	};
}

export function formatDevTestSweepReport(summary: DevTestSweepSummary): string {
	const lines: string[] = [`Dev-test sweep — ${summary.total} preset${summary.total === 1 ? "" : "s"}`];
	for (const entry of summary.entries) {
		const mark = entry.success ? "✓" : "✗";
		const status = entry.started
			? entry.outcome
			: `not started${entry.startMessage ? ` — ${entry.startMessage}` : ""}`;
		const incomplete = entry.incompleteCardCount > 0 ? ` (${entry.incompleteCardCount} incomplete)` : "";
		const seconds = `${(entry.durationMs / 1000).toFixed(1)}s`;
		lines.push(`  ${mark} ${entry.preset.padEnd(14)} ${status}${incomplete} · ${seconds}`);
	}
	const outcomeParts = ALL_DEV_TEST_OUTCOMES.filter((outcome) => summary.byOutcome[outcome] > 0).map(
		(outcome) => `${outcome} ${summary.byOutcome[outcome]}`,
	);
	lines.push(
		`${summary.succeeded}/${summary.total} succeeded${
			outcomeParts.length > 0 ? ` · outcomes: ${outcomeParts.join(", ")}` : ""
		}`,
	);
	return `${lines.join("\n")}\n`;
}

/**
 * Run `runPreset` for each preset in order (sequentially — dev-test runs contend for the sandbox pool and a
 * local model, so fanning them out would distort the per-run classification), then aggregate.
 */
export async function runDevTestSweep(
	presets: readonly string[],
	runPreset: (preset: string) => Promise<DevTestSweepEntry>,
): Promise<DevTestSweepSummary> {
	const entries: DevTestSweepEntry[] = [];
	for (const preset of presets) {
		entries.push(await runPreset(preset));
	}
	return summarizeDevTestSweep(entries);
}
