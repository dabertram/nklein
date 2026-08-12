/** F3.24b — deterministic wide DAG fixture so fleet fault-tolerance is not confounded by planner quality. */

import type { RuntimeBoardCard, RuntimeBoardData, RuntimeBoardDependency } from "./board-api-contract.js";

interface FormatterCardSpec {
	id: string;
	title: string;
	fileStem: string;
	exportName: string;
	contract: string;
}

const FLEET_PROOF_PLAN_SLUG = "fleet-wide-fanout-proof";

// Audit 2026-08-12: honest provenance shapes. `planTaskId` is the PLAIN plan-internal id (the previous
// `<slug>::<boardId>` composite embedded the derived-SESSION separator into a plan-id field, poisoning any reader
// that joins on either namespace), and `sourceTaskId` is null — this deterministic fixture is not decomposed from
// a real board card, and a phantom id would fabricate a join target.
function trustedProofPlan(taskId: string): NonNullable<RuntimeBoardCard["generatedFromPlan"]> {
	return {
		artifactKind: "decomposition",
		planSlug: FLEET_PROOF_PLAN_SLUG,
		planTaskId: taskId,
		sourceTaskId: null,
	};
}

const FORMATTERS: readonly FormatterCardSpec[] = [
	{
		id: "formatter-compact-line",
		title: "Implement compact-line formatter",
		fileStem: "compact-line",
		exportName: "formatCompactLine",
		contract: "Return one line containing the score, trend, and recommendation.",
	},
	{
		id: "formatter-json",
		title: "Implement JSON formatter",
		fileStem: "json",
		exportName: "formatJson",
		contract: "Return minified valid JSON that round-trips the score, trend, and recommendation fields.",
	},
	{
		id: "formatter-csv",
		title: "Implement CSV formatter",
		fileStem: "csv",
		exportName: "formatCsvRow",
		contract: "Return a stable-column CSV row and quote/escape a recommendation containing commas or quotes.",
	},
	{
		id: "formatter-markdown-row",
		title: "Implement markdown-row formatter",
		fileStem: "markdown-row",
		exportName: "formatMarkdownRow",
		contract: "Return one valid pipe-delimited markdown table row with stable columns.",
	},
	{
		id: "formatter-emoji-sparkline",
		title: "Implement emoji sparkline formatter",
		fileStem: "emoji-sparkline",
		exportName: "formatEmojiSparkline",
		contract: "Return a ten-block filled/empty score bar plus score, trend, and a streak emoji.",
	},
	{
		id: "formatter-plain-text-report",
		title: "Implement plain-text report formatter",
		fileStem: "plain-text-report",
		exportName: "formatPlainTextReport",
		contract: "Return a non-empty multi-line report with a header, score, trend, and recommendation.",
	},
];

function formatterCard(spec: FormatterCardSpec, baseRef: string, now: number): RuntimeBoardCard {
	const sourcePath = `src/formatters/${spec.fileStem}.ts`;
	const testPath = `test/formatters/${spec.fileStem}.test.js`;
	return {
		id: spec.id,
		title: spec.title,
		prompt: [
			"Read specification.md and the existing src/habit-insights.ts contract.",
			`Implement ONLY ${sourcePath} and ${testPath}; do not edit another formatter, the registry, or src/index.ts.`,
			`Export ${spec.exportName}(view), accepting the existing HabitInsightSummary shape as the shared HabitView contract.`,
			spec.contract,
			"The formatter must be pure, total for every valid view, and independent of every other formatter.",
			"Add at least four node:test + assert/strict cases, including a boundary/escaping case relevant to this format.",
			"Keep .test.js as plain JavaScript with no TypeScript-only syntax.",
			"Acceptance command: npm test",
		].join("\n"),
		startInPlanMode: false,
		autoReviewEnabled: true,
		agentId: "nklein",
		filesLikelyTouched: [sourcePath, testPath],
		writeScope: [sourcePath, testPath],
		generatedFromPlan: trustedProofPlan(spec.id),
		baseRef,
		createdAt: now,
		updatedAt: now,
	};
}

function joinCard(input: {
	id: string;
	title: string;
	prompt: string;
	files: readonly string[];
	baseRef: string;
	now: number;
}): RuntimeBoardCard {
	return {
		id: input.id,
		title: input.title,
		prompt: input.prompt,
		startInPlanMode: false,
		autoReviewEnabled: true,
		agentId: "nklein",
		filesLikelyTouched: [...input.files],
		writeScope: [...input.files],
		generatedFromPlan: trustedProofPlan(input.id),
		baseRef: input.baseRef,
		createdAt: input.now,
		updatedAt: input.now,
	};
}

export function createFleetWideFanoutBoard(input: { baseRef: string; now: number }): RuntimeBoardData {
	const formatterCards = FORMATTERS.map((spec) => formatterCard(spec, input.baseRef, input.now));
	const registry = joinCard({
		id: "formatter-registry",
		title: "Wire formatter registry and CLI",
		prompt: [
			"Read specification.md and the six completed independent formatter modules.",
			"Implement src/formatters/registry.ts, update src/index.ts, and add test/formatters/registry.test.js.",
			"Expose every formatter exactly once under a unique key; implement listFormatters() and formatWith(name, view).",
			"The CLI must accept --format <name>, default to compact-line, and log exactly the selected formatter result to stdout.",
			"Keep ESM throughout and throw Error for an unknown formatter name. Do not rewrite formatter implementations.",
			"Acceptance command: npm test",
		].join("\n"),
		files: ["src/formatters/registry.ts", "src/index.ts", "test/formatters/registry.test.js"],
		baseRef: input.baseRef,
		now: input.now,
	});
	const integration = joinCard({
		id: "formatter-integration",
		title: "Add broad formatter integration coverage",
		prompt: [
			"Read specification.md and the completed formatter registry.",
			"Add ONLY test/formatters/integration.test.js.",
			"Exercise all six registered formatters through formatWith using normal, boundary, and escaping inputs; verify listFormatters has six unique entries.",
			"Keep the test plain JavaScript using node:test and assert/strict. Do not change product code to weaken assertions.",
			"Acceptance command: npm test",
		].join("\n"),
		files: ["test/formatters/integration.test.js"],
		baseRef: input.baseRef,
		now: input.now,
	});
	const dependencies: RuntimeBoardDependency[] = [
		...formatterCards.map((card) => ({
			id: `dep-${registry.id}-${card.id}`,
			fromTaskId: registry.id,
			toTaskId: card.id,
			createdAt: input.now,
		})),
		{
			id: `dep-${integration.id}-${registry.id}`,
			fromTaskId: integration.id,
			toTaskId: registry.id,
			createdAt: input.now,
		},
	];
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [...formatterCards, registry, integration] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies,
	};
}
