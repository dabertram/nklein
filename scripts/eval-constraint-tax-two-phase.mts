/** F12.78b live paired acceptance: direct constrained decoding versus free-text reasoning then constrained packaging. */

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { buildAbbaSchedule, type Arm } from "../src/core/ab-trial-ordering.js";
import {
	summarizeConstraintTaxEval,
	type ConstraintTaxEvalArm,
	type ConstraintTaxEvalObservation,
} from "../src/core/constraint-tax-eval.js";
import { buildPackagingPrompt } from "../src/core/constraint-tax-strategy.js";
import {
	LocalLlmClient,
	type LocalLlmChatMessage,
	type LocalLlmStructuredFormat,
} from "../src/nklein-agent/nklein-local-llm-client.js";

const execFile = promisify(execFileCallback);
const ROOT = resolve(import.meta.dirname, "..");
const MODEL = process.env.NKLEIN_CONSTRAINT_TAX_MODEL?.trim();
if (!MODEL) throw new Error("NKLEIN_CONSTRAINT_TAX_MODEL must name one already-loaded model.");
const OUTPUT = resolve(
	ROOT,
	process.env.NKLEIN_CONSTRAINT_TAX_OUTPUT ?? `.real-runs/constraint-tax/${MODEL.replaceAll("/", "-")}.json`,
);
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1";

interface Card {
	readonly id: string;
	readonly task: string;
	readonly path: string;
	readonly symbol: string;
}

const CARDS: readonly Card[] = [
	{
		id: "paired-default-flip",
		task: "Require both a practical improvement and a significant paired McNemar result before changing a default.",
		path: "src/core/ab-significance-gate.ts",
		symbol: "decideDefaultFlip",
	},
	{
		id: "retrieval-mode-comparison",
		task: "Compare multiple retrieval rankers and identify the best mode at each recall cutoff.",
		path: "src/core/retrieval-recall-eval.ts",
		symbol: "compareRetrievalModes",
	},
	{
		id: "thermal-drift",
		task: "Report whether the late half of a local experiment materially slowed relative to the early half.",
		path: "src/core/ab-trial-ordering.ts",
		symbol: "detectThermalDrift",
	},
	{
		id: "harness-comparability",
		task: "Reject an A/B comparison when retry budgets differ and report every other harness dimension mismatch.",
		path: "src/core/harness-card.ts",
		symbol: "assessComparability",
	},
	{
		id: "safe-model-host",
		task: "Choose a fleet device for a pending model load without violating memory reserve or user budget.",
		path: "src/core/device-load-routing.ts",
		symbol: "selectDeviceForModelLoad",
	},
	{
		id: "write-scope",
		task: "Turn a card's likely-touched paths into the normalized repository write boundary for its sandbox.",
		path: "src/nklein-agent/nklein-write-scope.ts",
		symbol: "normalizeWriteScope",
	},
	{
		id: "symbol-neighborhood",
		task: "Build a bounded k-hop symbol neighborhood while pruning hub identifiers that flood the result.",
		path: "src/core/ego-graph.ts",
		symbol: "buildSymbolEgoGraph",
	},
	{
		id: "tool-catalog-budget",
		task: "Keep mandatory tools and select the most role-relevant optional tools under a strict catalog cap.",
		path: "src/core/tool-catalog-retrieval-gate.ts",
		symbol: "gateToolCatalog",
	},
];

const SCHEMA = {
	type: "object",
	properties: { path: { type: "string" }, symbol: { type: "string" } },
	required: ["path", "symbol"],
	additionalProperties: false,
} as const;
const FORMAT: LocalLlmStructuredFormat = {
	jsonSchema: { name: "code_localization", schema: SCHEMA, strict: true },
};

interface FleetRow {
	readonly identifier: string;
	readonly contextLength: number;
	readonly sizeBytes: number;
	readonly deviceIdentifier: string | null;
	readonly status: string;
}

interface RecordedObservation extends ConstraintTaxEvalObservation {
	readonly durationMs: number;
	readonly text: string | null;
	readonly error: string | null;
}

async function fleetSnapshot(): Promise<FleetRow[]> {
	const result = await execFile("lms", ["ps", "--json"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
	const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
	return parsed
		.filter((row) => row.type === "llm")
		.map((row) => ({
			identifier: String(row.identifier ?? ""),
			contextLength: Number(row.contextLength ?? 0),
			sizeBytes: Number(row.sizeBytes ?? 0),
			deviceIdentifier: typeof row.deviceIdentifier === "string" ? row.deviceIdentifier : null,
			status: String(row.status ?? "unknown"),
		}))
		.sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function fleetIdentity(rows: readonly FleetRow[]): string {
	return JSON.stringify(rows.map(({ status: _status, ...identity }) => identity));
}

function prompt(card: Card, freeText: boolean): LocalLlmChatMessage[] {
	const catalog = CARDS.map((candidate) => `- ${candidate.path} :: ${candidate.symbol}`).join("\n");
	return [
		{
			role: "system",
			content: "You are a precise code localizer. Choose only a path and exact symbol from the supplied repository map.",
		},
		{
			role: "user",
			content: [
				"LOCALIZE THIS LEAF CARD to exactly one function.",
				"",
				`CARD:\n${card.task}`,
				"",
				`REPOSITORY MAP:\n${catalog}`,
				"",
				freeText
					? "Reason freely, then state the selected repo-relative path and exact symbol in plain text."
					: 'Return only {"path":"repo/relative/path.ts","symbol":"exactSymbol"}.',
			].join("\n"),
		},
	];
}

function parseSelection(text: string): { path: string; symbol: string } | null {
	try {
		const value = JSON.parse(text) as Record<string, unknown>;
		return typeof value.path === "string" && typeof value.symbol === "string"
			? { path: value.path, symbol: value.symbol }
			: null;
	} catch {
		return null;
	}
}

function isCorrect(selection: { path: string; symbol: string } | null, card: Card): boolean {
	return selection?.path.replace(/^\.\//u, "") === card.path && selection.symbol === card.symbol;
}

async function runArm(client: LocalLlmClient, card: Card, arm: ConstraintTaxEvalArm): Promise<RecordedObservation> {
	const started = performance.now();
	try {
		let text: string;
		if (arm === "direct_constrained") {
			text = (
				await client.complete({
					messages: prompt(card, false),
					format: FORMAT,
					sampling: { temperature: 0, maxTokens: 768 },
				})
			).content;
		} else {
			const reasoning = await client.complete({
				messages: prompt(card, true),
				sampling: { temperature: 0, maxTokens: 1_536 },
			});
			if (!reasoning.content.trim()) throw new Error("free-text reasoning turn returned no answer");
			text = (
				await client.complete({
					messages: [
						{
							role: "system",
							content: "Transcribe the supplied answer into JSON without solving the localization task again.",
						},
						{
							role: "user",
							content: buildPackagingPrompt({
								freeTextAnswer: reasoning.content,
								schemaDescription: JSON.stringify(SCHEMA, null, 2),
							}),
						},
					],
					format: FORMAT,
					sampling: { temperature: 0, maxTokens: 768 },
				})
			).content;
		}
		const selection = parseSelection(text);
		return {
			cardId: card.id,
			arm,
			valid: selection !== null,
			correct: isCorrect(selection, card),
			durationMs: Math.round(performance.now() - started),
			text,
			error: null,
		};
	} catch (error) {
		return {
			cardId: card.id,
			arm,
			valid: false,
			correct: false,
			durationMs: Math.round(performance.now() - started),
			text: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function armForSchedule(value: Arm): ConstraintTaxEvalArm {
	return value === "a" ? "direct_constrained" : "free_text_then_package";
}

async function main(): Promise<void> {
	const before = await fleetSnapshot();
	const target = before.find((row) => row.identifier === MODEL);
	if (!target) throw new Error(`Model ${MODEL} is not loaded; this evaluator never loads models.`);
	if (target.contextLength < 32_768) throw new Error(`Model ${MODEL} is below the 32k context floor.`);
	if (before.some((row) => row.status !== "idle")) {
		throw new Error("Every resident model must be idle before the paired run; refusing a capacity/thermal confound.");
	}
	const client = new LocalLlmClient({
		providerId: "lmstudio",
		modelId: MODEL,
		baseUrl: BASE_URL,
		timeoutMs: 240_000,
	});
	const schedule = buildAbbaSchedule(CARDS.length);
	const observations: RecordedObservation[] = [];
	for (const [index, card] of CARDS.entries()) {
		const first = armForSchedule(schedule[index * 2] ?? "a");
		const second = armForSchedule(schedule[index * 2 + 1] ?? "b");
		observations.push(await runArm(client, card, first));
		observations.push(await runArm(client, card, second));
	}
	const after = await fleetSnapshot();
	if (fleetIdentity(after) !== fleetIdentity(before)) {
		throw new Error("Resident fleet identity changed during the paired run; refusing confounded evidence.");
	}
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		model: MODEL,
		baseUrl: BASE_URL,
		contextLength: target.contextLength,
		cardCount: CARDS.length,
		fleet: before,
		summary: summarizeConstraintTaxEval(observations),
		observations,
	};
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
	process.stdout.write(`${JSON.stringify({ output: OUTPUT, summary: report.summary }, null, 2)}\n`);
}

await main();
