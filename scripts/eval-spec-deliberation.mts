/** F12.111b live paired acceptance: plain single-model clarification versus spec-time deliberation. */

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { buildAbbaSchedule, type Arm } from "../src/core/ab-trial-ordering.js";
import type { LoadedModelDescriptor } from "../src/core/lmstudio-loaded-model-descriptors.js";
import {
	summarizeSpecDeliberationEval,
	type ExpectedAmbiguityConcept,
	type SpecDeliberationEvalArm,
	type SpecDeliberationEvalObservation,
} from "../src/core/spec-deliberation-eval.js";
import { LocalLlmClient } from "../src/nklein-agent/nklein-local-llm-client.js";
import { runSpecDeliberation } from "../src/nklein-agent/nklein-spec-deliberation-runner.js";

const execFile = promisify(execFileCallback);
const ROOT = resolve(import.meta.dirname, "..");
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1";
const PRIMARY_MODEL = process.env.NKLEIN_SPEC_DELIBERATION_MODEL?.trim() || "qwen/qwen3.6-35b-a3b";
const OUTPUT = resolve(
	ROOT,
	process.env.NKLEIN_SPEC_DELIBERATION_OUTPUT ??
		`.real-runs/spec-deliberation/${PRIMARY_MODEL.replaceAll("/", "-")}-${Date.now()}.json`,
);

interface EvalCase {
	readonly id: string;
	readonly spec: string;
	readonly difficulty: number;
	readonly expected: readonly ExpectedAmbiguityConcept[];
}

const CASES: readonly EvalCase[] = [
	{
		id: "rate-limit",
		spec: "Add rate limiting to the API. Admins are exempt. Persist the counters and make it fast.",
		difficulty: 0.8,
		expected: [
			{ id: "window", keywordGroups: [["window", "period"], ["fixed", "sliding", "rolling"]] },
			{ id: "admin-identity", keywordGroups: [["admin"], ["role", "token", "ip", "identity"]] },
			{ id: "scope", keywordGroups: [["limit", "counter"], ["user", "tenant", "client", "global"]] },
		],
	},
	{
		id: "offline-sync",
		spec: "The notes app must work offline and sync edits when connectivity returns. Conflicts should be handled cleanly.",
		difficulty: 0.85,
		expected: [
			{ id: "conflict-policy", keywordGroups: [["conflict"], ["merge", "last", "winner", "prompt"]] },
			{ id: "deletion", keywordGroups: [["delete", "deletion", "tombstone"], ["sync", "conflict", "offline"]] },
		],
	},
	{
		id: "export",
		spec: "Let users export reports. Large reports should not time out. Notify the user when the export is ready.",
		difficulty: 0.7,
		expected: [
			{ id: "format", keywordGroups: [["format"], ["csv", "pdf", "json", "xlsx"]] },
			{ id: "notification", keywordGroups: [["notif", "ready"], ["email", "push", "in-app", "channel"]] },
		],
	},
	{
		id: "retention",
		spec: "Archive old audit events according to the retention policy while keeping administrators able to search history.",
		difficulty: 0.75,
		expected: [
			{ id: "duration", keywordGroups: [["retention", "old"], ["day", "month", "year", "duration", "period"]] },
			{ id: "archive-search", keywordGroups: [["archive", "history"], ["search", "index", "restore", "query"]] },
		],
	},
	{
		id: "clear-add",
		spec:
			"Implement src/add.ts exporting add(a: number, b: number): number. Return a + b without coercion. Acceptance: npm test passes.",
		difficulty: 0.1,
		expected: [],
	},
	{
		id: "clear-health",
		spec:
			"Add GET /health returning HTTP 200 and JSON {\"status\":\"ok\"}. It requires no authentication and performs no dependency checks. Acceptance: the route test passes.",
		difficulty: 0.2,
		expected: [],
	},
];

interface FleetRow {
	readonly identifier: string;
	readonly modelKey: string;
	readonly contextLength: number;
	readonly sizeBytes: number;
	readonly deviceIdentifier: string | null;
	readonly status: string;
	readonly architecture?: string;
	readonly trainedForToolUse?: boolean;
}

async function fleetSnapshot(): Promise<FleetRow[]> {
	const result = await execFile("lms", ["ps", "--json"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
	const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
	return parsed
		.filter((row) => row.type === "llm")
		.map((row) => ({
			identifier: String(row.identifier ?? ""),
			modelKey: String(row.modelKey ?? row.identifier ?? ""),
			contextLength: Number(row.contextLength ?? 0),
			sizeBytes: Number(row.sizeBytes ?? 0),
			deviceIdentifier: typeof row.deviceIdentifier === "string" ? row.deviceIdentifier : null,
			status: String(row.status ?? "unknown"),
			...(typeof row.architecture === "string" ? { architecture: row.architecture } : {}),
			...(typeof row.trainedForToolUse === "boolean" ? { trainedForToolUse: row.trainedForToolUse } : {}),
		}))
		.sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function fleetIdentity(rows: readonly FleetRow[]): string {
	return JSON.stringify(rows.map(({ status: _status, ...identity }) => identity));
}

function descriptors(rows: readonly FleetRow[]): LoadedModelDescriptor[] {
	return rows.map((row) => ({
		runtimeId: row.identifier,
		modelKey: row.modelKey,
		isEmbedding: false,
		loadedContextLength: row.contextLength,
		sizeBytes: row.sizeBytes,
		...(row.architecture ? { architecture: row.architecture } : {}),
		...(row.trainedForToolUse !== undefined ? { toolUse: row.trainedForToolUse } : {}),
	}));
}

function parsePlainQuestions(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
		.filter((line) => line.length > 0 && !/^NO_(?:QUESTION|CLARIFICATION)/i.test(line))
		.slice(0, 6);
}

function plainPrompt(spec: string): string {
	return [
		"Before implementation, identify only genuine ambiguities in this specification.",
		"Ask concise clarification questions, one per line. Do not rewrite the spec or recommend technologies.",
		"If it is clear enough to implement, reply exactly NO_QUESTION.",
		"",
		"SPECIFICATION:",
		spec,
	].join("\n");
}

function armForSchedule(value: Arm): SpecDeliberationEvalArm {
	return value === "a" ? "plain_single_model" : "deliberation";
}

async function runArm(
	arm: SpecDeliberationEvalArm,
	caseItem: EvalCase,
	primary: FleetRow,
	fleet: readonly FleetRow[],
): Promise<SpecDeliberationEvalObservation> {
	const started = performance.now();
	let modelCalls = 0;
	try {
		if (arm === "plain_single_model") {
			modelCalls = 1;
			const completion = await new LocalLlmClient({
				providerId: "lmstudio",
				modelId: primary.identifier,
				baseUrl: BASE_URL,
				timeoutMs: 240_000,
			}).complete({
				messages: [{ role: "user", content: plainPrompt(caseItem.spec) }],
				sampling: { temperature: 0.2, topP: 0.9, maxTokens: 1_200 },
			});
			return {
				caseId: caseItem.id,
				arm,
				concerns: parsePlainQuestions(completion.content),
				expected: caseItem.expected,
				modelCalls,
				durationMs: Math.round(performance.now() - started),
				error: null,
			};
		}
		const result = await runSpecDeliberation({
			specText: caseItem.spec,
			difficulty: caseItem.difficulty,
			primary: {
				providerId: "lmstudio",
				modelId: primary.identifier,
				modelKey: primary.modelKey,
				baseUrl: BASE_URL,
				contextWindow: primary.contextLength,
			},
			loaded: descriptors(fleet),
			runTurn: async ({ model, prompt }) => {
				modelCalls += 1;
				const completion = await new LocalLlmClient({
					providerId: "lmstudio",
					modelId: model.modelId,
					baseUrl: BASE_URL,
					timeoutMs: 240_000,
				}).complete({
					messages: [{ role: "user", content: prompt }],
					sampling: { temperature: 0.2, topP: 0.9, maxTokens: 1_200 },
				});
				return completion.content;
			},
		});
		return {
			caseId: caseItem.id,
			arm,
			concerns: result?.deliberation.clarifyingQuestions ?? [],
			expected: caseItem.expected,
			modelCalls,
			durationMs: Math.round(performance.now() - started),
			error: null,
		};
	} catch (error) {
		return {
			caseId: caseItem.id,
			arm,
			concerns: [],
			expected: caseItem.expected,
			modelCalls,
			durationMs: Math.round(performance.now() - started),
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function main(): Promise<void> {
	const before = await fleetSnapshot();
	const primary = before.find((row) => row.identifier === PRIMARY_MODEL);
	if (!primary) throw new Error(`Primary model ${PRIMARY_MODEL} is not loaded; this evaluator never loads models.`);
	if (before.some((row) => row.contextLength < 32_768)) throw new Error("Every resident model must meet the 32k context floor.");
	if (before.some((row) => row.status !== "idle")) throw new Error("Every resident model must be idle before the paired run.");
	const schedule = buildAbbaSchedule(CASES.length);
	const observations: SpecDeliberationEvalObservation[] = [];
	for (const [index, caseItem] of CASES.entries()) {
		observations.push(await runArm(armForSchedule(schedule[index * 2] ?? "a"), caseItem, primary, before));
		observations.push(await runArm(armForSchedule(schedule[index * 2 + 1] ?? "b"), caseItem, primary, before));
	}
	const after = await fleetSnapshot();
	if (fleetIdentity(after) !== fleetIdentity(before)) {
		throw new Error("Resident fleet identity changed during the paired run; refusing confounded evidence.");
	}
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		primaryModel: PRIMARY_MODEL,
		baseUrl: BASE_URL,
		fleet: before,
		caseCount: CASES.length,
		scheduling: "paired ABBA; same primary and specification per pair; evaluator never loads or unloads models",
		summary: summarizeSpecDeliberationEval(observations),
		observations,
	};
	await mkdir(dirname(OUTPUT), { recursive: true });
	await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
	process.stdout.write(`${JSON.stringify({ output: OUTPUT, summary: report.summary }, null, 2)}\n`);
}

await main();
