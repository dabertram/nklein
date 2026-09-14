/**
 * N8 (c) — the REAL-MODEL tranche runner: drive SWE-bench tranche instances through a live !Klein runtime with the
 * model PINNED, grade every delivered workspace with the sealed grader, and bank the receipts tied to the exact
 * model + seat (David 2026-09-14: "every benchmark score is tied to the exact models/seats that produced it").
 *
 *   tsx scripts/swebench-tranche-run.mts --run-id <id> --model <modelId> --runtime-port 3507 --home <runtimeHome> \
 *       [--runtime-host 127.0.0.1] [--instances all|<id>,<id>] [--no-plan] [--max-wait-ms 2700000] \
 *       [--poll-interval-ms 5000] [--workspace-parent DIR] [--out DIR] [--runtime-launcher FILE]
 *
 * Hermetic: instances come from the sha256-pinned cache (`swebench-fetch.mts` is the only egress step; a missing
 * cache refuses and names it); the grade runs `python:3.9-slim` with the network namespace OFF from the prepared
 * wheel caches (`swebench-grade.mts prepare`). The runtime is NOT started here — it runs from its own HOME with the
 * roles pinned; this runner pins the card too (`nkleinSettings`) and VERIFIES THE SEAT from that HOME's telemetry:
 * every `attempt_started` recorded during an instance's run must name `--model`, else the instance is EXCLUDED from
 * the score and the violation is written into its receipt — a number produced by the wrong model is never counted.
 *
 * Score = SWE-bench's rule verbatim per instance (every fail-to-pass id passes AND every pass-to-pass id still
 * passes, judged by the silence-is-failure parser), reported as resolved / attempted with the exclusions listed.
 */

import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDevRuntimeClient, executeDevTestScenario } from "../src/commands/dev-project-execution";
import { ensureRuntimeWorkspace } from "../src/commands/task/task-runtime-workspace";
import { createGitProcessEnv } from "../src/core/git-process-env";
import { getKanbanRuntimeOrigin, setKanbanRuntimeHost, setKanbanRuntimePort } from "../src/core/runtime-endpoint";
import { applyTestPatchToCopy, gradeSwebenchWorkspace, SWEBENCH_GRADER_IMAGE } from "../src/core/swebench-grader";
import { buildSwebenchCard, detectGradedTestTampering, listGradedTestFiles } from "../src/core/swebench-instance";
import { materializeSwebenchInstance, swebenchCacheRoot } from "../src/core/swebench-materialize";
import { SWEBENCH_TRANCHE } from "../src/core/swebench-tranche";
import { loadWorkspaceContext } from "../src/state/workspace-state";
import { captureBenchmarkWorkspaceResult } from "../src/workspace/repository-benchmark-result";

const execFile = promisify(execFileCallback);

interface Options {
	runId: string;
	model: string;
	runtimeHost: string;
	runtimePort: number;
	home: string;
	instances: string[];
	startInPlanMode: boolean;
	maxWaitMs: number;
	pollIntervalMs: number;
	workspaceParent: string;
	out: string;
	runtimeLauncher: string | null;
}

function parseArgs(argv: readonly string[]): Options {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] ?? "";
		if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
		const key = arg.slice(2);
		const next = argv[index + 1];
		if (key === "no-plan") {
			flags.add(key);
		} else if (next !== undefined && !next.startsWith("--")) {
			values.set(key, next);
			index += 1;
		} else {
			flags.add(key);
		}
	}
	const need = (key: string): string => {
		const value = values.get(key)?.trim();
		if (!value) throw new Error(`--${key} is required`);
		return value;
	};
	const runId = need("run-id");
	if (!/^[A-Za-z0-9_.-]+$/u.test(runId)) throw new Error("--run-id must contain only letters, digits, dot, underscore, or hyphen.");
	const instancesRaw = values.get("instances")?.trim() || "all";
	const instances =
		instancesRaw === "all"
			? SWEBENCH_TRANCHE.map((entry) => entry.instanceId)
			: instancesRaw.split(",").map((id) => id.trim()).filter(Boolean);
	for (const id of instances) {
		if (!SWEBENCH_TRANCHE.some((entry) => entry.instanceId === id)) throw new Error(`${id} is not in SWEBENCH_TRANCHE.`);
	}
	const integer = (key: string, fallback: number): number => {
		const raw = values.get(key);
		if (raw === undefined) return fallback;
		const parsed = Number.parseInt(raw, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${key} must be a positive integer.`);
		return parsed;
	};
	return {
		runId,
		model: need("model"),
		runtimeHost: values.get("runtime-host")?.trim() || "127.0.0.1",
		runtimePort: integer("runtime-port", 3507),
		home: resolve(need("home")),
		instances,
		startInPlanMode: !flags.has("no-plan"),
		maxWaitMs: integer("max-wait-ms", 45 * 60_000),
		pollIntervalMs: integer("poll-interval-ms", 5_000),
		workspaceParent: resolve(values.get("workspace-parent") ?? join(process.cwd(), ".real-runs", "swebench-tranche", runId, "workspaces")),
		out: resolve(values.get("out") ?? join(process.cwd(), ".real-runs", "swebench-tranche", runId)),
		runtimeLauncher: values.get("runtime-launcher") ? resolve(values.get("runtime-launcher") as string) : null,
	};
}

function log(message: string): void {
	process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${message}\n`);
}

/** The model as LM Studio reports it RIGHT NOW — refuses when it is not loaded (production never auto-loads). */
async function readLoadedModel(model: string): Promise<Record<string, unknown>> {
	const { stdout } = await execFile("lms", ["ps", "--json"], { maxBuffer: 4 * 1024 * 1024 });
	const rows = JSON.parse(stdout) as Record<string, unknown>[];
	const row = rows.find((candidate) => candidate.identifier === model || candidate.modelKey === model);
	if (!row) throw new Error(`${model} is not loaded (lms ps) — load it in LM Studio; this runner never loads models.`);
	let quant: Record<string, unknown> = {};
	try {
		const listed = await execFile("lms", ["ls", "--json"], { maxBuffer: 16 * 1024 * 1024 });
		const entry = (JSON.parse(listed.stdout) as Record<string, unknown>[]).find(
			(candidate) => candidate.modelKey === row.modelKey || candidate.path === row.modelKey,
		);
		if (entry) {
			quant = {
				quantization: entry.quantization ?? null,
				format: entry.format ?? null,
				architecture: entry.architecture ?? null,
				maxContextLength: entry.maxContextLength ?? null,
			};
		}
	} catch {
		// `lms ls` is descriptive only; the loaded row is the seat fact.
	}
	return {
		identifier: row.identifier ?? null,
		modelKey: row.modelKey ?? null,
		status: row.status ?? null,
		contextLength: row.contextLength ?? null,
		sizeBytes: row.sizeBytes ?? null,
		deviceIdentifier: row.deviceIdentifier ?? null,
		...quant,
	};
}

interface AttemptRow {
	taskId: string | null;
	modelId: string | null;
	providerId: string | null;
	mode: string | null;
	createdAt: number;
}

/** Every `attempt_started` the runtime HOME recorded at or after `sinceMs` — the seat witness. */
async function readAttemptsSince(home: string, sinceMs: number): Promise<AttemptRow[]> {
	const dir = join(home, ".nklein", "nklein", "telemetry");
	if (!existsSync(dir)) return [];
	const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
	const rows: AttemptRow[] = [];
	for (const name of files.slice(-2)) {
		const text = await readFile(join(dir, name), "utf8").catch(() => "");
		for (const line of text.split("\n")) {
			if (!line.includes('"attempt_started"')) continue;
			try {
				const parsed = JSON.parse(line) as {
					taskId?: string | null;
					createdAt?: number;
					metadata?: { category?: string; modelId?: string | null; providerId?: string | null; mode?: string | null };
				};
				if (parsed.metadata?.category !== "attempt_started") continue;
				const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
				if (createdAt < sinceMs) continue;
				rows.push({
					taskId: parsed.taskId ?? null,
					modelId: parsed.metadata.modelId ?? null,
					providerId: parsed.metadata.providerId ?? null,
					mode: parsed.metadata.mode ?? null,
					createdAt,
				});
			} catch {
				// A torn line is not evidence either way.
			}
		}
	}
	return rows;
}

class SeatViolationError extends Error {
	constructor(readonly attempt: AttemptRow) {
		super(`seat violation: an attempt started on ${attempt.modelId ?? "(unknown model)"} (task ${attempt.taskId ?? "?"})`);
		this.name = "SeatViolationError";
	}
}

/** Poll the HOME's telemetry during a run; rejects the moment an attempt names another model. */
function watchSeat(home: string, model: string, sinceMs: number, stop: { stopped: boolean }): Promise<never> {
	return new Promise((_, reject) => {
		const tick = async () => {
			if (stop.stopped) return;
			try {
				const rows = await readAttemptsSince(home, sinceMs);
				const foreign = rows.find((row) => row.modelId !== model);
				if (foreign) {
					reject(new SeatViolationError(foreign));
					return;
				}
			} catch {
				// Unreadable telemetry is checked again next tick; the post-run audit is the backstop.
			}
			setTimeout(() => void tick(), 20_000).unref();
		};
		void tick();
	});
}

async function git(repoPath: string, args: readonly string[]): Promise<string> {
	const { stdout } = await execFile("git", ["-C", repoPath, ...args], {
		env: createGitProcessEnv(),
		maxBuffer: 64 * 1024 * 1024,
	});
	return stdout.trim();
}

async function writeNew(path: string, content: string): Promise<void> {
	if (existsSync(path)) throw new Error(`refusing to overwrite immutable artifact ${path}`);
	await writeFile(path, content, { flag: "wx" });
}

async function runInstance(options: Options, instanceId: string, harness: Record<string, unknown>) {
	const entry = SWEBENCH_TRANCHE.find((candidate) => candidate.instanceId === instanceId);
	if (!entry) throw new Error(`${instanceId} is not in SWEBENCH_TRANCHE.`);
	const runId = `${options.runId}-${instanceId}`;
	const receiptPath = join(options.out, `${instanceId}.receipt.json`);
	if (existsSync(receiptPath)) {
		log(`${instanceId}: receipt exists — skipping (immutable).`);
		return JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
	}
	const startedAt = Date.now();
	const loadedModel = await readLoadedModel(options.model);
	const cacheRoot = swebenchCacheRoot(process.cwd());
	const workspacePath = join(options.workspaceParent, runId);
	log(`${instanceId}: materializing ${entry.repo} into ${workspacePath}`);
	const materialized = await materializeSwebenchInstance({
		cacheRoot,
		instanceId,
		targetDir: workspacePath,
		pythonVersion: entry.python,
	});
	const { instance } = materialized;
	// The runtime writes its board/session state INTO the workspace (`.nklein/`); without this exclude the sealed
	// capture refuses the tree as dirty (pilot 2026-09-14). Same rule the F11.3 seal applies in its docker plan.
	await appendFile(join(workspacePath, ".git", "info", "exclude"), ".nklein/\n");
	await loadWorkspaceContext(workspacePath, { autoCreateIfMissing: true });
	const workspaceId = await ensureRuntimeWorkspace(workspacePath);
	const client = createDevRuntimeClient(workspaceId);
	const card = buildSwebenchCard(instance);
	const scenario = {
		id: instanceId,
		title: card.title,
		prompt: card.prompt,
		specification: card.prompt,
		// Deliberately unused: the sealed grader is the oracle and it runs OUTSIDE the agent workspace.
		acceptanceCommand: "",
	};

	// A pinned model on a single-slot host is legitimately BUSY for moments (a lingering turn of the previous
	// instance's session) — retry a refused start, bounded, exactly as the F11.3 harness learned to.
	const PINNED_START_RETRIES = 5;
	const PINNED_START_RETRY_DELAY_MS = 60_000;
	const stop = { stopped: false };
	const watcher = watchSeat(options.home, options.model, startedAt, stop);
	let execution: Awaited<ReturnType<typeof executeDevTestScenario>> | null = null;
	let seatViolation: AttemptRow | null = null;
	let startAttempts = 0;
	try {
		for (;;) {
			startAttempts += 1;
			const attempt = executeDevTestScenario({
				client,
				workspaceId,
				scenario,
				baseRef: "main",
				seedTaskId: runId,
				startInPlanMode: options.startInPlanMode,
				autoReviewEnabled: false,
				externallySupervised: true,
				autoReviewMode: "commit",
				testEvidencePolicy: "externally_held_out",
				nkleinSettings: { providerId: "lmstudio", modelId: options.model },
				pollIntervalMs: options.pollIntervalMs,
				maxWaitMs: options.maxWaitMs,
			});
			try {
				execution = await Promise.race([attempt, watcher]);
			} catch (error) {
				if (error instanceof SeatViolationError) {
					seatViolation = error.attempt;
					log(`${instanceId}: ${error.message} — stopping the session; this instance is EXCLUDED from the score.`);
					await client.runtime.stopTaskSession.mutate({ taskId: runId }).catch(() => null);
					execution = await attempt.catch(() => null);
					break;
				}
				throw error;
			}
			const startMessage = execution.result.startMessage ?? "";
			if (execution.result.started || !startMessage.includes("not currently selectable") || startAttempts > PINNED_START_RETRIES) {
				break;
			}
			log(`${instanceId}: pinned model momentarily unselectable (${startAttempts}/${PINNED_START_RETRIES + 1}); retrying in 60s: ${startMessage}`);
			await new Promise((resolveDelay) => setTimeout(resolveDelay, PINNED_START_RETRY_DELAY_MS));
		}
	} finally {
		stop.stopped = true;
	}
	if (execution && !execution.result.started) {
		log(`${instanceId}: session did not start: ${execution.result.startMessage ?? "unknown"}`);
	}

	// Stop the seed's session before capture (a capped wait ABANDONS a still-live session), then retire the
	// attempt's runtime registration so nothing rescues or re-dispatches it. Grading reads the FILESYSTEM.
	await client.runtime.stopTaskSession.mutate({ taskId: runId }).catch((error: unknown) => {
		log(`${instanceId}: session stop before capture failed: ${error instanceof Error ? error.message : String(error)}`);
	});

	// Pin the delivered result AFTER the stop and BEFORE retirement: the sandbox result branch
	// (`refs/heads/nklein/tasks/<task>-<hash>`) is written when the session stops (a capped run delivers at that
	// moment — requests-1921, 2026-09-14), and retiring the project deletes it (flask-5014 pilot). Poll briefly
	// for the ref: the capture is asynchronous to the stop call.
	let pinnedResult: string | null = null;
	try {
		let refs: [string, string][] = [];
		for (let poll = 0; poll < 12 && refs.length === 0; poll += 1) {
			if (poll > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
			refs = (await git(workspacePath, ["for-each-ref", "--format=%(refname) %(objectname)", `refs/heads/nklein/tasks/${runId}-*`]))
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => line.split(" ") as [string, string]);
		}
		if (refs.length > 0) {
			const [refName, commit] = refs[refs.length - 1] as [string, string];
			await git(workspacePath, ["update-ref", `refs/nklein/benchmark-evidence/${runId}`, commit]);
			pinnedResult = commit;
			log(`${instanceId}: pinned delivered result ${commit.slice(0, 9)} from ${refName}`);
		} else {
			log(`${instanceId}: no nklein/tasks result branch — the session delivered nothing`);
		}
	} catch (error) {
		log(`${instanceId}: result pin failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
	}

	try {
		const removal = (await client.projects.remove.mutate({ projectId: workspaceId })) as { ok?: boolean; error?: string };
		if (!removal.ok) log(`${instanceId}: attempt workspace retirement refused: ${removal.error ?? "unknown"}`);
	} catch (error) {
		log(`${instanceId}: attempt workspace retirement failed: ${error instanceof Error ? error.message : String(error)}`);
	}

	// The seat audit over the whole run window — the backstop for anything the poll missed.
	const attempts = await readAttemptsSince(options.home, startedAt);
	const attemptModels: Record<string, number> = {};
	for (const row of attempts) attemptModels[row.modelId ?? "(null)"] = (attemptModels[row.modelId ?? "(null)"] ?? 0) + 1;
	const foreign = attempts.filter((row) => row.modelId !== options.model);
	if (foreign.length > 0 && !seatViolation) seatViolation = foreign[0] ?? null;

	// Grade the PINNED delivery: check it out so the working tree is the model's result, then the sealed capture
	// diffs it against the base and records the patch.
	let capture: Record<string, unknown> = { ok: false };
	try {
		if (pinnedResult) await git(workspacePath, ["checkout", "--quiet", "--detach", pinnedResult]);
		const captured = await captureBenchmarkWorkspaceResult({
			repoPath: workspacePath,
			baseCommit: materialized.baseCommitSha,
			runId,
			taskId: runId,
		});
		const { patch, ...rest } = captured;
		capture = { ok: true, patchBytes: Buffer.byteLength(patch, "utf8"), ...rest };
		const head = await git(workspacePath, ["rev-parse", "HEAD"]);
		if (rest.resultCommit !== head) await git(workspacePath, ["checkout", "--quiet", "--detach", rest.resultCommit]);
	} catch (error) {
		// A dirty or undelivered workspace is still what the agent LEFT — grade it as-is and say why.
		capture = { ok: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
	}

	// N8.1: did the agent edit the files it is graded by?
	const changed = new Set<string>();
	for (const name of (await git(workspacePath, ["diff", "--name-only", materialized.baseCommitSha, "HEAD"])).split("\n")) {
		if (name.trim()) changed.add(name.trim());
	}
	for (const line of (await git(workspacePath, ["status", "--porcelain=v1", "--untracked-files=all"])).split("\n")) {
		const name = line.slice(3).trim();
		if (name && !name.startsWith(".nklein/")) changed.add(name);
	}
	const tampering = detectGradedTestTampering({ testPatch: instance.testPatch, changedFiles: [...changed] });

	// Sealed grade on a COPY: test_patch host-side, then python:3.9-slim with the network namespace off.
	let verdict: Record<string, unknown> | null = null;
	let testPatchApplied: Record<string, unknown> = { applied: false, reason: "not attempted" };
	const copyDir = join(await mkdtemp(join(tmpdir(), "swebench-tranche-grade-")), "work");
	try {
		await cp(workspacePath, copyDir, { recursive: true });
		const applied = await applyTestPatchToCopy(copyDir, instance.testPatch);
		testPatchApplied = { ...applied };
		if (applied.applied) {
			const graded = await gradeSwebenchWorkspace({ entry, instance, workspaceCopyDir: copyDir, cacheRoot });
			const { graderStdoutTail, ...rest } = graded;
			verdict = { ...rest, graderStdoutTail: graderStdoutTail.slice(-1_200) };
		} else {
			verdict = {
				resolved: false,
				reason: `UNGRADABLE: the instance's own tests no longer apply (${applied.reason}) — graded files: ${listGradedTestFiles(instance.testPatch).join(", ")}`,
			};
		}
	} finally {
		await rm(join(copyDir, ".."), { recursive: true, force: true });
	}

	const resolved = verdict?.resolved === true;
	const excludedFromScore = seatViolation
		? `seat violation: attempt on ${seatViolation.modelId ?? "(unknown)"} (${seatViolation.taskId ?? "?"})`
		: execution?.result.classification.outcome === "runtime_down" || execution?.result.infrastructureFailure
			? `infrastructure: ${execution.result.infrastructureFailure ?? execution.result.classification.summary}`
			: null;
	const receipt = {
		schemaVersion: 1,
		runId,
		instanceId,
		repo: instance.repo,
		baseCommit: instance.baseCommit,
		tarballSha256: materialized.tarballSha256,
		harness,
		model: loadedModel,
		startedAt: new Date(startedAt).toISOString(),
		finishedAt: new Date().toISOString(),
		durationMs: Date.now() - startedAt,
		startAttempts,
		started: execution?.result.started ?? false,
		startMessage: execution?.result.startMessage ?? null,
		workflowOutcome: execution?.result.classification.outcome ?? null,
		workflowSummary: execution?.result.classification.summary ?? null,
		completedCardCount: execution?.result.finalCounts.completed ?? null,
		attemptModels,
		seatVerified: !seatViolation && attempts.length > 0,
		seatViolation,
		capture,
		changedFiles: [...changed],
		tampering,
		testPatchApplied,
		verdict,
		resolved,
		excludedFromScore,
		pinnedResult,
		workspacePath,
	};
	await mkdir(options.out, { recursive: true });
	await writeNew(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	await appendFile(
		join(options.out, "summary.jsonl"),
		`${JSON.stringify({ instanceId, resolved, excludedFromScore, workflowOutcome: receipt.workflowOutcome, durationMs: receipt.durationMs, reason: verdict?.reason ?? null })}\n`,
	);
	log(
		`${instanceId}: ${resolved ? "RESOLVED" : "unresolved"}${excludedFromScore ? ` [EXCLUDED: ${excludedFromScore}]` : ""} — ${String(verdict?.reason ?? "no verdict")} (${Math.round(receipt.durationMs / 60_000)} min, outcome ${receipt.workflowOutcome})`,
	);
	return receipt;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	setKanbanRuntimeHost(options.runtimeHost);
	setKanbanRuntimePort(options.runtimePort);
	const runtimeOrigin = getKanbanRuntimeOrigin();
	const health = await fetch(`${runtimeOrigin}/health`).catch(() => null);
	if (!health || !health.ok) throw new Error(`runtime at ${runtimeOrigin} is not healthy — start it first (own HOME, roles pinned).`);
	const nkleinCommit = await git(process.cwd(), ["rev-parse", "HEAD"]);
	const launcher = options.runtimeLauncher ? await readFile(options.runtimeLauncher, "utf8") : null;
	const harness = {
		nkleinCommit,
		runtimeOrigin,
		runtimeHome: options.home,
		startInPlanMode: options.startInPlanMode,
		autoReviewEnabled: false,
		testEvidencePolicy: "externally_held_out",
		agentSandboxImage: process.env.NKLEIN_AGENT_SANDBOX_IMAGE ?? "nklein/agent-sandbox:0.0.1 (default)",
		graderImage: SWEBENCH_GRADER_IMAGE,
		maxWaitMs: options.maxWaitMs,
		runtimeLauncher: launcher,
		runnerEnv: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("NKLEIN_"))),
	};
	await mkdir(options.out, { recursive: true });
	await mkdir(options.workspaceParent, { recursive: true });
	log(`run ${options.runId}: ${options.instances.length} instance(s), model ${options.model}, runtime ${runtimeOrigin}, nklein ${nkleinCommit.slice(0, 9)}, plan mode ${options.startInPlanMode ? "ON" : "OFF"}`);
	const receipts: Record<string, unknown>[] = [];
	for (const instanceId of options.instances) {
		try {
			receipts.push(await runInstance(options, instanceId, harness));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`${instanceId}: RUNNER ERROR — ${message}`);
			receipts.push({ instanceId, resolved: false, excludedFromScore: `runner error: ${message.split("\n")[0]}`, runnerError: message });
			await appendFile(join(options.out, "summary.jsonl"), `${JSON.stringify({ instanceId, resolved: false, excludedFromScore: `runner error: ${message.split("\n")[0]}` })}\n`);
		}
	}
	const counted = receipts.filter((receipt) => !receipt.excludedFromScore);
	const resolvedCount = counted.filter((receipt) => receipt.resolved === true).length;
	const summary = {
		schemaVersion: 1,
		runId: options.runId,
		model: options.model,
		harness,
		instances: receipts.map((receipt) => ({
			instanceId: receipt.instanceId,
			resolved: receipt.resolved === true,
			excludedFromScore: receipt.excludedFromScore ?? null,
			workflowOutcome: receipt.workflowOutcome ?? null,
			durationMs: typeof receipt.durationMs === "number" ? receipt.durationMs : null,
			reason: (receipt.verdict as { reason?: string } | null | undefined)?.reason ?? receipt.runnerError ?? null,
		})),
		attempted: counted.length,
		resolved: resolvedCount,
		excluded: receipts.length - counted.length,
		resolvedRate: counted.length > 0 ? resolvedCount / counted.length : null,
		finishedAt: new Date().toISOString(),
	};
	await writeFile(join(options.out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
	const lines = [
		`# SWE-bench tranche — ${options.runId}`,
		"",
		`Model: \`${options.model}\` · !Klein \`${nkleinCommit.slice(0, 9)}\` · plan mode ${options.startInPlanMode ? "ON" : "OFF"} · runtime ${runtimeOrigin}`,
		"",
		`**Resolved ${resolvedCount} / ${counted.length} attempted** (${counted.length > 0 ? `${((resolvedCount / counted.length) * 100).toFixed(0)}%` : "n/a"}); ${receipts.length - counted.length} excluded.`,
		"",
		"| instance | resolved | outcome | minutes | reason |",
		"|---|---|---|---|---|",
		...summary.instances.map(
			(row) =>
				`| ${row.instanceId} | ${row.excludedFromScore ? `EXCLUDED (${row.excludedFromScore})` : row.resolved ? "yes" : "no"} | ${row.workflowOutcome ?? ""} | ${typeof row.durationMs === "number" ? Math.round(row.durationMs / 60_000) : ""} | ${String(row.reason ?? "").replace(/\|/gu, "/").slice(0, 160)} |`,
		),
		"",
	];
	await writeFile(join(options.out, "summary.md"), `${lines.join("\n")}\n`);
	log(`DONE: resolved ${resolvedCount}/${counted.length} attempted, ${receipts.length - counted.length} excluded → ${join(options.out, "summary.md")}`);
}

await main();
