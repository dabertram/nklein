#!/usr/bin/env tsx
/**
 * Model-lab CLI (todo §5.AB / §5.AF — the 2026-06-29 load-handover engine). The thin effectful entrypoint that wires a
 * real `spawn`-backed `lms` runner to the GUARDED orchestration in `src/core/lms-model-runner.ts`. Every load goes
 * through `loadModelExclusive`, so the hard guardrails (one resident at a time, context 40000, headroom-checked) are
 * always enforced — this script never bypasses them.
 *
 * Subcommands:
 *   model-lab ps                 — list resident models (read-only; safe anytime).
 *   model-lab load <id> [ctx]    — make <id> the sole resident LLM (unloads others, headroom-checked, ctx default 40000).
 *   model-lab unload <id>        — unload one model.
 *
 * Usage: tsx scripts/model-lab.mts <subcommand> …
 * Env:   NKLEIN_LMS_BIN (default ~/.lmstudio/bin/lms), NKLEIN_LOAD_RESERVE_FRACTION (default 0.25).
 */

import { spawn } from "node:child_process";
import { homedir, totalmem, userInfo } from "node:os";
import { buildLmsUnloadArgs } from "../src/core/lms-model-control";
import { type LmsRunner, listResidentModels, loadModelExclusive } from "../src/core/lms-model-runner";

/** A real `lms` runner: spawns the CLI with HOME restored to the OS passwd home (so `lms` finds its auth key). */
function createLmsRunner(): LmsRunner {
	const bin = process.env.NKLEIN_LMS_BIN?.trim() || `${homedir()}/.lmstudio/bin/lms`;
	return (args) =>
		new Promise((resolve) => {
			const child = spawn(bin, [...args], { env: { ...process.env, HOME: userInfo().homedir } });
			let stdout = "";
			child.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			child.stderr?.on("data", (d) => {
				stdout += d.toString();
			});
			child.on("error", (e) => resolve({ stdout: `(lms spawn failed: ${e.message})`, exitCode: 127 }));
			child.on("close", (code) => resolve({ stdout, exitCode: code ?? 1 }));
		});
}

async function main(): Promise<void> {
	const [, , subcommand, arg, ctxArg] = process.argv;
	const run = createLmsRunner();
	const reserveFraction = Number.parseFloat(process.env.NKLEIN_LOAD_RESERVE_FRACTION ?? "0.25");

	if (subcommand === "ps") {
		const models = await listResidentModels(run);
		console.log(`Resident models (${models.length}):`);
		for (const m of models) {
			const gib = m.sizeBytes ? `${(m.sizeBytes / 1024 ** 3).toFixed(2)} GiB` : "?";
			console.log(`  ${m.identifier}  ·  ${gib}  ·  ctx ${m.contextLength ?? "?"}`);
		}
		return;
	}
	if (subcommand === "load") {
		if (!arg) {
			console.error("usage: model-lab load <id> [contextLength]");
			process.exit(64);
		}
		const result = await loadModelExclusive(run, {
			modelId: arg,
			totalRamBytes: totalmem(),
			contextLength: ctxArg ? Number.parseInt(ctxArg, 10) : 40_000,
			reserveFraction,
		});
		console.log(JSON.stringify(result, null, 2));
		process.exit(result.loaded ? 0 : 1);
	}
	if (subcommand === "unload") {
		if (!arg) {
			console.error("usage: model-lab unload <id>");
			process.exit(64);
		}
		const { exitCode } = await run(buildLmsUnloadArgs(arg));
		console.log(`unload ${arg}: exit ${exitCode}`);
		process.exit(exitCode);
	}
	console.log("usage: tsx scripts/model-lab.mts ps | load <id> [ctx] | unload <id>");
}

main().catch((error) => {
	console.error(`FATAL: ${error instanceof Error ? error.stack : String(error)}`);
	process.exit(2);
});
