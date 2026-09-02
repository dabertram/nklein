/**
 * The REAL-MODEL drain harness the P23.5 / N8 / P25.3 legs share: seed ONE card into a prepared workspace via
 * the A2A ingress (the proven external-trigger path — same call the soak harness makes), let the swarm work it
 * with the operator's ACTUALLY-LOADED model, and report the terminal lane plus where the workspace landed.
 *
 *   tsx scripts/real-model-drain.mts --workspace <dir> --prompt-file <f> [--out <dir>] [--max-min N]
 *
 * Deliberately NOT a simulator: the point of these legs is evidence from a real model. It therefore refuses to
 * invent a model — the roster comes from what is loaded RIGHT NOW (`/api/v0/models`), and an empty roster is a
 * refusal rather than a fallback, because a drain against a model nobody loaded proves nothing about the fleet.
 *
 * Never unloads or loads anything (directive: the resident set is the operator's). Tears down its runtime.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const TSX = join(REPO, "node_modules", ".bin", "tsx");

function arg(name: string): string | null {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const workspaceSource = arg("workspace");
const promptFile = arg("prompt-file");
const maxMinutes = Number(arg("max-min") ?? "90");
const outDir = arg("out");
if (!workspaceSource || !promptFile) {
	process.stderr.write("usage: real-model-drain.mts --workspace <dir> --prompt-file <f> [--out <dir>] [--max-min N]\n");
	process.exit(64);
}

const LOCAL_BASE = process.env.NKLEIN_LOCAL_BASE_URL?.trim() || "http://127.0.0.1:8080/v1";
const RUNTIME_PORT = Number(process.env.NKLEIN_DRAIN_PORT ?? "3502");

/**
 * FLASH-NEXT VARIANT: the model is served by a standalone llama.cpp (PR #27742, qwen4exp arch) at :8080, NOT LM
 * Studio — so there is no `/api/v0/models` loaded-roster to query. The served model id is fixed (the GGUF path
 * llama-server reports); llama-server serves its single loaded model regardless of the request `model` field, so
 * this id is used only for !Klein's own config/logging/context keying. A liveness check on /v1/models replaces the
 * roster refusal: an unreachable endpoint refuses rather than driving against a dead server.
 */
async function loadedModelIds(): Promise<string[]> {
	const root = LOCAL_BASE.replace(/\/+$/u, "").replace(/\/v1$/u, "");
	const id = process.env.NKLEIN_FLASHNEXT_MODEL_ID?.trim()
		|| "/Users/david/.lmstudio/models/unsloth/Qwen3.8-Flash-Next-GGUF/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf";
	await fetch(`${root}/v1/models`, { signal: AbortSignal.timeout(5_000) }); // liveness — throws if the server is down
	return [id];
}

const work = await realpath(await mkdtemp(join(tmpdir(), "real-drain-")));
// PERSISTENT-HOME accumulation (Flash-Next campaign): `--home <dir>` reuses ONE home across cards so mechanism
// telemetry ($HOME/.nklein/nklein/telemetry) ACCUMULATES toward the evidence floors, instead of a per-run temp
// home that scatters each card's evidence. The workspace stays per-run temp (fresh board per card).
const persistentHome = arg("home");
const home = persistentHome ? resolvePath(persistentHome) : join(work, "home");
/**
 * The drain workspace ALWAYS lives outside !Klein's own checkout.
 *
 * `projects.add` refuses a path inside this repo — "this is !Klein's own source repository … needs
 * confirmation" (§5.W self-project guard). A workspace under `.real-runs/` is inside the repo, so registration
 * failed, the runtime had NO workspace, and every seeded card went nowhere while the harness polled a board
 * path that happened to exist locally (2026-08-08). The guard is right; the harness was wrong to fight it, and
 * passing confirmSelfProject to silence it would trade a real safety property for convenience.
 *
 * `--out` therefore means "copy the drained tree HERE when finished", not "work in place".
 */
const workspace = join(work, "ws");
const keepAt = outDir ? resolvePath(outDir) : null;
await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
// `cp -R a b` NESTS a inside b when b already exists — a stale destination from a previous run silently
// produced a wrong tree that then got graded (live-found 2026-08-08). Always start from a clean destination.
await rm(workspace, { recursive: true, force: true });
await execFileAsync("cp", ["-R", workspaceSource, workspace]).catch(async () => {
	await mkdir(workspace, { recursive: true });
});
const git = (...args: string[]) => execFileAsync("git", ["-C", workspace, ...args]);
await git("rev-parse", "--git-dir").catch(async () => {
	await git("init", "--quiet", "--initial-branch=main");
	await git("add", "-A");
	await git("-c", "user.email=drain@local", "-c", "user.name=drain", "commit", "-qm", "init");
});

const loaded = await loadedModelIds().catch(() => []);
if (loaded.length === 0) {
	process.stderr.write(
		`REFUSED: no model is loaded at ${LOCAL_BASE}. This harness never loads models (the resident set is the operator's) and a drain against an unloaded model proves nothing.\n`,
	);
	process.exit(1);
}
const model = loaded[0] as string;
process.stdout.write(`real-model drain: model=${model} workspace=${workspace}\n`);

await writeFile(
	join(home, ".nklein", "nklein", "config.json"),
	JSON.stringify(
		{
			selectedAgentId: "nklein",
			developerModeEnabled: true,
			setupWizardCompletedAt: Date.now(),
			agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "fully_open" } },
			// Test-driven mode (default-ON in product) bounces any change that touches no test file. A FIX-THE-BUG bed
			// (tests pre-exist, correct fix touches only source) can never satisfy it and loops to timeout — so the
			// harness can disable it (NKLEIN_FLASHNEXT_TEST_DRIVEN=0) to let a correct source-only fix DELIVER, turning
			// tool observations into EVALUABLE ones. Greenfield beds keep it on (Flash-Next writes tests, gate satisfied).
			testDrivenModeEnabled: (process.env.NKLEIN_FLASHNEXT_TEST_DRIVEN ?? "1") !== "0",
			// FLEET ROLES (2026-09-02): the tee proxy routes by model id (flash-next -> llama.cpp:8080, all
			// other ids -> the LM Studio gateway:1234, which executes device-scoped models on legion5pro/m4mini),
			// so per-role model ids ARE the whole multi-host wiring. Unset = single-model (byte-identical).
			modelRoles: {
				// PINNED, not auto (live 2026-09-02): auto mode only ADDS the role model to the candidate pool and
				// the capability-ranked selector kept picking flash-next for every role — the whole fleet idled
				// while one endpoint serialized the board. Role envs are hard assignments.
				architect: {
					modelId: process.env.NKLEIN_ROLE_ARCHITECT_MODEL?.trim() || model,
					providerId: "lmstudio",
					// Pin only when the operator SET the role env: an unconditional pin hard-fails the start when
					// the pinned endpoint looks momentarily busy (live 2026-09-02: "honoring the configured pin.
					// Selected best free efficient fit ornith…" -> pinned_model_unavailable at seed settle).
					...(process.env.NKLEIN_ROLE_ARCHITECT_MODEL?.trim() ? { modelSelectionMode: "pinned" } : {}),
				},
				worker: {
					modelId: process.env.NKLEIN_ROLE_WORKER_MODEL?.trim() || model,
					providerId: "lmstudio",
					// Workers default UNPINNED (2026-09-02 dual-lane): a pin hard-assigns every card to the
					// primary and additionalModels never engage — legion's 27B idled while cards queued behind
					// the busy mini. Unpinned, free-first selection spreads across the role's own pool (and
					// ONLY the pool — flash-next stays the architect). NKLEIN_ROLE_WORKER_PIN=1 restores the pin.
					...(process.env.NKLEIN_ROLE_WORKER_PIN === "1" && process.env.NKLEIN_ROLE_WORKER_MODEL?.trim()
						? { modelSelectionMode: "pinned" }
						: {}),
					...(process.env.NKLEIN_ROLE_WORKER_EXTRA_MODEL?.trim()
						? { additionalModels: [{ modelId: process.env.NKLEIN_ROLE_WORKER_EXTRA_MODEL.trim(), providerId: "lmstudio" }] }
						: {}),
				},
				reviewer: {
					modelId: process.env.NKLEIN_ROLE_REVIEWER_MODEL?.trim() || model,
					providerId: "lmstudio",
					...(process.env.NKLEIN_ROLE_REVIEWER_MODEL?.trim() ? { modelSelectionMode: "pinned" } : {}),
				},
			},
		},
		null,
		1,
	),
);
await writeFile(
	join(home, ".nklein", "nklein", "nklein-provider-selection.json"),
	`${JSON.stringify({ providerId: "lmstudio" }, null, 2)}\n`,
);
await writeFile(
	join(home, ".nklein", "data", "settings", "providers.json"),
	JSON.stringify(
		{
			version: 1,
			lastUsedProvider: "lmstudio",
			providers: {
				lmstudio: {
					settings: { provider: "lmstudio", model, baseUrl: LOCAL_BASE },
					updatedAt: new Date().toISOString(),
					tokenSource: "manual",
				},
			},
		},
		null,
		1,
	),
);

// Pre-seed the model registry BEFORE the runtime boots: (a) the context-window override (the auto-start floor
// gate reads it on the very first attempt) and (b) an HONEST capability score — a fresh entry's flat static
// prior 35 trips the decomposition candidate guard on difficulty~48 cards ("No connected model satisfies both
// difficulty 48 and the candidate-specific context fit guard" → 5 failures → paused; the capability-prior
// deadlock, live-hit 2026-08-29). Flash-Next is a 125B frontier-class MoE; NKLEIN_FLASHNEXT_CAPABILITY (default
// 85) sets externalScore/effectiveScore so routing admits it. File shape mirrors nklein-model-registry.ts.
{
	const ctxTokens = Number(process.env.NKLEIN_FLASHNEXT_CTX ?? "32768");
	const capScore = Number(process.env.NKLEIN_FLASHNEXT_CAPABILITY ?? "85");
	const modelForRegistry = process.env.NKLEIN_FLASHNEXT_MODEL_ID?.trim()
		|| "/Users/david/.lmstudio/models/unsloth/Qwen3.8-Flash-Next-GGUF/Qwen3.8-Flash-Next-UD-Q3_K_XL-00001-of-00003.gguf";
	const endpointForRegistry = LOCAL_BASE.replace("127.0.0.1", "localhost");
	const registryKey = `lmstudio:${modelForRegistry}:${endpointForRegistry}`;
	// FLEET PRE-SEEDS (2026-09-02): the same capability-prior deadlock that froze flash-next froze the fleet —
	// dirk/ornith at the flat prior 35 fail difficulty~47 feasibility, get dropped BEFORE the pin check, and the
	// pin path hard-refuses ("honoring the configured pin" then best-free-fit). Every role model an env names
	// gets an honest prior + ctx so routing admits it.
	const registryEntry = (modelId: string, cap: number, ctx: number) => ({
		key: `lmstudio:${modelId}:${endpointForRegistry}`,
		providerId: "lmstudio",
		modelId,
		endpoint: endpointForRegistry,
		contextWindow: { advertised: null, observed: null, userOverride: ctx, effective: ctx },
		speed: { samples: 0, promptTokensEwma: null, outputTokensEwma: null, totalTokensEwma: null, prefillTokensPerSecondEwma: null, decodeTokensPerSecondEwma: null, ttftMsEwma: null, wallTimeMsEwma: null, wallTimeMsPer1kPromptTokensEwma: null, lastPromptTokens: null, lastOutputTokens: null, lastWallTimeMs: null, lastObservedAt: null },
		capability: { samples: 0, staticPrior: cap, evalScore: null, externalScore: cap, observedPassRate: null, effectiveScore: cap, lastObservedAt: null },
		constraints: { maxConcurrentRequests: null },
	});
	const fleetModels: Record<string, ReturnType<typeof registryEntry>> = {
		[registryKey]: registryEntry(modelForRegistry, capScore, ctxTokens),
	};
	for (const [envModel, envCap, envCtx, defCap] of [
		[process.env.NKLEIN_ROLE_WORKER_MODEL, process.env.NKLEIN_ROLE_WORKER_CAPABILITY, process.env.NKLEIN_ROLE_WORKER_CTX, "75"],
		[process.env.NKLEIN_ROLE_WORKER_EXTRA_MODEL, process.env.NKLEIN_ROLE_EXTRA_CAPABILITY, process.env.NKLEIN_ROLE_EXTRA_CTX, "60"],
		[process.env.NKLEIN_ROLE_REVIEWER_MODEL, process.env.NKLEIN_ROLE_REVIEWER_CAPABILITY, process.env.NKLEIN_ROLE_REVIEWER_CTX, "60"],
	] as const) {
		const id = envModel?.trim();
		if (id && !fleetModels[`lmstudio:${id}:${endpointForRegistry}`]) {
			fleetModels[`lmstudio:${id}:${endpointForRegistry}`] = registryEntry(
				id,
				Number(envCap ?? defCap),
				Number(envCtx ?? "16384"),
			);
		}
	}
	await writeFile(
		join(home, ".nklein", "nklein", "model-registry.json"),
		`${JSON.stringify({ schemaVersion: 1, updatedAt: Date.now(), models: fleetModels }, null, 1)}\n`,
	);
	process.stdout.write(`model registry pre-seeded: ctx=${ctxTokens} capability=${capScore}\n`);
}

let runtime: ChildProcess | null = null;
const shutdown = async (): Promise<void> => {
	runtime?.kill("SIGTERM");
	await new Promise((tick) => setTimeout(tick, 5_000));
	if (runtime && runtime.exitCode === null) {
		runtime.kill("SIGKILL");
	}
};

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await fetch(url, { signal: AbortSignal.timeout(2_000) });
			return;
		} catch {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
			await new Promise((tick) => setTimeout(tick, 1_000));
		}
	}
}

try {
	const logPath = join(work, "runtime.log");
	const { createWriteStream } = await import("node:fs");
	const runtimeLog = createWriteStream(logPath);
	// `--no-open`: without it every drain leg pops a browser tab on the operator's machine — seven of them in one
	// day before anyone noticed, because the drain itself works fine either way.
	runtime = spawn(TSX, ["src/cli.ts", "--host", "127.0.0.1", "--port", String(RUNTIME_PORT), "--no-open"], {
		cwd: REPO,
		env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_A2A_SERVER: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	runtime.stdout?.pipe(runtimeLog);
	runtime.stderr?.pipe(runtimeLog);
	await waitForHttp(`http://127.0.0.1:${RUNTIME_PORT}/`, 90_000);

	// N15 local-only assertion — DEFAULT ON for this rig (NKLEIN_EGRESS_AUDIT=0 disables). Every 30s, append the
	// runtime pid TREE's ESTABLISHED TCP rows to a samples file; after the drain, `dev connection-audit` judges
	// them (loopback-only passes; an EMPTY sample set FAILS, so a sampler that never ran cannot read as clean).
	// Ported from real-model-run.sh, where it was opt-in — a rig that measures the privacy invariant by default
	// is how "default-ON once quiet" starts.
	// Samples live in `work` (which EXISTS) — `--out` is created only at copy-time, per this file's own header.
	// The first version pointed there and the first sample's ENOENT, unhandled inside the interval's async void,
	// killed the entire drain 30s in: the observation broke the run, the exact failure it must never cause.
	const egressSamplesPath = join(work, "egress-audit.samples");
	const egressAuditEnabled = process.env.NKLEIN_EGRESS_AUDIT !== "0";
	const pidTree = async (root: number): Promise<string[]> => {
		const pids = [String(root)];
		for (let i = 0; i < pids.length && i < 64; i += 1) {
			const { stdout } = await execFileAsync("pgrep", ["-P", pids[i]]).catch(() => ({ stdout: "" }));
			for (const child of stdout.split("\n")) if (/^\d+$/.test(child.trim())) pids.push(child.trim());
		}
		return pids;
	};
	const egressTimer = egressAuditEnabled
		? setInterval(() => {
				void (async () => {
					const pids = runtime?.pid ? await pidTree(runtime.pid) : [];
					if (pids.length === 0) return;
					const { stdout } = await execFileAsync("lsof", ["-a", "-p", pids.join(","), "-nP", "-iTCP", "-sTCP:ESTABLISHED"]).catch(() => ({ stdout: "" }));
					if (stdout.trim()) await appendFile(egressSamplesPath, stdout);
				})().catch(() => undefined);
			}, 30_000)
		: null;
	egressTimer?.unref();

	await execFileAsync(TSX, ["-e", "void 0"]).catch(() => undefined); // no-op keeps tsx warm
	const register = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/projects.add?batch=1`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ "0": { path: workspace } }),
	});
	// The BODY, not just the status: tRPC answers 200 with an error payload, so a status-only check reports
	// success for a registration that did not happen — precisely how the runtime ended up workspace-less.
	const registerBody = await register.text();
	process.stdout.write(`workspace registration: HTTP ${register.status} ${registerBody.slice(0, 200)}\n`);
	if (!register.ok || registerBody.includes('"error"')) {
		throw new Error(`workspace registration failed for ${workspace}: ${registerBody.slice(0, 300)}`);
	}

	// FLASH-NEXT CONTEXT-FLOOR CLEAR: llama.cpp's OpenAI surface does not report a context window the way the
	// lmstudio provider's discovery expects, so the auto-start gate refuses the model as context_floor_unmet. The
	// model IS served at 32768 (`-c 32768`), so register that as a user override BEFORE the card is seeded — the
	// first start attempt then resolves 32768 and never trips the 5-failure auto-pause. `isLocalProvider("lmstudio")`
	// is true, so the override is permitted; the merge keys by providerId+modelId (endpoint-agnostic).
	const overrideRes = await fetch(
		`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/runtime.saveNKleinModelContextWindowOverride?workspaceId=ws`,
		{
			method: "POST",
			headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
			body: JSON.stringify({ providerId: "lmstudio", modelId: model, endpoint: LOCAL_BASE, contextWindow: Number(process.env.NKLEIN_FLASHNEXT_CTX ?? "32768") }),
		},
	);
	const overrideBody = await overrideRes.text();
	if (!overrideRes.ok || overrideBody.includes('"error"')) {
		throw new Error(`context-window override failed (HTTP ${overrideRes.status}): ${overrideBody.slice(0, 300)}`);
	}
	process.stdout.write(`context-window override set: effective=${process.env.NKLEIN_FLASHNEXT_CTX ?? "32768"} for ${model.slice(-40)}\n`);

	const prompt = await readFile(promptFile, "utf8");
	const seeded = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/a2a/v1`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: "real-drain-1",
			method: "SendMessage",
			params: { message: { messageId: "real-drain-m-1", role: "ROLE_USER", parts: [{ text: prompt }] } },
		}),
	});
	// JSON-RPC answers 200 WITH an error body — a status-only check reports a seed that never happened (the
	// same trap as projects.add above; both were hiding a rig failure behind a green HTTP code).
	const seededBody = await seeded.text();
	if (!seeded.ok || seededBody.includes('"error"')) {
		throw new Error(`A2A SendMessage failed (HTTP ${seeded.status}): ${seededBody.slice(0, 400)}`);
	}
	process.stdout.write(`card seeded: ${seededBody.slice(0, 200)}\n draining for up to ${maxMinutes}m…\n`);

	// PLAN-MODE START (dschinn 2026-08-29): the A2A ingress creates ACT work cards only — the decompose tools
	// (add_task/decompose_project) live in ARCHITECT sessions. With NKLEIN_FLASHNEXT_PLAN=1, stop whatever the
	// auto-start began and restart the SAME card explicitly with startInPlanMode:true. This replaces the
	// dev-test-project supervisor path, whose board-growth productivity heuristic cannot see plan-artifact
	// staging (6 staged add_task = "unproductive") and stopped a productive architect mid-decompose.
	if ((process.env.NKLEIN_FLASHNEXT_PLAN ?? "0") === "1") {
		const seededTaskId = (JSON.parse(seededBody) as { result?: { task?: { id?: string } } }).result?.task?.id;
		if (!seededTaskId) {
			throw new Error("NKLEIN_FLASHNEXT_PLAN=1 but the A2A seed response carried no task id");
		}
		// Make the CARD itself a plan card (2026-08-29 root-cause): the A2A seed hardcodes a WORK card
		// (startInPlanMode:false, autoReviewEnabled:true), and only the SESSION was started in plan mode — so
		// every card-level guard misclassified the architect as a worker: delivery admission captured its
		// sandbox, acceptance ran "npm test" against a plan, auto-review raced the architect ~2min in and the
		// single-flight bracket ended the main session (six identical deaths: agent_end → heartbeat lost).
		// Flip the persisted card to plan mode BEFORE starting; the plan-mode guards then exclude it from the
		// worker-only machinery, exactly as a dev-test plan seed is treated.
		// PAUSE FIRST (2026-08-30 v3, stack-proven): with the card flipped to plan mode, the ingress
		// auto-start spawned the ARCHITECT during the post-stop settle window — and the later pause then
		// parked+aborted that healthy architect ([stop-stack] handlePauseTask -> parkTaskForPause ->
		// runtime.abortTaskSession resolving the architect's own session), leaving a token-less zombie the
		// verify loop mistook for a live architect (stale running/architect summary). Pausing BEFORE the flip
		// and stop disarms ALL auto-start machinery up front: the pause parks (and scope-aborts) only the
		// SEED, and the explicit plan-mode start below owns the card uncontested.
		const pauseRes = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/runtime.pauseTask?workspaceId=ws`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
			body: JSON.stringify({ taskId: seededTaskId }),
		});
		const pauseBody = await pauseRes.text();
		if (!pauseRes.ok || pauseBody.includes('"error"')) {
			throw new Error(`pauseTask failed (HTTP ${pauseRes.status}): ${pauseBody.slice(0, 300)}`);
		}
		process.stdout.write(`card paused FIRST (auto-start disarmed before any settle window): ${seededTaskId}\n`);
		const stateRes = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/workspace.getState?workspaceId=ws`, {
			headers: { "x-nklein-workspace-id": "ws" },
		});
		const stateBody = (await stateRes.json()) as {
			result?: { data?: { board?: { columns?: { cards?: { id: string; startInPlanMode?: boolean }[] }[] } } };
		};
		const stateData = stateBody.result?.data;
		const seededCardRef = stateData?.board?.columns
			?.flatMap((column) => column.cards ?? [])
			.find((card) => card.id === seededTaskId);
		if (!seededCardRef || !stateData?.board) {
			throw new Error(`plan-mode card flip: seeded card ${seededTaskId} not found in workspace state`);
		}
		seededCardRef.startInPlanMode = true;
		const saveRes = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/workspace.saveState?workspaceId=ws`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
			body: JSON.stringify(stateData),
		});
		const saveBody = await saveRes.text();
		if (!saveRes.ok || saveBody.includes('"error"')) {
			throw new Error(`plan-mode card flip failed (HTTP ${saveRes.status}): ${saveBody.slice(0, 300)}`);
		}
		process.stdout.write(`card flipped to plan mode: ${seededTaskId}\n`);
		// ONE stop, then a FLAT settle wait (2026-08-30 v2): instrumentation showed BOTH captured stops were the
		// drain's own seed-time calls (the previous "settle poll" read a wrong field and never waited), and the
		// ~2-min death is the seed-stop's interrupted-stamp landing AFTER the architect start and poisoning its
		// summary for the terminal-retry sweep. The card is paused (nothing revives), so a flat 20s outlasts any
		// async stamp with zero field-path guesswork; then the start below owns a genuinely settled task.
		await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/runtime.stopTaskSession?workspaceId=ws`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
			body: JSON.stringify({ taskId: seededTaskId }),
		}).catch(() => null);
		process.stdout.write("seed session stopped; settling 20s before the architect start…\n");
		await new Promise((tick) => setTimeout(tick, 20_000));
		// VERIFY-ROLE LOOP (2026-08-30): once the capability/ctx pre-seeds made ingress auto-start succeed
		// instantly, the auto WORKER wins the seed race — the stop above lands mid-spawn and misses, and the
		// explicit start below short-circuits into the live worker session (ok:true, role:"worker", 3-tool
		// manifest — captured verbatim in the request log). Loop stop→start until the summary really says
		// architect; three misses is a genuine error, not a race.
		let planStartBody = "";
		let architectConfirmed = false;
		for (let attempt = 0; attempt < 3 && !architectConfirmed; attempt += 1) {
			if (attempt > 0) {
				await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/runtime.stopTaskSession?workspaceId=ws`, {
					method: "POST",
					headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
					body: JSON.stringify({ taskId: seededTaskId }),
				}).catch(() => null);
				// Same 20s settle as the seed stop (2026-08-30): the 3s retry wait reintroduced the exact
				// late-stamp race the seed settle closed — a retry stop's interrupted-stamp landed after the
				// next start and poisoned the live architect for the ~2-min terminal-retry sweep.
				await new Promise((tick) => setTimeout(tick, 20_000));
			}
			const planStart = await fetch(
				`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/runtime.startTaskSession?workspaceId=ws`,
				{
					method: "POST",
					headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
					body: JSON.stringify({
						taskId: seededTaskId,
						prompt,
						taskTitle: "Dark Factory Dschinn — plan the vertical spine",
						startInPlanMode: true,
						baseRef: "main",
						agentId: "nklein",
					}),
				},
			);
			planStartBody = await planStart.text();
			if (!planStart.ok || planStartBody.includes('"error"')) {
				throw new Error(`plan-mode start failed (HTTP ${planStart.status}): ${planStartBody.slice(0, 1600)}`);
			}
			// Verify via a FRESH read a moment after the start — the start response can carry a stale summary
			// (the prior worker's retained entry), which caused a false non-architect verdict and a needless
			// retry stop (the race reseeder).
			await new Promise((tick) => setTimeout(tick, 3_000));
			const freshStart = await fetch(
				`http://127.0.0.1:${RUNTIME_PORT}/api/trpc/runtime.startTaskSession?workspaceId=ws`,
				{
					method: "POST",
					headers: { "content-type": "application/json", "x-nklein-workspace-id": "ws" },
					body: JSON.stringify({
						taskId: seededTaskId,
						prompt,
						taskTitle: "Dark Factory Dschinn — plan the vertical spine",
						startInPlanMode: true,
						baseRef: "main",
						agentId: "nklein",
					}),
				},
			).then((res) => res.text()).catch(() => "");
			// An already-running architect answers this idempotent re-start with its live summary.
			architectConfirmed =
				freshStart.includes('"role":"architect"') || planStartBody.includes('"role":"architect"');
			if (!architectConfirmed) {
				process.stdout.write(`start attempt ${attempt + 1} landed on a non-architect session — stopping it and retrying\n`);
			}
		}
		if (!architectConfirmed) {
			throw new Error(`plan-mode start never yielded an architect after 3 attempts: ${planStartBody.slice(0, 300)}`);
		}
		process.stdout.write(`plan-mode architect started on ${seededTaskId}: ${planStartBody.slice(0, 160)}\n`);
	}

	const boardPath = join(workspace, ".nklein", "nklein", "workspace", "board.json");
	const deadline = Date.now() + maxMinutes * 60_000;
	// A seeded card must APPEAR on this workspace's board quickly. An HTTP 200 from SendMessage means the
	// request was accepted, NOT that a card is being worked — and a board that stays empty is a broken rig, not
	// a slow model. Burned a 150-minute budget on `lanes: {}` before this existed (2026-08-08); silence is not
	// success, and the harness must say so in minutes rather than hours.
	const boardMustAppearBy = Date.now() + 10 * 60_000;
	let sawAnyCard = false;
	let lastSummary = "";
	// FLASH-NEXT MEMORY KILL-SWITCH: this variant serves a 125B MoE resident on the same 128GB box; when the
	// worker phase spins the Docker sandbox, memory can tighten. macOS tolerates low free RAM (compression / file
	// -cache eviction), so the real OOM danger is sustained SWAP THRASH. Sample vm.swapusage each poll and abort
	// the drain — cleanly — before the machine is endangered. Protecting the operator's box beats finishing a card.
	const SWAP_ABORT_GB = Number(process.env.NKLEIN_FLASHNEXT_SWAP_ABORT_GB ?? "28");
	let swapAborted = false;
	const readSwapUsedGb = async (): Promise<number> => {
		const { stdout } = await execFileAsync("sysctl", ["-n", "vm.swapusage"]).catch(() => ({ stdout: "" }));
		const m = /used\s*=\s*([0-9.]+)([MG])/i.exec(stdout);
		if (!m) return 0;
		const v = Number(m[1]);
		return m[2].toUpperCase() === "G" ? v : v / 1024;
	};
	for (;;) {
		await new Promise((tick) => setTimeout(tick, 30_000));
		const swapUsedGb = await readSwapUsedGb();
		process.stdout.write(`  mem: swap-used=${swapUsedGb.toFixed(1)}G (abort>${SWAP_ABORT_GB}G)\n`);
		if (swapUsedGb > SWAP_ABORT_GB) {
			process.stdout.write(`MEMORY ABORT: swap used ${swapUsedGb.toFixed(1)}G exceeded the ${SWAP_ABORT_GB}G ceiling — stopping the drain to protect the machine. (Planning-phase evidence, if any, is already recorded.)\n`);
			process.exitCode = 3;
			swapAborted = true;
			break;
		}
		// The persisted board is `{columns, dependencies}` — there is NO `board` wrapper. Reading `board.board`
		// yielded undefined and rendered every real lane as `{}`, so a card that was demonstrably being worked
		// looked like an empty board for the whole run (2026-08-08). Accept BOTH shapes and, crucially, treat an
		// unreadable/unparseable board as UNKNOWN rather than as empty.
		const parsed = await readFile(boardPath, "utf8")
			.then(
				(text) =>
					JSON.parse(text) as
						| { columns?: { id: string; cards: unknown[] }[] }
						| { board?: { columns: { id: string; cards: unknown[] }[] } },
			)
			.catch(() => null);
		if (parsed === null) {
			// No board file yet — say so, and let the fail-fast deadline below decide.
			process.stdout.write("  (board not readable yet)\n");
		}
		const columns =
			(parsed as { columns?: { id: string; cards: unknown[] }[] } | null)?.columns ??
			(parsed as { board?: { columns: { id: string; cards: unknown[] }[] } } | null)?.board?.columns ??
			[];
		const counts = Object.fromEntries(columns.map((column) => [column.id, column.cards.length]));
		const summary = JSON.stringify(counts);
		if (summary !== lastSummary) {
			lastSummary = summary;
			process.stdout.write(`  lanes: ${summary}\n`);
		}
		const active = (counts.backlog ?? 0) + (counts.planning ?? 0) + (counts.ready ?? 0) + (counts.in_progress ?? 0);
		const settled = (counts.completed ?? 0) + (counts.review ?? 0);
		if (active + settled > 0) {
			sawAnyCard = true;
		}
		if (!sawAnyCard && Date.now() > boardMustAppearBy) {
			process.stdout.write(
				`RIG BROKEN: no card reached ${boardPath} within 3m of seeding — the A2A accept did not become board work. Not burning the ${maxMinutes}m budget on an empty board.\n`,
			);
			process.exitCode = 2;
			break;
		}
		if (active === 0 && settled > 0) {
			process.stdout.write(`DRAIN SETTLED: ${summary}\n`);
			break;
		}
		if (Date.now() > deadline) {
			process.stdout.write(`DRAIN TIMEOUT after ${maxMinutes}m: ${summary}\n`);
			break;
		}
	}
	if (keepAt) {
		await rm(keepAt, { recursive: true, force: true });
		await execFileAsync("cp", ["-R", workspace, keepAt]).catch(() => undefined);
		// THE DELIVERED WORK IS ON A RESULT BRANCH, NOT THE WORKING TREE. A card that ends in review has its
		// output on `nklein/tasks/<id>-<hash>`; grading the tree therefore grades an EMPTY repo and returns the
		// null-agent answer for a run that genuinely produced code (live-found 2026-08-08 — a 0/3 that measured
		// nothing). `--out` must hand a grader the delivered bytes, so check the result branch out here.
		const branches = await execFileAsync("git", ["-C", keepAt, "branch", "--format=%(refname:short)"])
			.then(({ stdout }) => stdout.split("\n").map((line) => line.trim()).filter(Boolean))
			.catch(() => [] as string[]);
		const resultBranch = branches.find((branch) => branch.startsWith("nklein/tasks/"));
		if (resultBranch) {
			await execFileAsync("git", ["-C", keepAt, "checkout", "-q", resultBranch]).catch(() => undefined);
			process.stdout.write(`drained tree copied to: ${keepAt} (result branch ${resultBranch} checked out)\n`);
		} else {
			process.stdout.write(`drained tree copied to: ${keepAt} (NO result branch — the card produced no work)\n`);
		}
		// P23.5 scoring-time wire: when the fixture has an authored held-out oracle, grade the DELIVERED tree
		// (result branch checked out above — a card's output lives on its result branch, not the working tree)
		// and print the verdict beside the drain summary. Absent oracle ⇒ one line saying so, never silence:
		// "no oracle" and "oracle said nothing" must stay distinguishable. Non-fatal by construction — a grader
		// failure reports, it does not un-drain the run.
		try {
			// `workspace` is the TEMP COPY (…/ws) — the fixture identity lives in the SOURCE argument. The first
			// live run printed "none authored for ws", which is this bug made visible by the never-silent fallback.
			const fixtureName = basename(resolvePath(workspaceSource ?? ""));
			const probeDir = join(REPO, "test", "protected", "oracle", fixtureName);
			if (existsSync(probeDir)) {
				const { runHeldOutOracle } = await import("../src/core/held-out-oracle-runner");
				const verdict = await runHeldOutOracle({ workspacePath: keepAt, probeDir, repoRoot: REPO });
				process.stdout.write(
					`HELD-OUT ORACLE: ${verdict.failToPassPassed} / ${verdict.failToPassTotal} ` +
						`${verdict.delivered ? "DELIVERED" : "NOT-delivered"} | independent: ${verdict.independence.independent}\n`,
				);
			} else {
				process.stdout.write(`HELD-OUT ORACLE: none authored for ${fixtureName} — not graded\n`);
			}
		} catch (error) {
			process.stdout.write(`HELD-OUT ORACLE: grading FAILED (${error instanceof Error ? error.message.slice(0, 160) : String(error)})\n`);
		}
	}
	process.stdout.write(`${swapAborted ? "OUTCOME: memory-aborted\n" : ""}workspace was: ${workspace}\nruntime log: ${logPath}\n`);
	if (egressAuditEnabled) {
		clearInterval(egressTimer as NodeJS.Timeout);
		const verdict = await execFileAsync(TSX, ["src/cli.ts", "dev", "connection-audit", "--samples", egressSamplesPath], { cwd: REPO }).catch((error) => ({ stdout: String((error as { stdout?: string }).stdout ?? error) }));
		process.stdout.write(`EGRESS AUDIT: ${verdict.stdout.trim().split("\n").slice(-2).join(" | ")}\n`);
	}
} finally {
	await shutdown();
	if (!outDir) {
		process.stdout.write(`(temp workdir ${work} retained for inspection)\n`);
	}
}
