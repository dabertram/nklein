#!/usr/bin/env tsx
/**
 * Model-lab CLI (todo §5.AB / §5.AF — the 2026-06-29 load-handover engine). The thin effectful entrypoint that wires a
 * real `spawn`-backed `lms` runner to the GUARDED orchestration in `src/core/lms-model-runner.ts`. Every load goes
 * through `loadModelExclusive`, so the hard guardrails (one resident at a time, context 40000, headroom-checked) are
 * always enforced — this script never bypasses them.
 *
 * Subcommands:
 *   model-lab ps                 — list resident models (read-only; safe anytime).
 *   model-lab check <id>         — print the §5.AL capability-catalog verdict for a model id (read-only; no load).
 *   model-lab load <id> [ctx]    — make <id> the sole resident LLM (unloads others, headroom-checked, ctx default 40000).
 *   model-lab unload <id>        — unload one model.
 *
 * Usage: tsx scripts/model-lab.mts <subcommand> …
 * Env:   NKLEIN_LMS_BIN (default ~/.lmstudio/bin/lms), NKLEIN_LOAD_RESERVE_FRACTION (default 0.25),
 *        NKLEIN_LOAD_GPU (max|off|auto|0..1 offload ratio — the small-VRAM linked-box lever), NKLEIN_LOAD_DEVICE
 *        (scope the one-at-a-time unload to a single LM Link device, e.g. legion5pro/m4mini), NKLEIN_LOAD_DEVICE_ID
 *        (optional LM Link device identifier; resolved from NKLEIN_LOAD_DEVICE when omitted), NKLEIN_LOAD_TARGET_RAM_GB
 *        (target machine RAM for remote headroom).
 */

import { spawn } from "node:child_process";
import { homedir, totalmem, userInfo } from "node:os";
import { buildLmsUnloadArgs } from "../src/core/lms-model-control";
import { fetchLmsLinkDevices } from "../src/core/lms-link-status";
import {
	assessModelSuitability,
	buildCatalogRosterRecommendation,
	resolveActiveModelSuitabilityPolicy,
} from "../src/core/model-capability-catalog";
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

/** Parse the optional NKLEIN_LOAD_GPU env into a gpu-offload policy ("max"/"off"/"auto"/a 0..1 ratio); undefined when unset. */
function parseGpuEnv(): "max" | "off" | "auto" | number | undefined {
	const v = process.env.NKLEIN_LOAD_GPU?.trim();
	if (!v) {
		return undefined;
	}
	if (v === "max" || v === "off" || v === "auto") {
		return v;
	}
	const n = Number.parseFloat(v);
	return Number.isFinite(n) ? n : undefined;
}

function parseGbEnv(name: string): number | undefined {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return undefined;
	}
	const gb = Number.parseFloat(raw);
	return Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024 ** 3) : undefined;
}

async function resolveTargetDeviceIdentifier(run: LmsRunner, targetDevice: string | undefined): Promise<string | undefined> {
	const explicit = process.env.NKLEIN_LOAD_DEVICE_ID?.trim();
	if (explicit) {
		return explicit;
	}
	if (!targetDevice || targetDevice === "Local") {
		return undefined;
	}
	const devices = await fetchLmsLinkDevices(run);
	if (devices.namesByDeviceId.has(targetDevice)) {
		return targetDevice;
	}
	for (const [id, name] of devices.namesByDeviceId) {
		if (name === targetDevice) {
			return id;
		}
	}
	return undefined;
}

async function main(): Promise<void> {
	const [, , subcommand, arg, ctxArg] = process.argv;
	const run = createLmsRunner();
	const reserveFraction = Number.parseFloat(process.env.NKLEIN_LOAD_RESERVE_FRACTION ?? "0.25");
	const targetDevice = process.env.NKLEIN_LOAD_DEVICE?.trim() || undefined;
	const targetTotalRamBytes = parseGbEnv("NKLEIN_LOAD_TARGET_RAM_GB") ?? totalmem();

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
			totalRamBytes: targetTotalRamBytes,
			contextLength: ctxArg ? Number.parseInt(ctxArg, 10) : 40_000,
			reserveFraction,
			suitabilityPolicy: resolveActiveModelSuitabilityPolicy(),
			gpu: parseGpuEnv(),
			targetDevice,
			targetDeviceIdentifier: await resolveTargetDeviceIdentifier(run, targetDevice),
		});
		console.log(JSON.stringify(result, null, 2));
		process.exit(result.loaded ? 0 : 1);
	}
	if (subcommand === "roster") {
		// model-lab roster — print the §5.AL catalog roster recommendation (prefer / caution / avoid), the catalog-side of
		// the keep-list. Read-only; no load. Pure projection over the curated catalog.
		const tiers = buildCatalogRosterRecommendation();
		const mark = { prefer: "✅", caution: "◑", avoid: "⛔" } as const;
		for (const tier of tiers) {
			console.log(`\n${mark[tier.tier]} ${tier.tier.toUpperCase()} — ${tier.rationale}`);
			for (const f of tier.families) {
				console.log(`   ${f.toolUse.padEnd(16)} ${f.family}${f.verified ? "" : "  (unverified)"}`);
			}
		}
		return;
	}
	if (subcommand === "check") {
		// model-lab check <id> — print the §5.AL capability-catalog verdict for a model id (the CLI seed of the
		// "check model" feature). Read-only; no load. Exit 0 ok, 1 warn/unknown, 2 reject — so it's scriptable.
		if (!arg) {
			console.error("usage: model-lab check <id>");
			process.exit(64);
		}
		const v = assessModelSuitability(arg, resolveActiveModelSuitabilityPolicy());
		console.log(`${arg}`);
		console.log(`  tool-use:  ${v.toolUse}`);
		console.log(`  severity:  ${v.severity}${v.allowed ? "" : "  (would be gated under the default policy)"}`);
		console.log(`  reason:    ${v.reason}`);
		if (v.entry) {
			console.log(`  kind:      ${v.entry.kind}  ·  basis: ${v.entry.basis}${v.entry.verified === false ? " (UNVERIFIED)" : ""}`);
			console.log(`  sources:   ${v.entry.sources.join("  ")}`);
		}
		process.exit(v.severity === "reject" ? 2 : v.severity === "ok" ? 0 : 1);
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
	if (subcommand === "get") {
		// model-lab get <name>[@quant] — download a model via `lms get` (prepared per the 2026-06-29 plan; NOT used until
		// the user says so). Supports a quant suffix (e.g. google/gemma-4-e2b@8bit) for the GGUF/quant A/Bs. Retries once
		// on a stalled/failed download (the user asked to retry stalls).
		if (!arg) {
			console.error("usage: model-lab get <name>[@quant]");
			process.exit(64);
		}
		for (let attempt = 1; attempt <= 2; attempt++) {
			console.log(`lms get ${arg} (attempt ${attempt}/2)…`);
			const { stdout, exitCode } = await run(["get", arg, "--yes"]);
			if (exitCode === 0) {
				console.log(`✓ downloaded ${arg}`);
				process.exit(0);
			}
			console.log(`  attempt ${attempt} failed (exit ${exitCode}): ${stdout.slice(-200)}`);
		}
		console.error(`✗ download of ${arg} failed after 2 attempts`);
		process.exit(1);
	}
	if (subcommand === "sweep") {
		// model-lab sweep <harness> <id1,id2,…> — for each model: guarded-load it (one resident at a time), run the
		// harness against just that model, record PASS/PARTIAL/FAIL, move on. Spawns LLM inference (the harness) — only
		// run this AFTER the user has handed over loading control.
		const harness = arg;
		const modelIds = (ctxArg ?? "").split(",").map((s) => s.trim()).filter(Boolean);
		if (!harness || modelIds.length === 0) {
			console.error("usage: model-lab sweep <harness> <id1,id2,…>");
			process.exit(64);
		}
		const results: { modelId: string; loaded: boolean; verdict: string }[] = [];
		for (const modelId of modelIds) {
			console.log(`\n──────── ${harness} · ${modelId} ────────`);
			const load = await loadModelExclusive(run, {
				modelId,
				totalRamBytes: targetTotalRamBytes,
				reserveFraction,
				suitabilityPolicy: resolveActiveModelSuitabilityPolicy(),
				gpu: parseGpuEnv(),
				targetDevice,
				targetDeviceIdentifier: await resolveTargetDeviceIdentifier(run, targetDevice),
			});
			console.log(`  load: ${load.reason}${load.unloaded.length ? ` (unloaded ${load.unloaded.join(", ")})` : ""}`);
			if (!load.loaded) {
				results.push({ modelId, loaded: false, verdict: "LOAD-REFUSED" });
				continue;
			}
			// Run via verify-all-models (it sets the isolated HOME + targets the now-sole-resident loaded model), which
			// also maps the verify exit codes → PASS/◑PARTIAL/FAIL in its own SWEEP SUMMARY.
			const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>((resolve) => {
				const child = spawn("npx", ["tsx", "scripts/verify-all-models.mts", harness], {
					env: { ...process.env, NKLEIN_VERIFY_DUMP_ACTIVITIES: "1" },
				});
				let out = "";
				child.stdout?.on("data", (d) => {
					out += d.toString();
					process.stdout.write(d);
				});
				child.stderr?.on("data", (d) => {
					out += d.toString();
				});
				child.on("close", (code) => resolve({ stdout: out, exitCode: code ?? 1 }));
			});
			// verify-all-models exits 0 when any model passed; parse the matrix row for this model's symbol.
			const verdict = /=◑/.test(stdout) ? "PARTIAL" : /=✅/.test(stdout) ? "PASS" : exitCode === 0 ? "PASS" : "FAIL";
			results.push({ modelId, loaded: true, verdict });
			void stdout;
		}
		console.log("\n════════ MODEL-LAB SWEEP SUMMARY ════════");
		for (const r of results) {
			console.log(`  ${r.verdict.padEnd(12)} ${r.modelId}`);
		}
		return;
	}
	console.log("usage: tsx scripts/model-lab.mts ps | roster | check <id> | load <id> [ctx] | unload <id> | get <name>[@quant] | sweep <harness> <id1,id2,…>");
}

main().catch((error) => {
	console.error(`FATAL: ${error instanceof Error ? error.stack : String(error)}`);
	process.exit(2);
});
