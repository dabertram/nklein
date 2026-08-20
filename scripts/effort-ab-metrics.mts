#!/usr/bin/env tsx
/**
 * scripts/effort-ab-metrics.mts — aggregate the qwen3.8 reasoning-effort A/B campaign
 * (scripts/effort-ab.sh) into its pre-registered readout.
 *
 * PRIMARY (continuous, adequately powered): per-attempt duration + reasoning-token share, from each run's
 * agent-attempt-ledger (`kind: "attempt"` rows carry durationMs/totalTokens/reasoningTokens since N18).
 * GUARD (underpowered by construction at this scale — reported as counts, never as a verdict): board
 * outcomes from the controller result.
 *
 * Only ARM-VERIFIED runs count (the ledger row's armVerified flag, derived from the devlog's rendered
 * prompts). Unverified runs are listed, not aggregated.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface CampaignRow {
	recordedAt: string;
	arm: "A" | "B";
	effort: "xhigh" | "medium";
	preset: string;
	runDir: string;
	armVerified: boolean;
}

interface AttemptSample {
	effort: string;
	preset: string;
	durationMs: number;
	totalTokens: number | null;
	reasoningTokens: number | null;
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

function collectAttempts(row: CampaignRow): AttemptSample[] {
	const ledgerDir = join(row.runDir, "home", ".nklein", "nklein", "agent-attempt-ledger");
	if (!existsSync(ledgerDir)) return [];
	const samples: AttemptSample[] = [];
	for (const file of readdirSync(ledgerDir).filter((name) => name.endsWith(".jsonl"))) {
		for (const line of readFileSync(join(ledgerDir, file), "utf8").split("\n")) {
			if (!line.trim()) continue;
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}
			if (event.kind !== "attempt" || typeof event.durationMs !== "number") continue;
			samples.push({
				effort: row.effort,
				preset: row.preset,
				durationMs: event.durationMs,
				totalTokens: typeof event.totalTokens === "number" ? event.totalTokens : null,
				reasoningTokens: typeof event.reasoningTokens === "number" ? event.reasoningTokens : null,
			});
		}
	}
	return samples;
}

function boardCounts(row: CampaignRow): string {
	const resultPath = join(row.runDir, "controller-result.json");
	if (!existsSync(resultPath)) return "no controller result";
	try {
		const parsed = JSON.parse(readFileSync(resultPath, "utf8")) as { counts?: Record<string, number> };
		const counts = parsed.counts ?? {};
		return Object.entries(counts)
			.filter(([, count]) => count > 0)
			.map(([lane, count]) => `${lane}=${count}`)
			.join(" ");
	} catch {
		return "unreadable controller result";
	}
}

const samples = verified.flatMap(collectAttempts);

function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) return Number.NaN;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
	return sorted[idx];
}

function describeArm(effort: "xhigh" | "medium"): void {
	const arm = samples.filter((sample) => sample.effort === effort);
	const durations = arm.map((sample) => sample.durationMs).sort((a, b) => a - b);
	const shares = arm
		.filter((sample) => sample.reasoningTokens !== null && sample.totalTokens !== null && sample.totalTokens > 0)
		.map((sample) => (sample.reasoningTokens as number) / (sample.totalTokens as number))
		.sort((a, b) => a - b);
	console.log(`\n== ${effort} — ${arm.length} attempt sample(s) from ${verified.filter((r) => r.effort === effort).length} verified run(s)`);
	if (arm.length === 0) return;
	console.log(
		`  attempt duration ms  p50=${Math.round(quantile(durations, 0.5))}  p90=${Math.round(quantile(durations, 0.9))}  mean=${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}`,
	);
	if (shares.length > 0) {
		console.log(
			`  reasoning share      p50=${quantile(shares, 0.5).toFixed(3)}  p90=${quantile(shares, 0.9).toFixed(3)}  (n=${shares.length} with token breakdown)`,
		);
	} else {
		console.log("  reasoning share      NO SAMPLES with token breakdown — the primary metric is DARK for this arm");
	}
}

console.log(`campaign ledger: ${ledgerPath}`);
console.log(`rows: ${rows.length} total, ${verified.length} arm-verified, ${unverified.length} UNVERIFIED (excluded)`);
for (const row of unverified) console.log(`  UNVERIFIED: ${row.recordedAt} ${row.effort} ${row.preset} ${row.runDir}`);

describeArm("xhigh");
describeArm("medium");

console.log("\n== guard metrics (underpowered at this scale — counts, not a verdict)");
for (const row of verified) {
	console.log(`  ${row.effort.padEnd(6)} ${row.preset.padEnd(12)} ${boardCounts(row)}`);
}

const xhighSamples = samples.filter((sample) => sample.effort === "xhigh").length;
const mediumSamples = samples.filter((sample) => sample.effort === "medium").length;
if (xhighSamples === 0 || mediumSamples === 0) {
	console.log("\nVERDICT: NOT READABLE YET — at least one arm has zero attempt samples.");
	process.exit(1);
}
