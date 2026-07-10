/**
 * §5.AF replay determinism — the `reconfirm` mode's harness half: run the SAME seeded simulated flow twice
 * (fresh isolated HOMEs, identical inline smoke scenario, zero LLM compute) and compare the two Agent Attempt
 * Ledgers with the pure `compareLedgerReplayDeterminism` core. A deterministic runtime produces the same causal
 * event set both times; any drift is localized to the first divergent event — which is exactly the "debug races
 * without GPU" lever the §5.AF replay item asks for (a race shows up as an outcome/retry/transition drift here
 * long before it becomes a live flake).
 *
 * Run-scoped identifiers are normalized before comparison (they differ BY DESIGN across runs, not by behavior):
 *   - the dev-test SEED task id embeds a wall-clock stamp (`devtest-<scenario>-<ms>`) → folded to `seed-task`;
 *   - `durable-run:<workspaceId>` workflow ids → `durable-run` (workspace ids embed the scaffold dir name);
 *   - workflow/task ids equal to the per-run workspace id → `workspace`.
 *
 * Usage:  npx tsx scripts/verify-replay-determinism.mts
 * Exit:   0 deterministic · 1 harness failure · 2 divergence found (report printed, first drift localized).
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	compareLedgerReplayDeterminism,
	type ReplayEventView,
} from "../src/core/ledger-replay-determinism.js";

function fail(message: string): never {
	console.error(`FAIL ✗ ${message}`);
	process.exit(1);
}

/** Run one seeded simulated smoke flow in a fresh isolated HOME; returns that HOME. */
async function runSimulatedFlow(label: string): Promise<string> {
	const home = mkdtempSync(join(tmpdir(), `nklein-replay-${label}-`));
	console.log(`[${label}] HOME=${home} — running the seeded simulated smoke flow…`);
	const child = spawn("npx", ["tsx", "scripts/verify-simulated-flow.mts"], {
		env: { ...process.env, HOME: home },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let out = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		out += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		out += chunk.toString();
	});
	const exit: number = await new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
	if (exit !== 0) {
		console.error(out.slice(-1500));
		fail(`[${label}] simulated flow exited ${exit} — determinism comparison needs two PASSING runs`);
	}
	console.log(`[${label}] PASS.`);
	return home;
}

/** Load every agent-attempt-ledger event recorded under an isolated HOME (all workspace hashes merged). */
function readLedgerEvents(home: string): Record<string, unknown>[] {
	// resolveNkleinRuntimeHomePath(home) = <home>/.nklein/nklein (the runtime home); the store dir sits inside it.
	const ledgerDir = join(home, ".nklein", "nklein", "agent-attempt-ledger");
	let files: string[] = [];
	try {
		files = readdirSync(ledgerDir).filter((name) => name.endsWith(".jsonl"));
	} catch {
		return [];
	}
	const events: Record<string, unknown>[] = [];
	for (const file of files.sort()) {
		for (const line of readFileSync(join(ledgerDir, file), "utf8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				events.push(JSON.parse(trimmed) as Record<string, unknown>);
			} catch {
				// skip torn lines — best-effort JSONL
			}
		}
	}
	return events;
}

/** Fold run-scoped identifiers (wall-clock seed ids, per-run workspace ids, ephemeral ports) to stable tokens. */
function normalizeRunScopedIds(events: Record<string, unknown>[]): ReplayEventView[] {
	return events.map((event) => {
		const view = { ...event } as Record<string, unknown>;
		for (const field of ["taskId", "workflowId"] as const) {
			const value = view[field];
			if (typeof value !== "string") {
				continue;
			}
			if (/^devtest-.*-\d{10,}$/.test(value)) {
				view[field] = "seed-task";
			} else if (value.startsWith("durable-run:")) {
				view[field] = "durable-run";
			} else if (/^nklein-.*-\d{10,}(-[a-z0-9]+)?$/i.test(value)) {
				view[field] = "workspace";
			}
		}
		// The simulator binds a RANDOM localhost port per run; the port rides inside `endpoint` AND inside
		// registry-key shaped `modelId`s (`lmstudio:<model>:<endpoint>`). Mask it everywhere — the HOST identity
		// stays, only the ephemeral port folds.
		for (const [key, value] of Object.entries(view)) {
			if (typeof value === "string" && /(?:localhost|127\.0\.0\.1):\d+/.test(value)) {
				view[key] = value.replace(/(localhost|127\.0\.0\.1):\d+/g, "$1:PORT");
			}
		}
		return view as unknown as ReplayEventView;
	});
}

async function main(): Promise<void> {
	const homeA = await runSimulatedFlow("run-a");
	const homeB = await runSimulatedFlow("run-b");

	const capturedRaw = readLedgerEvents(homeA);
	const replayedRaw = readLedgerEvents(homeB);
	console.log(`Ledger events: run-a ${capturedRaw.length} · run-b ${replayedRaw.length}`);
	if (capturedRaw.length === 0 || replayedRaw.length === 0) {
		fail("one of the runs recorded no ledger events — nothing to compare (did the recorders move?)");
	}

	const verdict = compareLedgerReplayDeterminism(
		normalizeRunScopedIds(capturedRaw),
		normalizeRunScopedIds(replayedRaw),
	);
	if (verdict.deterministic) {
		console.log(
			`PASS ✓ replay deterministic — ${verdict.capturedCount} causal events matched across two independent seeded runs.`,
		);
		return;
	}
	console.error(
		`DIVERGENT ✗ first drift at causal index ${verdict.firstDivergence?.index} (${verdict.firstDivergence?.kind}):`,
	);
	console.error(`  run-a: ${verdict.firstDivergence?.capturedSignature ?? "(absent)"}`);
	console.error(`  run-b: ${verdict.firstDivergence?.replayedSignature ?? "(absent)"}`);
	console.error(
		`  counts: run-a ${verdict.capturedCount} vs run-b ${verdict.replayedCount}. A drift here is a real behavioral race — debug it without a GPU.`,
	);
	process.exit(2);
}

await main();
