/**
 * Delivery-quality gate audit (pure) — gives the ported {@link aggregateGateAudit} a real, non-speculative consumer by
 * running the delivery-quality gate over a LABELED fixture matrix (opencode-swarm's gate-audit is designed exactly this
 * way: fixtures whose defect/clean label IS ground truth by construction, so catch-rate / false-reject-rate are
 * measured, not guessed). It answers "how accurate is the placeholder + quality-budget gate?" — the metric that decides
 * whether the record-only delivery scan is trustworthy enough to ever enforce.
 *
 * Each fixture pairs a set of changed files with `expectDefect`; the gate's HOLD becomes the prediction, the label the
 * ground truth. Pure + deterministic — the CLI/dev mount just prints the returned report.
 */

import {
	assessDeliveryQuality,
	type DeliveryQualityFile,
	type DeliveryQualityGateConfig,
} from "./delivery-quality-gate.js";
import { aggregateGateAudit, type GateAuditReport, type GateOutcome } from "./gate-audit-metrics.js";

export interface DeliveryQualityGateFixture {
	readonly name: string;
	readonly files: readonly DeliveryQualityFile[];
	/** Ground truth: does this change genuinely contain a defect the gate SHOULD hold on? */
	readonly expectDefect: boolean;
}

export interface DeliveryQualityGateAuditRow {
	readonly name: string;
	readonly expectDefect: boolean;
	readonly held: boolean;
	/** true = the gate's HOLD matched the label (TP or TN). */
	readonly correct: boolean;
	readonly holdReasons: readonly string[];
}

export interface DeliveryQualityGateAuditResult {
	readonly report: GateAuditReport;
	readonly rows: readonly DeliveryQualityGateAuditRow[];
}

/**
 * A bounded, hand-labeled fixture matrix covering each gate finding kind plus clean controls — enough to measure the
 * gate's catch vs false-reject without a live corpus. Kept small + representative (the opencode-swarm 12-fixture idea).
 */
export const DEFAULT_DELIVERY_QUALITY_GATE_FIXTURES: readonly DeliveryQualityGateFixture[] = [
	{
		name: "stub-todo-throw",
		expectDefect: true,
		files: [
			{
				path: "src/a.ts",
				addedLines: ["export function f() {", "  // TODO: implement", "  throw new Error('not implemented');", "}"],
			},
			{ path: "test/a.test.ts", addedLines: ["expect(f).toBeDefined();"], isTest: true },
		],
	},
	{
		name: "fixme-marker",
		expectDefect: true,
		files: [
			{ path: "src/b.ts", addedLines: ["// FIXME: broken edge case", "export const g = () => 1;"] },
			{ path: "test/b.test.ts", addedLines: ["expect(g()).toBe(1);"], isTest: true },
		],
	},
	{
		name: "untested-source",
		expectDefect: true,
		files: [{ path: "src/c.ts", addedLines: Array.from({ length: 80 }, (_, i) => `const v${i} = ${i};`) }],
	},
	{
		name: "copy-paste-duplication",
		expectDefect: true,
		files: [
			{
				path: "src/d.ts",
				addedLines: [
					...Array.from({ length: 30 }, () => "doTheExactSameThing(payload, context);"),
					"const unique = 1;",
				],
			},
			{ path: "test/d.test.ts", addedLines: ["expect(unique).toBe(1);"], isTest: true },
		],
	},
	{
		name: "clean-well-tested",
		expectDefect: false,
		files: [
			{ path: "src/e.ts", addedLines: ["export const add = (a: number, b: number) => a + b;"] },
			{
				path: "test/e.test.ts",
				addedLines: ["expect(add(1, 2)).toBe(3);", "expect(add(0, 0)).toBe(0);"],
				isTest: true,
			},
		],
	},
	{
		name: "clean-todo-in-string-literal",
		expectDefect: false,
		// A TODO inside a string/prose must NOT hold — this catches over-eager placeholder matching (a false reject).
		files: [
			{ path: "src/f.ts", addedLines: ["export const label = 'the TODO list is on the board';"] },
			{ path: "test/f.test.ts", addedLines: ["expect(label).toContain('board');"], isTest: true },
		],
	},
	{
		name: "clean-test-only-change",
		expectDefect: false,
		files: [
			{
				path: "test/g.test.ts",
				addedLines: ["expect(existing()).toBe(true);", "expect(existing()).not.toBe(false);"],
				isTest: true,
			},
		],
	},
];

export function runDeliveryQualityGateAudit(
	fixtures: readonly DeliveryQualityGateFixture[] = DEFAULT_DELIVERY_QUALITY_GATE_FIXTURES,
	config?: DeliveryQualityGateConfig,
): DeliveryQualityGateAuditResult {
	const outcomes: GateOutcome[] = [];
	const rows: DeliveryQualityGateAuditRow[] = [];
	for (const fixture of fixtures) {
		const assessment = assessDeliveryQuality(fixture.files, config);
		const held = assessment.hold;
		outcomes.push({ gate: "delivery_quality", predictedReject: held, actualDefect: fixture.expectDefect });
		rows.push({
			name: fixture.name,
			expectDefect: fixture.expectDefect,
			held,
			correct: held === fixture.expectDefect,
			holdReasons: assessment.holdReasons,
		});
	}
	return { report: aggregateGateAudit(outcomes), rows };
}

function formatRate(rate: number | null): string {
	return rate === null ? "n/a" : `${(rate * 100).toFixed(0)}%`;
}

/** Human-readable report for the CLI/dev mount. Pure. */
export function formatDeliveryQualityGateAuditReport(result: DeliveryQualityGateAuditResult): string {
	const { report, rows } = result;
	const lines: string[] = ["Delivery-quality gate audit (labeled fixtures):", ""];
	for (const row of rows) {
		const mark = row.correct ? "✓" : "✗";
		const label = row.expectDefect ? "defect" : "clean ";
		lines.push(`  ${mark} [${label}] ${row.name} → ${row.held ? "HELD" : "passed"}`);
	}
	const stats = report.overall;
	lines.push(
		"",
		`Totals: ${stats.total} fixtures — TP ${stats.truePositive} / FP ${stats.falsePositive} / TN ${stats.trueNegative} / FN ${stats.falseNegative}`,
		`Catch rate ${formatRate(stats.catchRate)} · false-reject rate ${formatRate(stats.falseRejectRate)} · precision ${formatRate(stats.precision)}`,
	);
	return `${lines.join("\n")}\n`;
}
