#!/usr/bin/env tsx
/**
 * scripts/effort-ab-metrics.mts — aggregate the qwen3.8 reasoning-effort A/B campaign
 * (scripts/effort-ab.sh) into its pre-registered readout.
 *
 * PRIMARY (continuous, adequately powered): per-REQUEST duration, output tokens, and reasoning-token share,
 * mined from each run home's self-observation telemetry (`category: "model_usage"`, `granularity:
 * "perRequest"` — the F4.12 recorder; the attempt-grain ledger rows carry no reasoning breakdown).
 * GUARD (underpowered by construction at this scale — reported as counts, never as a verdict): the
 * controller's outcome classification + wall seconds per run.
 *
 * Only ARM-VERIFIED runs count (the campaign ledger's armVerified flag, derived from the devlog's rendered
 * prompts). Unverified runs are listed, not aggregated.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface CampaignRow {
	recordedAt: string;
	arm: "A" | "B";
	effort: "xhigh" | "medium";
	preset: string;
	runDir: string;
	armVerified: boolean;
}

interface RequestSample {
	effort: string;
	preset: string;
	durationMs: number | null;
	inputTokens: number | null;
	outputTokens: number | null;
	reasoningTokens: number | null;
	finishReason: string | null;
}

const ledgerPath = join(homedir(), "nklein-ab-campaigns", "qwen38-effort.jsonl");
if (!existsSync(ledgerPath)) {
	console.error(`no campaign ledger at ${ledgerPath} — run scripts/effort-ab.sh first`);
	process.exit(66);
}

const rows: CampaignRow[] = readFileSync(ledgerPath, "utf8")
	.split("\n")
	.filter((line) => line.trim().length > 0)
	.map((line) => JSON.parse(line) as CampaignRow);

const unverified = rows.filter((row) => !row.armVerified);
const verified = rows.filter((row) => row.armVerified && row.runDir);

function collectRequests(row: CampaignRow): RequestSample[] {
	const telemetryDir = join(row.runDir, "home", ".nklein", "nklein", "telemetry");
	if (!existsSync(telemetryDir)) return [];
	const samples: RequestSample[] = [];
	for (const file of readdirSync(telemetryDir).filter((name) => name.endsWith(".jsonl"))) {
		for (const line of readFileSync(join(telemetryDir, file), "utf8").split("\n")) {
			if (!line.includes("perRequest")) continue;
			let event: { metadata?: Record<string, unknown> };
			try {
				event = JSON.parse(line) as { metadata?: Record<string, unknown> };
			} catch {
				continue;
			}
			const meta = event.metadata;
			if (meta?.category !== "model_usage" || meta?.granularity !== "perRequest") continue;
			const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
			samples.push({
				effort: row.effort,
				preset: row.preset,
				durationMs: num(meta.durationMs),
				inputTokens: num(meta.inputTokens),
				outputTokens: num(meta.outputTokens),
				reasoningTokens: num(meta.reasoningTokens),
				finishReason: typeof meta.finishReason === "string" ? meta.finishReason : null,
			});
		}
	}
	return samples;
}

function controllerOutcome(row: CampaignRow): { outcome: string; seconds: number | null } {
	const resultPath = join(row.runDir, "controller-result.json");
	if (!existsSync(resultPath)) return { outcome: "no controller result", seconds: null };
	try {
		const parsed = JSON.parse(readFileSync(resultPath, "utf8")) as {
			outcome?: string;
			durationSeconds?: number;
		};
		return { outcome: parsed.outcome ?? "unknown", seconds: parsed.durationSeconds ?? null };
	} catch {
		return { outcome: "unreadable controller result", seconds: null };
	}
}

const samples = verified.flatMap(collectRequests);

function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) return Number.NaN;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
	return sorted[idx];
}

function describeArm(effort: "xhigh" | "medium"): void {
	const arm = samples.filter((sample) => sample.effort === effort);
	const durations = arm
		.map((sample) => sample.durationMs)
		.filter((value): value is number => value !== null)
		.sort((a, b) => a - b);
	const outputs = arm
		.map((sample) => sample.outputTokens)
		.filter((value): value is number => value !== null)
		.sort((a, b) => a - b);
	const shares = arm
		.filter(
			(sample) =>
				sample.reasoningTokens !== null && sample.outputTokens !== null && sample.outputTokens > 0,
		)
		.map((sample) => (sample.reasoningTokens as number) / (sample.outputTokens as number))
		.sort((a, b) => a - b);
	const truncations = arm.filter((sample) => sample.finishReason === "max-tokens").length;
	const runCount = verified.filter((row) => row.effort === effort).length;
	console.log(`\n== ${effort} — ${arm.length} model request(s) from ${runCount} verified run(s)`);
	if (arm.length === 0) return;
	if (durations.length > 0) {
		console.log(
			`  request duration s   p50=${(quantile(durations, 0.5) / 1000).toFixed(1)}  p90=${(quantile(durations, 0.9) / 1000).toFixed(1)}  mean=${(durations.reduce((a, b) => a + b, 0) / durations.length / 1000).toFixed(1)}  (n=${durations.length})`,
		);
	}
	if (outputs.length > 0) {
		console.log(
			`  output tokens        p50=${Math.round(quantile(outputs, 0.5))}  p90=${Math.round(quantile(outputs, 0.9))}  total=${outputs.reduce((a, b) => a + b, 0)}`,
		);
	}
	if (shares.length > 0) {
		console.log(
			`  reasoning share      p50=${quantile(shares, 0.5).toFixed(3)}  p90=${quantile(shares, 0.9).toFixed(3)}  (n=${shares.length} with breakdown)`,
		);
	} else {
		console.log("  reasoning share      NO SAMPLES with a reasoning breakdown — this half of the metric is dark");
	}
	console.log(`  max-tokens finishes  ${truncations}/${arm.length}`);
}

console.log(`campaign ledger: ${ledgerPath}`);
console.log(`rows: ${rows.length} total, ${verified.length} arm-verified, ${unverified.length} UNVERIFIED (excluded)`);
for (const row of unverified) console.log(`  UNVERIFIED: ${row.recordedAt} ${row.effort} ${row.preset} ${row.runDir}`);

describeArm("xhigh");
describeArm("medium");

console.log("\n== guard metrics (underpowered at this scale — counts, not a verdict)");
for (const row of verified) {
	const { outcome, seconds } = controllerOutcome(row);
	console.log(`  ${row.effort.padEnd(6)} ${row.preset.padEnd(11)} ${String(seconds ?? "?").padStart(5)}s  ${outcome}`);
}

const xhighSamples = samples.filter((sample) => sample.effort === "xhigh").length;
const mediumSamples = samples.filter((sample) => sample.effort === "medium").length;
if (xhighSamples === 0 || mediumSamples === 0) {
	console.log("\nVERDICT: NOT READABLE YET — at least one arm has zero request samples.");
	process.exit(1);
}
