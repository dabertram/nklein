#!/usr/bin/env tsx
/**
 * Model-lab CLI (todo §5.AB / §5.AF — the 2026-06-29 load-handover engine). The thin effectful entrypoint that wires a
 * real `spawn`-backed `lms` runner to the GUARDED orchestration in `src/core/lms-model-runner.ts`. Every load goes
 * through `loadModelExclusive`, so the hard guardrails (explicit target, context floor, headroom-checked, bounded
 * retained set) are always enforced — this script never bypasses them.
 *
 * Subcommands:
 *   model-lab ps                 — list resident models (read-only; safe anytime).
 *   model-lab check <id>         — print the §5.AL capability-catalog verdict for a model id (read-only; no load).
 *   model-lab load <id> [ctx]    — make <id> the sole resident LLM (unloads others, headroom-checked, ctx default 40000).
 *   model-lab admit <id> [ctx]   — safely add/reconcile <id> in a bounded warm retained set on an explicit device.
 *   model-lab roster-load <id>   — load a swarm roster's primary assignments across LM Link machines.
 *   model-lab unload <id>        — unload one model.
 *
 * Usage: tsx scripts/model-lab.mts <subcommand> …
 * Env:   NKLEIN_LMS_BIN (default ~/.lmstudio/bin/lms), NKLEIN_LOAD_RESERVE_FRACTION (default 0.25),
 *        NKLEIN_LOAD_GPU (max|off|auto|0..1 offload ratio — the small-VRAM linked-box lever), NKLEIN_LOAD_DEVICE
 *        (scope the one-at-a-time unload to a single LM Link device, e.g. legion5pro/m4mini), NKLEIN_LOAD_DEVICE_ID
 *        (optional LM Link device identifier; resolved from NKLEIN_LOAD_DEVICE when omitted), NKLEIN_LOAD_TARGET_RAM_GB
 *        (target machine RAM for remote headroom), NKLEIN_LOAD_MAX_RESIDENTS (default local 3 / remote 1),
 *        NKLEIN_LOAD_PINNED_MODELS (space-delimited identifiers that admission must preserve),
 *        NKLEIN_LOAD_FORCE_RELOAD=1 (replace an idle target to clear poisoned backend state),
 *        NKLEIN_ROSTER_MACHINE_MAP (JSON object mapping roster machine ids/classes
 *        to LM Link device names/ids for roster-load, e.g. {"workstation":"Local","desktop":"m4mini"}).
 *
 * Transport (§5.AN): NKLEIN_MODEL_TRANSPORT=rest switches `ps`/`load`/`unload` onto the in-process
 * `/api/v1/models` REST client (`loadModelExclusiveViaRest` — same guardrails, no `lms` spawn;
 * NKLEIN_LMS_REST_URL, default http://localhost:1234). REST is LOCAL-ONLY: it exposes no LM Link device or
 * gpu-offload levers, so `load` under rest REFUSES when NKLEIN_LOAD_DEVICE/NKLEIN_LOAD_GPU are set, and
 * roster-load/sweep/get stay on the CLI regardless.
 */

import { execFile, spawn } from "node:child_process";
import { homedir, totalmem, userInfo } from "node:os";
import { promisify } from "node:util";
import { buildLmsUnloadArgs } from "../src/core/lms-model-control";
import { fetchLmsLinkDevices } from "../src/core/lms-link-status";
import {
	assessModelSuitability,
	buildCatalogRosterRecommendation,
	resolveActiveModelSuitabilityPolicy,
} from "../src/core/model-capability-catalog";
import { createLmStudioRestModelClient } from "../src/core/lmstudio-rest-model-client";
import {
	type LmsRunner,
	listResidentModels,
	loadModelExclusive,
	loadModelExclusiveViaRest,
} from "../src/core/lms-model-runner";
import { planResidencyForModel } from "../src/core/model-residency-planner";
import { assessRosterFit, resolveSwarmRoster } from "../src/core/swarm-roster";
import { parseRosterMachineMapEnv, resolveRosterLoadPlan } from "../src/core/swarm-roster-load-plan";
import { loadUserSwarmConfig, resolveEffectiveBudgets, resolveEffectiveRosters } from "../src/core/swarm-roster-config";

const execFileAsync = promisify(execFile);
const GiB = 1024 ** 3;

/** A real `lms` runner: spawns the CLI with HOME restored to the OS passwd home (so `lms` finds its auth key). */
function createLmsRunner(): LmsRunner {
	const bin = process.env.NKLEIN_LMS_BIN?.trim() || `${homedir()}/.lmstudio/bin/lms`;
	return (args) =>
		new Promise((resolve) => {
			const child = spawn(bin, [...args], { env: { ...process.env, HOME: userInfo().homedir } });
			let stdout = "";
			let settled = false;
			const timeoutMs = args.includes("--estimate-only") ? 120_000 : args[0] === "load" ? 600_000 : 60_000;
			const finish = (exitCode: number) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve({ stdout, exitCode });
			};
			const timer = setTimeout(() => {
				stdout += `\n(lms command timed out after ${timeoutMs} ms)`;
				child.kill("SIGTERM");
				finish(124);
			}, timeoutMs);
			child.stdout?.on("data", (d) => {
				stdout += d.toString();
			});
			child.stderr?.on("data", (d) => {
				stdout += d.toString();
			});
			child.on("error", (e) => {
				stdout += `(lms spawn failed: ${e.message})`;
				finish(127);
			});
			child.on("close", (code) => finish(code ?? 1));
		});
}

/** §5.AN transport pick: "cli" (default — full lever set) or "rest" (in-process /api/v1, local-only). */
function resolveModelTransport(): "cli" | "rest" {
	const raw = process.env.NKLEIN_MODEL_TRANSPORT?.trim().toLowerCase();
	if (raw && raw !== "cli" && raw !== "rest") {
		console.error(`Unknown NKLEIN_MODEL_TRANSPORT "${raw}" — use "cli" or "rest".`);
		process.exit(64);
	}
	return raw === "rest" ? "rest" : "cli";
}

function createRestClient() {
	return createLmStudioRestModelClient({
		baseUrl: process.env.NKLEIN_LMS_REST_URL?.trim() || "http://localhost:1234",
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
	if (!targetDevice) {
		return undefined;
	}
	const devices = await fetchLmsLinkDevices(run);
	if (targetDevice === "Local" || targetDevice === devices.localMachineName) {
		return devices.localDeviceIdentifier ?? undefined;
	}
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

interface CatalogModel {
	modelKey: string;
	indexedModelIdentifier?: string;
	selectedVariant?: string;
	deviceIdentifier: string | null;
	sizeBytes: number;
	maxContextLength?: number;
}

interface JsonResidentModel {
	type: string;
	modelKey: string;
	identifier: string;
	deviceIdentifier: string | null;
	sizeBytes: number;
	lastUsedTime?: number | null;
	status?: string | null;
	contextLength?: number | null;
}

interface LocalMemoryPressure {
	freePercent: number;
	swapUsedMiB: number;
}

async function readLocalMemoryPressure(): Promise<LocalMemoryPressure> {
	const [{ stdout: pressure }, { stdout: swap }] = await Promise.all([
		execFileAsync("memory_pressure", ["-Q"], { timeout: 10_000 }),
		execFileAsync("sysctl", ["-n", "vm.swapusage"], { timeout: 10_000 }),
	]);
	const freePercent = Number(/free percentage:\s*(\d+)%/i.exec(pressure)?.[1]);
	const swapUsedMiB = Number(/used\s*=\s*([\d.]+)M/i.exec(swap)?.[1]);
	if (!Number.isFinite(freePercent) || !Number.isFinite(swapUsedMiB)) {
		throw new Error("Unable to parse local memory pressure; refusing a retained-set load without headroom evidence.");
	}
	return { freePercent, swapUsedMiB };
}

async function estimateLoadedBytes(run: LmsRunner, modelId: string, fallbackBytes: number, contextLength: number): Promise<number> {
	const estimate = await run([
		"load",
		modelId,
		"--context-length",
		String(contextLength),
		"--parallel",
		"1",
		"--gpu",
		String(parseGpuEnv() ?? "max"),
		"--estimate-only",
		"--yes",
	]);
	const gib = /Estimated Total Memory:\s*([\d.]+)\s*GiB/i.exec(estimate.stdout)?.[1];
	if (estimate.exitCode !== 0) {
		throw new Error(`LM Studio could not estimate ${modelId} safely: ${estimate.stdout.slice(-300)}`);
	}
	return gib ? Number(gib) * GiB : conservativeLoadedBytes(fallbackBytes);
}

async function estimateLoadedBytesOnDevice(input: {
	run: LmsRunner;
	modelKey: string;
	fallbackBytes: number;
	contextLength: number;
	targetDeviceIdentifier: string;
	previousPreferredDeviceIdentifier: string | null;
}): Promise<number> {
	const changePreferred = input.previousPreferredDeviceIdentifier !== input.targetDeviceIdentifier;
	if (changePreferred) {
		const selected = await input.run(["link", "set-preferred-device", input.targetDeviceIdentifier]);
		if (selected.exitCode !== 0) {
			throw new Error(`Unable to select LM Studio device for estimation: ${selected.stdout.slice(-300)}`);
		}
	}
	try {
		return await estimateLoadedBytes(input.run, input.modelKey, input.fallbackBytes, input.contextLength);
	} finally {
		if (changePreferred && input.previousPreferredDeviceIdentifier) {
			await input.run(["link", "set-preferred-device", input.previousPreferredDeviceIdentifier]);
		}
	}
}

function conservativeLoadedBytes(weightBytes: number): number {
	// Catalog/ps size is weights only. Cover a 40k KV cache + runtime state without repeatedly asking LM Studio to
	// estimate models that are already resident (some versions prompt or take tens of seconds even with estimate-only).
	// +8 GiB protects small models whose KV/runtime overhead dominates; +25% scales that reserve for larger weights.
	// Live local pressure + swap-delta checks remain the final authority and roll back a newly loaded candidate.
	return Math.max(weightBytes * 1.25, weightBytes + 8 * GiB);
}

async function admitRetainedModel(input: {
	run: LmsRunner;
	modelId: string;
	contextLength: number;
	targetDevice: string | undefined;
	reserveFraction: number;
}): Promise<void> {
	if (!input.targetDevice) {
		throw new Error("model-lab admit requires NKLEIN_LOAD_DEVICE so a linked-host load can never auto-route.");
	}
	const devices = await fetchLmsLinkDevices(input.run);
	const targetDeviceIdentifier = await resolveTargetDeviceIdentifier(input.run, input.targetDevice);
	if (!targetDeviceIdentifier) {
		throw new Error(`LM Studio device ${input.targetDevice} is not connected.`);
	}
	const localTarget = targetDeviceIdentifier === devices.localDeviceIdentifier;
	const targetDeviceLabel = localTarget ? "Local" : (devices.namesByDeviceId.get(targetDeviceIdentifier) ?? input.targetDevice);
	const catalogDeviceIdentifier = localTarget ? null : targetDeviceIdentifier;

	const catalogResult = await input.run(["ls", "--llm", "--json"]);
	if (catalogResult.exitCode !== 0) {
		throw new Error("Unable to read the LM Studio model catalog.");
	}
	const catalog = JSON.parse(catalogResult.stdout) as CatalogModel[];
	const matching = catalog.filter(
		(model) =>
			model.modelKey === input.modelId ||
			model.indexedModelIdentifier === input.modelId ||
			model.selectedVariant === input.modelId,
	);
	const candidate = matching.find((model) => model.deviceIdentifier === catalogDeviceIdentifier);
	if (!candidate) {
		throw new Error(`${input.modelId} is not installed on requested device ${input.targetDevice}.`);
	}
	if ((candidate.maxContextLength ?? 0) < input.contextLength) {
		throw new Error(
			`${input.modelId} advertises ${candidate.maxContextLength ?? "unknown"} context tokens; refusing the ${input.contextLength}-token load.`,
		);
	}

	const psResult = await input.run(["ps", "--json"]);
	if (psResult.exitCode !== 0) {
		throw new Error("Unable to read LM Studio residency before retained-set admission.");
	}
	const residents = (JSON.parse(psResult.stdout) as JsonResidentModel[]).filter((model) => model.type === "llm");
	const sameHost = residents.filter((model) => model.deviceIdentifier === catalogDeviceIdentifier);
	const targetResident = sameHost.find(
		(model) =>
			model.identifier === input.modelId ||
			model.modelKey === input.modelId ||
			model.modelKey === candidate.modelKey ||
			model.identifier === candidate.modelKey,
	);
	const otherResidents = sameHost.filter((model) => model !== targetResident);
	const mustReloadTarget =
		targetResident !== undefined &&
		((targetResident.contextLength ?? 0) < input.contextLength || process.env.NKLEIN_LOAD_FORCE_RELOAD === "1");
	if (
		mustReloadTarget &&
		targetResident.status !== undefined &&
		targetResident.status !== null &&
		targetResident.status !== "idle"
	) {
		throw new Error(
			`${targetResident.identifier} is active at ${targetResident.contextLength ?? "unknown"} context; refusing to interrupt it for a ${input.contextLength}-token reload.`,
		);
	}
	const explicitlyPinned = new Set(
		(process.env.NKLEIN_LOAD_PINNED_MODELS ?? "")
			.split(/\s+/)
			.map((value) => value.trim())
			.filter(Boolean),
	);
	const configuredRemoteRam = parseGbEnv("NKLEIN_LOAD_TARGET_RAM_GB");
	if (!localTarget && configuredRemoteRam === undefined) {
		throw new Error(`NKLEIN_LOAD_TARGET_RAM_GB is required for retained admission on remote device ${targetDeviceLabel}.`);
	}
	const totalRamBytes = localTarget ? totalmem() : (configuredRemoteRam as number);
	const retainedBudgetBytes = localTarget
		? Math.max(0, totalRamBytes - 44 * GiB)
		: Math.max(0, totalRamBytes * (1 - Math.max(0.35, input.reserveFraction)));
	const rawMaxResidents = process.env.NKLEIN_LOAD_MAX_RESIDENTS?.trim() || (localTarget ? "3" : "1");
	const maxResidents = Number(rawMaxResidents);
	if (!Number.isSafeInteger(maxResidents) || maxResidents < 1) {
		throw new Error(`NKLEIN_LOAD_MAX_RESIDENTS must be a positive integer; received ${rawMaxResidents}.`);
	}
	if (localTarget && maxResidents > 3) {
		throw new Error(`The local retained-set safety ceiling is 3 models; received ${maxResidents}.`);
	}
	const pressureBefore = localTarget ? await readLocalMemoryPressure() : null;
	if (pressureBefore && pressureBefore.freePercent < 35) {
		throw new Error(
			`Local memory headroom is only ${pressureBefore.freePercent}%; refusing to admit ${input.modelId} while pressure is elevated.`,
		);
	}

	const candidateBytes = targetResident
		? conservativeLoadedBytes(candidate.sizeBytes)
		: await estimateLoadedBytesOnDevice({
				run: input.run,
				modelKey: candidate.modelKey,
				fallbackBytes: candidate.sizeBytes,
				contextLength: input.contextLength,
				targetDeviceIdentifier,
				previousPreferredDeviceIdentifier: devices.preferredDeviceIdentifier,
			});
	const residentEstimates = new Map<string, number>();
	for (const resident of otherResidents) {
		residentEstimates.set(resident.identifier, conservativeLoadedBytes(resident.sizeBytes));
	}
	const plan = planResidencyForModel({
		neededSizeBytes: candidateBytes,
		resident: otherResidents.map((resident) => ({
			key: resident.identifier,
			sizeBytes: residentEstimates.get(resident.identifier) ?? resident.sizeBytes * 1.5,
			lastUsedAt: resident.lastUsedTime ?? 0,
			inUse:
				(resident.status !== undefined && resident.status !== null && resident.status !== "idle") ||
				explicitlyPinned.has(resident.identifier) ||
				explicitlyPinned.has(resident.modelKey),
		})),
		totalBudgetBytes: retainedBudgetBytes,
		reserveFraction: 0,
		maxResidents,
	});
	if (!plan.fits) {
		throw new Error(`${input.modelId} cannot enter the retained set on ${targetDeviceLabel}: ${plan.reason}`);
	}
	const toUnload = new Set(plan.toUnload);
	const pinnedIdentifiers = otherResidents
		.filter((resident) => !toUnload.has(resident.identifier))
		.map((resident) => resident.identifier);
	if (mustReloadTarget && targetResident) {
		const unload = await input.run(buildLmsUnloadArgs(targetResident.identifier));
		if (unload.exitCode !== 0) {
			throw new Error(`Unable to unload ${targetResident.identifier} for its required context upgrade: ${unload.stdout}`);
		}
	}
	const result = await loadModelExclusive(input.run, {
		modelId: mustReloadTarget ? candidate.modelKey : (targetResident?.identifier ?? candidate.modelKey),
		totalRamBytes: retainedBudgetBytes,
		candidateSizeBytes: candidateBytes,
		contextLength: input.contextLength,
		maxContextLength: candidate.maxContextLength,
		reserveFraction: 0,
		pinnedIdentifiers,
		suitabilityPolicy: resolveActiveModelSuitabilityPolicy(),
		gpu: parseGpuEnv(),
		targetDevice: targetDeviceLabel,
		targetDeviceIdentifier,
	});
	if (!result.loaded) {
		throw new Error(result.reason);
	}
	if (pressureBefore) {
		const pressureAfter = await readLocalMemoryPressure();
		const swapGrowthMiB = pressureAfter.swapUsedMiB - pressureBefore.swapUsedMiB;
		if (pressureAfter.freePercent < 25 || swapGrowthMiB > 256) {
			await input.run(buildLmsUnloadArgs(result.modelId));
			throw new Error(
				`Loading ${input.modelId} crossed the local safety margin (free ${pressureAfter.freePercent}%, swap growth ${swapGrowthMiB.toFixed(1)} MiB); the new model was unloaded.`,
			);
		}
		console.error(
			`Local headroom after load: ${pressureAfter.freePercent}% free, swap delta ${swapGrowthMiB.toFixed(1)} MiB.`,
		);
	}
	console.log(
		JSON.stringify(
			{ ...result, admission: plan, maxResidents, targetDevice: targetDeviceLabel, contextReloaded: mustReloadTarget },
			null,
			2,
		),
	);
}

async function main(): Promise<void> {
	const [, , subcommand, arg, ctxArg] = process.argv;
	const run = createLmsRunner();
	const reserveFraction = Number.parseFloat(process.env.NKLEIN_LOAD_RESERVE_FRACTION ?? "0.25");
	const targetDevice = process.env.NKLEIN_LOAD_DEVICE?.trim() || undefined;
	const targetTotalRamBytes = parseGbEnv("NKLEIN_LOAD_TARGET_RAM_GB") ?? totalmem();

	const transport = resolveModelTransport();

	if (subcommand === "ps") {
		if (transport === "rest") {
			const listed = await createRestClient().listModels();
			if (!listed.ok) {
				console.error(`REST list failed (${listed.error.type}): ${listed.error.message}`);
				process.exit(1);
			}
			const loaded = listed.value.filter((m) => m.loadedInstanceIds.length > 0);
			console.log(`Resident models via REST (${loaded.length}):`);
			for (const m of loaded) {
				const gib = m.sizeBytes ? `${(m.sizeBytes / 1024 ** 3).toFixed(2)} GiB` : "?";
				console.log(`  ${m.key}  ·  ${gib}  ·  max ctx ${m.maxContextLength ?? "?"}  ·  ${m.loadedInstanceIds.length} instance(s)`);
			}
			return;
		}
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
		if (transport === "rest") {
			// The REST surface has no LM Link device / gpu-offload levers — refuse rather than silently ignore them.
			if (targetDevice !== undefined || parseGpuEnv() !== undefined) {
				console.error(
					"REST transport is local-only (no device/gpu levers): unset NKLEIN_LOAD_DEVICE / NKLEIN_LOAD_GPU or use NKLEIN_MODEL_TRANSPORT=cli.",
				);
				process.exit(64);
			}
			const result = await loadModelExclusiveViaRest(createRestClient(), {
				modelId: arg,
				totalRamBytes: targetTotalRamBytes,
				contextLength: ctxArg ? Number.parseInt(ctxArg, 10) : 40_000,
				reserveFraction,
				suitabilityPolicy: resolveActiveModelSuitabilityPolicy(),
			});
			console.log(JSON.stringify(result, null, 2));
			process.exit(result.loaded ? 0 : 1);
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
	if (subcommand === "admit") {
		if (!arg) {
			console.error("usage: model-lab admit <id> [contextLength]");
			process.exit(64);
		}
		if (transport !== "cli") {
			console.error("model-lab admit requires CLI transport for linked-host and memory-estimate safeguards.");
			process.exit(64);
		}
		const contextLength = ctxArg ? Number.parseInt(ctxArg, 10) : 40_000;
		if (!Number.isFinite(contextLength) || contextLength < 32_000) {
			console.error(`Invalid context length ${ctxArg ?? contextLength}; retained models require at least 32000.`);
			process.exit(64);
		}
		await admitRetainedModel({ run, modelId: arg, contextLength, targetDevice, reserveFraction });
		return;
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
	if (subcommand === "roster-load") {
		if (!arg) {
			console.error("usage: model-lab roster-load <rosterId> [contextLength]");
			process.exit(64);
		}
		const userConfig = await loadUserSwarmConfig();
		const rosters = resolveEffectiveRosters(userConfig);
		const budgets = resolveEffectiveBudgets(userConfig);
		const roster = resolveSwarmRoster(arg, rosters);
		if (!roster) {
			console.error(`Unknown roster "${arg}". Available: ${rosters.map((r) => r.id).join(", ") || "(none)"}`);
			process.exit(64);
		}
		const contextLength = ctxArg ? Number.parseInt(ctxArg, 10) : 40_000;
		if (!Number.isFinite(contextLength) || contextLength <= 0) {
			console.error(`Invalid context length: ${ctxArg}`);
			process.exit(64);
		}
		const fit = assessRosterFit(roster, budgets);
		if (!fit.fits) {
			for (const machine of fit.machines.filter((m) => !m.fits)) {
				console.error(
					`Roster "${roster.id}" overcommits ${machine.machine}: ${machine.usedGb.toFixed(1)}/${machine.budgetGb} GB before reserve.`,
				);
			}
			process.exit(1);
		}
		const mapParse = parseRosterMachineMapEnv(process.env.NKLEIN_ROSTER_MACHINE_MAP);
		if (mapParse.issues.length > 0) {
			for (const issue of mapParse.issues) {
				console.error(issue);
			}
			process.exit(64);
		}
		const plan = resolveRosterLoadPlan({
			roster,
			budgetsGb: budgets,
			linkDevices: await fetchLmsLinkDevices(run),
			machineMap: mapParse.machineMap,
		});
		if (!plan.ok) {
			for (const issue of plan.issues) {
				console.error(issue);
			}
			console.error(
				"For built-in example rosters, set NKLEIN_ROSTER_MACHINE_MAP to map workstation/desktop/laptop to LM Link device names or ids.",
			);
			process.exit(1);
		}

		for (const target of plan.targets) {
			console.log(
				`\n──────── roster ${roster.id} · ${target.machine} → ${target.targetDevice} · ${target.assignment.model} ────────`,
			);
			const result = await loadModelExclusive(run, {
				modelId: target.assignment.model,
				totalRamBytes: target.totalRamBytes,
				candidateSizeBytes: target.candidateSizeBytes,
				contextLength,
				reserveFraction,
				suitabilityPolicy: resolveActiveModelSuitabilityPolicy(),
				gpu: parseGpuEnv(),
				targetDevice: target.targetDevice,
				targetDeviceIdentifier: target.targetDeviceIdentifier,
			});
			console.log(JSON.stringify(result, null, 2));
			if (!result.loaded) {
				console.error(`Roster load stopped at ${target.assignment.model}: ${result.reason}`);
				process.exit(1);
			}
		}

		const residents = await listResidentModels(run);
		const missing = plan.targets.filter(
			(target) =>
				!residents.some(
					(model) => model.identifier === target.assignment.model && model.device === target.targetDevice,
				),
		);
		if (missing.length > 0) {
			for (const target of missing) {
				console.error(`Loaded model not observed resident on ${target.targetDevice}: ${target.assignment.model}`);
			}
			process.exit(1);
		}
		console.log("\n════════ ROSTER READY ════════");
		for (const target of plan.targets) {
			console.log(`  ${target.targetDevice.padEnd(12)} ${target.assignment.role.padEnd(9)} ${target.assignment.model}`);
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
		if (transport === "rest") {
			const client = createRestClient();
			const listed = await client.listModels();
			if (!listed.ok) {
				console.error(`unload ${arg}: REST list failed (${listed.error.type}): ${listed.error.message}`);
				process.exit(1);
			}
			const instanceIds = listed.value.find((m) => m.key === arg)?.loadedInstanceIds ?? [];
			if (instanceIds.length === 0) {
				console.log(`unload ${arg}: not loaded (noop)`);
				return;
			}
			for (const instanceId of instanceIds) {
				const result = await client.unloadModel({ instanceId });
				if (!result.ok) {
					console.error(`unload ${arg}: failed (${result.error.type}): ${result.error.message}`);
					process.exit(1);
				}
			}
			console.log(`unload ${arg}: done (${instanceIds.length} instance${instanceIds.length === 1 ? "" : "s"} via REST)`);
			return;
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
	console.log(
		"usage: tsx scripts/model-lab.mts ps | roster | roster-load <rosterId> [ctx] | check <id> | load <id> [ctx] | admit <id> [ctx] | unload <id> | get <name>[@quant] | sweep <harness> <id1,id2,…>",
	);
}

main().catch((error) => {
	console.error(`FATAL: ${error instanceof Error ? error.stack : String(error)}`);
	process.exit(2);
});
