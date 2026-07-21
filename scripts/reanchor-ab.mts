/** Live F4.8b fleet A/B: compare a long-context checkpoint with and without the production end re-anchor. */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { loadDotEnv } from "../src/config/load-dotenv.js";
import { resolveDeviceRamBytesFromEnv } from "../src/core/device-load-routing.js";
import { fetchLmsLinkDevices } from "../src/core/lms-link-status.js";
import { planResidencyForModel } from "../src/core/model-residency-planner.js";
import { createDefaultLmsRunner } from "../src/core/lms-ps-json.js";
import {
	buildReanchorAbMessages,
	type ReanchorAbObservation,
	scoreReanchorRecall,
	summarizeReanchorAb,
} from "../src/core/reanchor-quality-ab.js";

loadDotEnv();

const RAW_BASE = (process.env.NKLEIN_VERIFY_BASE_URL ?? "http://127.0.0.1:1234/v1").trim().replace(/\/+$/, "");
const API_BASE = RAW_BASE.endsWith("/v1") ? RAW_BASE : `${RAW_BASE}/v1`;
const CHAT_URL = `${API_BASE}/chat/completions`;
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.NKLEIN_REANCHOR_AB_TIMEOUT_MS ?? "300000"));
const DISTRACTOR_CHARS = Math.max(20_000, Number(process.env.NKLEIN_REANCHOR_AB_DISTRACTOR_CHARS ?? "80000"));
const MAX_COMPLETION_TOKENS = Math.max(300, Number(process.env.NKLEIN_REANCHOR_AB_MAX_TOKENS ?? "1200"));
const lmsRun = createDefaultLmsRunner(10 * 60_000);
const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;

type ArmOrder = "baseline-first" | "anchored-first" | "alternate";

function requestedArmOrder(): ArmOrder {
	const value = (process.env.NKLEIN_REANCHOR_AB_ARM_ORDER ?? "alternate").trim().toLowerCase();
	if (value === "baseline-first" || value === "anchored-first" || value === "alternate") return value;
	throw new Error(
		`NKLEIN_REANCHOR_AB_ARM_ORDER must be baseline-first, anchored-first, or alternate; received ${JSON.stringify(value)}`,
	);
}

const DEFAULT_MODELS = [
	"qwen/qwen3.6-35b-a3b",
	"google/gemma-4-31b-qat",
	"qwopus3.5-9b-coder-mlx@8bit",
	"qwen/qwen2.5-coder-14b",
] as const;

interface RawArmObservation {
	modelId: string;
	arm: "baseline" | "anchored";
	latencyMs: number;
	promptTokens: number | null;
	completionTokens: number | null;
	finishReason: string | null;
	response: string;
	reasoning: string;
	score: ReturnType<typeof scoreReanchorRecall>;
}

interface FailedObservation {
	modelId: string;
	arm: RawArmObservation["arm"] | "load";
	error: string;
}

function requestedModels(): string[] {
	const requested = (process.env.NKLEIN_REANCHOR_AB_MODELS ?? "")
		.split(",")
		.map((model) => model.trim())
		.filter(Boolean);
	return requested.length > 0 ? requested : [...DEFAULT_MODELS];
}

interface CatalogModel {
	modelKey: string;
	indexedModelIdentifier?: string;
	selectedVariant?: string;
	deviceIdentifier: string | null;
	sizeBytes: number;
	maxContextLength?: number;
}

interface ResidentModel {
	type: string;
	modelKey: string;
	identifier: string;
	deviceIdentifier: string | null;
	sizeBytes: number;
	lastUsedTime?: number | null;
	status?: string | null;
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
		throw new Error("Unable to parse local memory pressure; refusing a model load without headroom evidence.");
	}
	return { freePercent, swapUsedMiB };
}

async function estimateLoadedBytes(modelId: string, fallbackBytes: number): Promise<number> {
	const estimate = await lmsRun([
		"load",
		modelId,
		"--context-length",
		"32768",
		"--parallel",
		"1",
		"--gpu",
		"max",
		"--estimate-only",
	]);
	const gib = /Estimated Total Memory:\s*([\d.]+)\s*GiB/i.exec(estimate.stdout)?.[1];
	return gib ? Number(gib) * GIB : fallbackBytes * 1.5;
}

async function loadModel(modelId: string): Promise<string> {
	const catalogResult = await lmsRun(["ls", "--llm", "--json"]);
	if (catalogResult.exitCode !== 0) throw new Error("Unable to read the LM Studio model catalog.");
	const catalog = JSON.parse(catalogResult.stdout) as CatalogModel[];
	const candidates = catalog.filter(
		(model) =>
			model.modelKey === modelId || model.indexedModelIdentifier === modelId || model.selectedVariant === modelId,
	);
	if (candidates.length === 0) throw new Error(`Model ${modelId} is not present in the connected LM Studio catalog.`);

	const devices = await fetchLmsLinkDevices(lmsRun);
	const requestedDevice = process.env.NKLEIN_REANCHOR_AB_DEVICE?.trim();
	let requestedDeviceId: string | null | undefined;
	if (requestedDevice) {
		requestedDeviceId =
			requestedDevice === "Local" || requestedDevice === devices.deviceName
				? null
				: [...devices.namesByDeviceId].find(
						([id, name]) => id === requestedDevice || name === requestedDevice,
					)?.[0];
		if (requestedDeviceId === undefined) throw new Error(`LM Studio device ${requestedDevice} is not connected.`);
	}
	const preferredDeviceId =
		devices.preferredDeviceIdentifier === devices.deviceIdentifier ? null : devices.preferredDeviceIdentifier;
	const selectedDeviceId = requestedDevice ? requestedDeviceId : preferredDeviceId;
	const target =
		candidates.find((model) => model.deviceIdentifier === selectedDeviceId) ?? candidates[0];
	const targetDevice =
		target.deviceIdentifier === null
			? "Local"
			: (devices.namesByDeviceId.get(target.deviceIdentifier) ?? target.deviceIdentifier);
	if (requestedDevice && requestedDeviceId !== target.deviceIdentifier) {
		throw new Error(`Model ${modelId} is not installed on requested device ${requestedDevice}.`);
	}

	const ramByDevice = resolveDeviceRamBytesFromEnv(process.env);
	const totalRamBytes =
		target.deviceIdentifier === null
			? totalmem()
			: (ramByDevice[targetDevice] ?? ramByDevice[devices.namesByDeviceId.get(target.deviceIdentifier) ?? ""]);
	if (!totalRamBytes) {
		throw new Error(`No RAM budget is configured for LM Studio device ${targetDevice}; refusing an unbounded load.`);
	}

	const psResult = await lmsRun(["ps", "--json"]);
	if (psResult.exitCode !== 0) throw new Error("Unable to read LM Studio residency before a guarded load.");
	const residents = (JSON.parse(psResult.stdout) as ResidentModel[]).filter((model) => model.type === "llm");
	if (residents.some((model) => model.identifier === modelId)) return targetDevice;
	const sameHost = residents.filter((model) => model.deviceIdentifier === target.deviceIdentifier);
	const pressureBefore = target.deviceIdentifier === null ? await readLocalMemoryPressure() : null;
	if (pressureBefore && pressureBefore.freePercent < 35) {
		throw new Error(
			`Local memory headroom is only ${pressureBefore.freePercent}%; refusing to add ${modelId} while pressure is elevated.`,
		);
	}
	const maxResident = target.deviceIdentifier === null ? 3 : 1;
	const reserveBytes = target.deviceIdentifier === null ? 44 * GIB : Math.max(8 * GIB, totalRamBytes * 0.35);
	const memoryBudgetBytes = totalRamBytes - reserveBytes;
	const candidateBytes = await estimateLoadedBytes(modelId, target.sizeBytes);
	if (candidateBytes > memoryBudgetBytes) {
		throw new Error(
			`${modelId} estimates ${(candidateBytes / GIB).toFixed(1)} GiB on ${targetDevice}, above its ${(memoryBudgetBytes / GIB).toFixed(1)} GiB retained-model budget.`,
		);
	}
	const estimates = new Map<string, number>();
	for (const resident of sameHost) {
		estimates.set(resident.identifier, await estimateLoadedBytes(resident.identifier, resident.sizeBytes));
	}
	const plan = planResidencyForModel({
		neededSizeBytes: candidateBytes,
		resident: sameHost.map((resident) => ({
			key: resident.identifier,
			sizeBytes: estimates.get(resident.identifier) ?? resident.sizeBytes * 1.5,
			lastUsedAt: resident.lastUsedTime ?? 0,
			inUse: resident.status !== undefined && resident.status !== null && resident.status !== "idle",
		})),
		totalBudgetBytes: memoryBudgetBytes,
		reserveFraction: 0,
	});
	if (!plan.fits) throw new Error(`${modelId} cannot enter the retained set on ${targetDevice}: ${plan.reason}`);
	const toUnload = new Set(plan.toUnload);
	const coldIdle = [...sameHost]
		.filter((resident) => resident.status === undefined || resident.status === null || resident.status === "idle")
		.sort((a, b) => (a.lastUsedTime ?? 0) - (b.lastUsedTime ?? 0));
	for (const resident of coldIdle) {
		if (sameHost.length - toUnload.size + 1 <= maxResident) break;
		toUnload.add(resident.identifier);
	}
	if (sameHost.length - toUnload.size + 1 > maxResident) {
		throw new Error(
			`All ${targetDevice} residents are active; refusing to exceed the ${maxResident}-model host cap.`,
		);
	}
	for (const identifier of toUnload) {
		const unload = await lmsRun(["unload", identifier]);
		if (unload.exitCode !== 0) throw new Error(`Failed to unload ${identifier} before loading ${modelId}.`);
	}

	const previousPreferred = devices.preferredDeviceIdentifier;
	const targetPreferred = target.deviceIdentifier ?? devices.deviceIdentifier;
	let preferredChanged = false;
	if (targetPreferred && targetPreferred !== previousPreferred) {
		const preferred = await lmsRun(["link", "set-preferred-device", targetPreferred]);
		if (preferred.exitCode !== 0) throw new Error(`Failed to select LM Studio device ${targetDevice}.`);
		preferredChanged = true;
	}
	try {
		const loaded = await lmsRun([
			"load",
			modelId,
			"--context-length",
			"32768",
			"--parallel",
			"1",
			"--gpu",
			"max",
			"--identifier",
			modelId,
			"--yes",
		]);
		if (loaded.exitCode !== 0) throw new Error(`lms load failed for ${modelId}: ${loaded.stdout.slice(0, 200)}`);
		if (pressureBefore) {
			const pressureAfter = await readLocalMemoryPressure();
			const swapGrowthMiB = pressureAfter.swapUsedMiB - pressureBefore.swapUsedMiB;
			if (pressureAfter.freePercent < 25 || swapGrowthMiB > 256) {
				await lmsRun(["unload", modelId]);
				throw new Error(
					`Loading ${modelId} crossed the local safety margin (free ${pressureAfter.freePercent}%, swap growth ${swapGrowthMiB.toFixed(1)} MiB); the new model was unloaded.`,
				);
			}
			process.stderr.write(
				`[reanchor-ab] local headroom after load: ${pressureAfter.freePercent}% free, swap delta ${swapGrowthMiB.toFixed(1)} MiB\n`,
			);
		}
	} finally {
		if (preferredChanged && previousPreferred) {
			await lmsRun(["link", "set-preferred-device", previousPreferred]);
		}
	}
	return targetDevice;
}

async function runArm(modelId: string, arm: RawArmObservation["arm"]): Promise<RawArmObservation> {
	const startedAt = Date.now();
	const response = await fetch(CHAT_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: modelId,
			messages: buildReanchorAbMessages({ anchored: arm === "anchored", distractorChars: DISTRACTOR_CHARS }),
			temperature: 0,
			max_tokens: MAX_COMPLETION_TOKENS,
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const json = (await response.json()) as {
		choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string } }>;
		usage?: { prompt_tokens?: number; completion_tokens?: number };
		error?: { message?: string };
	};
	if (!response.ok || json.error) {
		throw new Error(`${modelId}/${arm}: ${json.error?.message ?? `HTTP ${response.status}`}`);
	}
	const choice = json.choices?.[0];
	const message = choice?.message;
	const text = message?.content?.trim() ?? "";
	return {
		modelId,
		arm,
		latencyMs: Date.now() - startedAt,
		promptTokens: json.usage?.prompt_tokens ?? null,
		completionTokens: json.usage?.completion_tokens ?? null,
		finishReason: choice?.finish_reason ?? null,
		response: text,
		reasoning: message?.reasoning_content?.trim() ?? "",
		score: scoreReanchorRecall(text),
	};
}

async function main(): Promise<void> {
	const models = requestedModels();
	const armOrder = requestedArmOrder();
	const raw: RawArmObservation[] = [];
	const failures: FailedObservation[] = [];
	const deviceByModel: Record<string, string> = {};
	const outputRoot = process.env.NKLEIN_REANCHOR_AB_OUTPUT_DIR ?? join(process.cwd(), ".real-runs");
	await mkdir(outputRoot, { recursive: true });
	const outputPath = join(outputRoot, `reanchor-ab-${Date.now()}.json`);

	const writeCheckpoint = async (): Promise<void> => {
		const completeModelIds = models.filter(
			(modelId) =>
				raw.filter((row) => row.modelId === modelId).length === 2 &&
				!failures.some((row) => row.modelId === modelId),
		);
		const paired: ReanchorAbObservation[] = completeModelIds.map((modelId) => ({
			modelId,
			baseline:
				raw.find((row) => row.modelId === modelId && row.arm === "baseline")?.score ?? scoreReanchorRecall(""),
			anchored:
				raw.find((row) => row.modelId === modelId && row.arm === "anchored")?.score ?? scoreReanchorRecall(""),
		}));
		const measuredVerdict = summarizeReanchorAb(paired);
		const verdict =
			failures.length === 0 && completeModelIds.length === models.length
				? measuredVerdict
				: { ...measuredVerdict, decision: "inconclusive" as const };
		await writeFile(
			outputPath,
			`${JSON.stringify(
				{
					createdAt: new Date().toISOString(),
					apiBase: API_BASE,
					distractorChars: DISTRACTOR_CHARS,
					maxCompletionTokens: MAX_COMPLETION_TOKENS,
					armOrder,
					residencyMode: "budgeted-retained-chat-models",
					deviceByModel,
					models,
					completeModelIds,
					raw,
					failures,
					verdict,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		return;
	};

	// Keep a budgeted warm set so prompt caches survive repeated pairs. The planner evicts only cold chat models on the
	// target host when its count or estimated-memory ceiling requires it; models on other hosts remain untouched.
	await writeCheckpoint();
	for (const [index, modelId] of models.entries()) {
		try {
			process.stderr.write(`[reanchor-ab] ensuring ${modelId} has guarded 32k/parallel=1 residency\n`);
			deviceByModel[modelId] = await loadModel(modelId);
			// Alternate across a multi-model run, or accept an explicit order so safe one-model invocations can balance
			// separate pairs without reintroducing the host-unsafe requirement to load the full fleet together.
			const baselineFirst = armOrder === "baseline-first" || (armOrder === "alternate" && index % 2 === 0);
			const arms: RawArmObservation["arm"][] = baselineFirst ? ["baseline", "anchored"] : ["anchored", "baseline"];
			for (const arm of arms) {
				process.stderr.write(`[reanchor-ab] ${modelId} ${arm}\n`);
				try {
					const observation = await runArm(modelId, arm);
					raw.push(observation);
					process.stderr.write(
						`[reanchor-ab] ${modelId} ${arm}: score=${observation.score.score.toFixed(2)} prompt=${observation.promptTokens ?? "?"} latency=${observation.latencyMs}ms\n`,
					);
				} catch (error) {
					failures.push({ modelId, arm, error: error instanceof Error ? error.message : String(error) });
				}
				await writeCheckpoint();
				if (failures.some((failure) => failure.modelId === modelId)) break;
			}
		} catch (error) {
			failures.push({ modelId, arm: "load", error: error instanceof Error ? error.message : String(error) });
			await writeCheckpoint();
		} finally {
			// Deliberately retain the model. Later loads evict least-recently-used residents only when count or RAM
			// headroom would cross the host-specific safety budget.
		}
	}
	await writeCheckpoint();
	const result = JSON.parse(await (await import("node:fs/promises")).readFile(outputPath, "utf8")) as {
		verdict: ReturnType<typeof summarizeReanchorAb>;
	};
	console.log(JSON.stringify({ outputPath, models, failures, verdict: result.verdict }, null, 2));
	process.exitCode = result.verdict.decision === "reject" ? 3 : failures.length > 0 ? 2 : 0;
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
