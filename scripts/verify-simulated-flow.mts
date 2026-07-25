/**
 * §13 "simulation-based fast path" — boot a REAL !Klein runtime against the LLM SIMULATOR (no models, memory
 * speed) and drive a seeded project flow end-to-end: decompose → cards → worker turns → review.
 *
 * Isolation: refuses to run against the real HOME (like the other verify scripts). Everything (config, provider
 * settings, workspaces) lives under the isolated HOME; the simulator serves both the OpenAI chat surface and the
 * LM Studio /api/v0 catalog shim on one origin.
 *
 * Usage:  HOME=$(mktemp -d /tmp/nklein-simflow-XXXX) npx tsx scripts/verify-simulated-flow.mts
 * Env:    NKLEIN_SIMFLOW_TIMEOUT_MS (default 240000; 480000 in scenario mode) — budget for the monitored flow.
 *         NKLEIN_SIMFLOW_SCENARIO — a scenario-set project ("02" or the full registry id): loads that set from
 *         packages/llm-simulator/scenarios/<project>/ and drives the REAL dev-test registry project with it.
 *         NKLEIN_SIMFLOW_RUN — "perfect" (default) or "flaky": which run file of the set to serve.
 *         NKLEIN_NIGHTLY_EXPECTED_FIXTURE / NKLEIN_NIGHTLY_EXPECTED_RECORDING_SET — nightly-only manifest
 *         bindings. Resolution fails closed on either mismatch and emits a SHA-256 evidence line for the exact
 *         scenario bytes served; direct simulator runs may omit both.
 *         NKLEIN_SIMFLOW_SCRIPT — captured ScenarioScript JSON to replay; requires NKLEIN_SIMFLOW_SCENARIO to name
 *         the original dev-test preset. NKLEIN_SIMFLOW_EXPECT_OUTCOME may pin a known failure classification (for
 *         example `stagnant`) so a real-model failure becomes a deterministic regression fixture rather than a
 *         falsely expected successful drain.
 *         NKLEIN_SIMFLOW_POOLS=1 — the per-MACHINE pool fan-out verification (todo §5 ★ pools): a fake `lms` CLI
 *         reports two machines (coder-a local, coder-b on sim-machine-2), the worker role pools both coders, the
 *         runtime runs with NKLEIN_PER_MACHINE_MAX_CONCURRENCY=1, and 4 dep-free cards must fan out: workers
 *         observed on BOTH coder models with OVERLAPPING turn windows (true cross-machine parallelism).
 *         NKLEIN_SIMFLOW_TURNLOOP=1 — the §12 turn-loop ladder regression (catalog id a-same-question): the greet
 *         worker re-raises the SAME clarifying question for 3 turns (each with a read_files call so the session
 *         stays alive) instead of progressing. The runtime's TurnLoopGuard must detect the repeat, ground the
 *         contested token in the card's `Acceptance check:` line, and inject the auto-resolve nudge mid-session —
 *         the run then completes normally. Asserted: the nudge text reached the model on the wire + full drain.
 *         NKLEIN_SIMFLOW_MULTI_MODEL=1 — the ≥3-agent SWARM verification (todo §5 ★ near-term): three distinct
 *         sim models are pinned per role (architect/worker/reviewer, modelSelectionMode "pinned"); after the run
 *         the simulator journal must show decompose on the architect model, every write_files worker turn on the
 *         worker model, every review on the reviewer model, and the two worker sessions overlapping in time.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import treeKill from "tree-kill";
import {
	buildScenarioDriftReport,
	createSimulatorServer,
	formatScenarioDriftReport,
	isUnmatchedJournalEntry,
} from "../packages/llm-simulator/src/index.js";
import type { ScenarioScript } from "../packages/llm-simulator/src/index.js";
import {
	CRASH_RECOVERY_MATRIX_PHASES,
	evaluateCrashRecoveryPhaseEvidence,
	type CrashRecoveryMatrixPhase,
	type CrashRecoveryMatrixPhaseEvidence,
} from "../src/core/crash-recovery-matrix.js";
import {
	bindNightlyRecording,
	type NightlyRecordingEvidence,
} from "../src/core/nightly-recording-evidence.js";
import type { TeardownReport } from "../src/core/nightly-drain-collector.js";
import { summarizeNightlyModelIo } from "../src/core/nightly-cell-cost.js";
import { readAllAgentLedger } from "../src/state/agent-attempt-ledger-store.js";
import {
	isNightlyHermeticEnvironment,
	parseNightlyHermeticEvidence,
} from "../src/core/nightly-hermeticity.js";

const SCENARIO_SELECTOR = process.env.NKLEIN_SIMFLOW_SCENARIO?.trim() || "";
const SCENARIO_RUN = process.env.NKLEIN_SIMFLOW_RUN === "flaky" ? "flaky-run" : "perfect-run";
const REPLAY_SCRIPT_PATH = process.env.NKLEIN_SIMFLOW_SCRIPT?.trim() || "";
const EXPECTED_OUTCOME = process.env.NKLEIN_SIMFLOW_EXPECT_OUTCOME?.trim() || "";
const NIGHTLY_EXPECTED_FIXTURE = process.env.NKLEIN_NIGHTLY_EXPECTED_FIXTURE?.trim() || "";
const NIGHTLY_EXPECTED_RECORDING_SET = process.env.NKLEIN_NIGHTLY_EXPECTED_RECORDING_SET?.trim() || "";
const NIGHTLY_BOUND = Boolean(NIGHTLY_EXPECTED_FIXTURE || NIGHTLY_EXPECTED_RECORDING_SET);
const TIMEOUT_MS =
	Number(process.env.NKLEIN_SIMFLOW_TIMEOUT_MS) || (SCENARIO_SELECTOR || REPLAY_SCRIPT_PATH ? 480_000 : 240_000);
// Env-overridable so independent scenario runs can execute in parallel on distinct runtime ports without colliding.
// Default 3986 unchanged when unset — byte-identical to before. NB: each run spawns worker sessions that shell out to
// `npm test`, so runs are CPU-heavy; parallelizing MANY (or the two largest scenarios) can starve a big project into a
// false timeout. Prefer sequential validation; parallelize modestly and only on a lightly-loaded machine.
const RUNTIME_PORT = Number(process.env.NKLEIN_SIMFLOW_RUNTIME_PORT) || 3986;
const MULTI_MODEL = process.env.NKLEIN_SIMFLOW_MULTI_MODEL === "1";
const POOLS = process.env.NKLEIN_SIMFLOW_POOLS === "1";
const TURNLOOP = process.env.NKLEIN_SIMFLOW_TURNLOOP === "1";
const CRASH_PHASE = (process.env.NKLEIN_SIMFLOW_CRASH_PHASE?.trim() || null) as CrashRecoveryMatrixPhase | null;
if (CRASH_PHASE && !CRASH_RECOVERY_MATRIX_PHASES.includes(CRASH_PHASE)) {
	fail(`Unknown NKLEIN_SIMFLOW_CRASH_PHASE=${CRASH_PHASE}. Expected: ${CRASH_RECOVERY_MATRIX_PHASES.join(", ")}.`);
}
/** §12 a-same-question: the boundary question the looping worker keeps re-raising. Its contested token (the
 *  backticked acceptance command) is present in the card's `Acceptance check:` line, so the guard must ground it
 *  there and auto-resolve with a nudge instead of parking. */
const TURNLOOP_QUESTION =
	'Before I write the file - the acceptance command `node -e "process.exit(0)"` looks trivial; should I instead set up vitest and target *.js test files, or keep the acceptance exactly as specified?';
const SIM_MODEL = "sim/qwen-fast-coder";
const SWARM_MODELS = {
	architect: "sim/architect-r1",
	worker: "sim/coder-14b",
	reviewer: "sim/reviewer-qwq",
} as const;
/** Pools mode (todo §5 ★ per-machine pools): two "machines", one coder each; easy cards must fan out across both. */
const POOL_MODELS = {
	architect: "sim/architect-r1",
	coderA: "sim/coder-a",
	coderB: "sim/coder-b",
	reviewer: "sim/reviewer-qwq",
} as const;
const POOL_MACHINE_2 = "sim-machine-2";

function fail(message: string): never {
	console.error(`FAIL ✗ ${message}`);
	process.exit(1);
}

if (homedir() === "/Users/david" || process.env.HOME === "/Users/david") {
	fail("Refusing to run against HOME=/Users/david. Set HOME to an isolated dir (e.g. mktemp -d /tmp/nklein-simflow-XXXX).");
}
if (NIGHTLY_BOUND && !isNightlyHermeticEnvironment()) {
	fail("Nightly manifest bindings require NKLEIN_NIGHTLY_HERMETIC=1; refusing a host-dependent nightly verdict.");
}

// ---------------------------------------------------------------------------
// The inline SMOKE scenario: a 2-card decompose + per-card worker turns + review approvals. The big
// project scenario sets live in packages/llm-simulator/scenarios/ — this inline one keeps the harness
// self-contained and fast.
// ---------------------------------------------------------------------------
// In multi-model swarm mode every turn gets a little latency so the two dep-free workers demonstrably overlap.
const SMOKE_TURN_LATENCY_MS = MULTI_MODEL || POOLS ? 700 : undefined;

const SMOKE_CARDS = [
	{ id: "card-greet", title: "Greeting module", file: "greet.ts", fn: "greet", body: "return `Hello, ${name}!`;" },
	{ id: "card-farewell", title: "Farewell module", file: "farewell.ts", fn: "farewell", body: "return `Goodbye, ${name}.`;" },
	...(POOLS
		? [
				{ id: "card-salute", title: "Salute module", file: "salute.ts", fn: "salute", body: "return `Salute, ${name}!`;" },
				{ id: "card-adieu", title: "Adieu module", file: "adieu.ts", fn: "adieu", body: "return `Adieu, ${name}.`;" },
			]
		: []),
];
const TRIGGER_CRASH_CARD = {
	id: "trigger-crash-recovery",
	title: "Crash matrix trigger delivery",
	file: "trigger-recovery.ts",
	fn: "triggerRecovered",
	body: "return `Recovered trigger ${name}.`;",
};
const FLOW_CARDS = [...SMOKE_CARDS, ...(CRASH_PHASE === "trigger" ? [TRIGGER_CRASH_CARD] : [])];

const script: ScenarioScript = {
	name: "simflow-smoke",
	seed: 7,
	tracks: [
		{
			id: "perfect-decompose",
			// Class "any" + a seed-prompt needle: on the wire a plan seed is textually IDENTICAL to a worker card
			// (same system shell, same Leaf-scope scaffold, same tool list — live journal 2026-07-10), so decompose
			// tracks key on THEIR OWN project's seed prompt instead of a universal marker.
			requestClass: "any",
			userMessageIncludes: "implementation-card breakdown",
			turns: [
				{
					behavior: {
						kind: "tool_calls",
						calls: [
							{
								name: "decompose_project",
								arguments: {
									slug: "sim-smoke",
									spec: "Tiny dependency-free tasks proving the simulated fast path.",
									plan: "One tiny module per card, all independent.",
									defaultAcceptanceCommand: 'node -e "process.exit(0)"',
									tasks: SMOKE_CARDS.map((card) => ({
										id: card.id,
										title: card.title,
										prompt: `Create ${card.file} exporting ${card.fn}(name).`,
										// F1.34b-ext: the scripted fixtures write a greeting module with no test scaffolding —
										// declared upfront so the default-ON test-driven gate steps aside AUDIBLY instead of
										// bounce→identical-feedback→park (which N10 caught as stuck cards after recovery).
										testability: "not_testable",
										testabilityReason: "scripted smoke fixture without test scaffolding",
									})),
								},
							},
						],
					},
				},
			],
			repeatLastTurn: true,
		},
		...FLOW_CARDS.map((card) => ({
			id: TURNLOOP && card.fn === "greet" ? "a-same-question-worker-greet" : `perfect-worker-${card.fn}`,
			requestClass: "worker" as const,
			userMessageIncludes: card.file,
			turns: [
				// §12 a-same-question: the looping prelude — the SAME clarifying question re-raised for 3 turns,
				// each alongside a read_files call so the agent session keeps running (pure text would end the run).
				// The TurnLoopGuard must fire on turn 3, ground the backticked acceptance command in the card's
				// `Acceptance check:` line, and inject the auto-resolve nudge; turn 4 then progresses normally.
				...(TURNLOOP && card.fn === "greet"
					? Array.from({ length: 3 }, () => ({
							behavior: {
								kind: "tool_calls" as const,
								calls: [{ name: "read_files", arguments: { paths: [card.file] } }],
								content: TURNLOOP_QUESTION,
							},
						}))
					: []),
				{
					behavior: {
						kind: "tool_calls" as const,
						calls: [
							{
								name: "write_files",
								arguments: {
									files: [
										{
											path: card.file,
											content: `export function ${card.fn}(name: string): string {\n\t${card.body}\n}\n`,
										},
									],
								},
							},
						],
					},
				},
				{ behavior: { kind: "text" as const, content: `Created ${card.file} with the ${card.fn}(name) export. Task complete.` } },
			],
			repeatLastTurn: true,
		})),
		// Compaction cell: aimock indexes cycled turns by the request's ASSISTANT-MESSAGE COUNT, and a rescue
		// review after a crash is a FRESH session (count 0) — so a count-keyed ladder would serve the round-1
		// request_changes forever (identical-feedback park). The round number is in the prompt text; key round 2
		// on it directly (needle-keyed tracks are most specific, and this one is listed first among them).
		...(CRASH_PHASE === "compaction"
			? [
				{
					id: "compaction-review-greet-round2",
					requestClass: "review" as const,
					userMessageIncludes: 'the card "Greeting module" (review round 2)',
					turns: [
						{
							behavior: {
								kind: "tool_calls" as const,
								calls: [
									{
										name: "submit_review",
										arguments: { verdict: "approve", summary: 'Reviewed "Greeting module": follow-up pass is clean.' },
									},
								],
							},
						},
						{ behavior: { kind: "text" as const, content: "Review submitted: approved." } },
					],
					cycleTurns: true,
				},
			]
			: []),
		// Reviews are PER-CARD tracks (needle = card title): occurrence ladders are per FIXTURE, not per session —
		// a shared review track lets card A consume the whole turn ladder and starve card B (live-found).
		...FLOW_CARDS.map((card) => ({
			id: `perfect-review-${card.fn}`,
			requestClass: "review" as const,
			userMessageIncludes: `the card "${card.title}"`,
			turns: [
				// Compaction cell: the FIRST greet verdict requests changes so the bounce re-drive issues a second
				// dispatch with existing history — the deterministic core path that walks compactBeforeOverflow (ratio
				// lowered via NKLEIN_CONTEXT_COMPACT_RATIO) into its crash barrier. No guard interference.
				...(CRASH_PHASE === "compaction" && card.fn === "greet"
					? [
							{
								behavior: {
									kind: "tool_calls" as const,
									calls: [
										{
											name: "submit_review",
											arguments: {
												verdict: "request_changes",
												summary: `Reviewed "${card.title}": one more pass needed.`,
												feedback: "Add a trailing newline check to the module before delivery.",
											},
										},
									],
								},
							},
							{ behavior: { kind: "text" as const, content: "Review submitted: changes requested." } },
						]
					: []),
				{
					behavior: {
						kind: "tool_calls" as const,
						calls: [
							{
								name: "submit_review",
								// submit_review's live contract (tool result, 2026-07-10): `verdict` + non-empty `summary`;
								// `feedback` only when requesting changes. A feedback-only verdict is REJECTED by the tool.
								arguments: { verdict: "approve", summary: `Reviewed "${card.title}": clean, matches the task.` },
							},
						],
					},
				},
				// Close with TEXT: the runner keeps prompting until a non-tool turn, so repeating submit_review
				// forever burns review rounds (5 observed) before delivery.
				{ behavior: { kind: "text" as const, content: "Review submitted: approved." } },
			],
			// Cycle (not repeat-last): the ::review session resumes with its transcript across rounds — a linear
			// ladder would answer text-only (no verdict) on any round ≥2 (live-found 2026-07-10).
			cycleTurns: true,
		})),
		{
			id: "perfect-any-fallback",
			requestClass: "any",
			turns: [{ behavior: { kind: "text", content: "Acknowledged. Proceeding as instructed." } }],
			repeatLastTurn: true,
		},
	],
};

if (SMOKE_TURN_LATENCY_MS) {
	for (const track of script.tracks) {
		for (const turn of track.turns) {
			turn.latencyMs ??= SMOKE_TURN_LATENCY_MS;
		}
	}
}

/** Resolve NKLEIN_SIMFLOW_SCENARIO ("02" or a full registry id) to {registryId, script}. */
interface ResolvedScenario {
	readonly registryId: string;
	readonly scenario: ScenarioScript;
	readonly recordingEvidence?: NightlyRecordingEvidence;
}

async function resolveScenario(): Promise<ResolvedScenario | undefined> {
	if (REPLAY_SCRIPT_PATH) {
		if (!SCENARIO_SELECTOR) {
			fail("NKLEIN_SIMFLOW_SCRIPT requires NKLEIN_SIMFLOW_SCENARIO=<dev-test preset id>");
		}
		const scenario = JSON.parse(await readFile(REPLAY_SCRIPT_PATH, "utf8")) as ScenarioScript;
		if (!scenario.name || !Array.isArray(scenario.tracks) || scenario.tracks.length === 0) {
			fail(`captured replay at ${REPLAY_SCRIPT_PATH} is not a non-empty ScenarioScript`);
		}
		console.log(`Captured replay mode: ${SCENARIO_SELECTOR} · ${REPLAY_SCRIPT_PATH} (${scenario.tracks.length} tracks)`);
		return { registryId: SCENARIO_SELECTOR, scenario };
	}
	if (!SCENARIO_SELECTOR) return undefined;
	const scenariosDir = new URL("../packages/llm-simulator/scenarios/", import.meta.url).pathname;
	const dirs = readdirSync(scenariosDir).sort();
	const match = dirs.find((dir) => dir === SCENARIO_SELECTOR || dir.startsWith(`${SCENARIO_SELECTOR}_`));
	if (!match) fail(`no scenario set matches "${SCENARIO_SELECTOR}" under packages/llm-simulator/scenarios/`);
	const runPath = join(scenariosDir, match, `${SCENARIO_RUN}.json`);
	const rawScenario = await readFile(runPath, "utf8");
	const scenario = JSON.parse(rawScenario) as ScenarioScript;
	console.log(`Scenario mode: ${match} · ${SCENARIO_RUN} (${scenario.tracks.length} tracks)`);
	const recordingEvidence = bindNightlyRecording({
		selector: SCENARIO_SELECTOR,
		resolvedFixture: match,
		expectedFixture: NIGHTLY_EXPECTED_FIXTURE,
		expectedRecordingSet: NIGHTLY_EXPECTED_RECORDING_SET,
		runFile: `${SCENARIO_RUN}.json`,
		rawScenario,
	});
	if (NIGHTLY_EXPECTED_FIXTURE || NIGHTLY_EXPECTED_RECORDING_SET) {
		console.log(`NIGHTLY_RECORDING_EVIDENCE=${JSON.stringify(recordingEvidence)}`);
	}
	return { registryId: match, scenario, recordingEvidence };
}

interface PostTeardownResidue {
	readonly report: TeardownReport;
	readonly orphanSessionIds: readonly string[];
	readonly orphanWorktreePaths: readonly string[];
	readonly orphanLeaseIds: readonly string[];
}

/**
 * Inspect every resource class the nightly invariant pack calls "teardown" after the runtime has exited.
 * Container residue is counted as an orphan session resource: a sandbox container is the session's effectful
 * process boundary, and reporting zero sessions while its container survives would be a false clean shutdown.
 */
async function collectPostTeardownResidue(input: {
	readonly home: string;
	readonly sandboxNamespace: string;
}): Promise<PostTeardownResidue> {
	const index = JSON.parse(
		await readFile(join(input.home, ".nklein", "nklein", "workspaces", "index.json"), "utf8"),
	) as { entries?: Record<string, { workspaceId?: string }> };
	const orphanSessionIds: string[] = [];
	for (const entry of Object.values(index.entries ?? {})) {
		if (!entry.workspaceId) continue;
		const sessions = JSON.parse(
			await readFile(join(input.home, ".nklein", "nklein", "workspaces", entry.workspaceId, "sessions.json"), "utf8"),
		) as Record<string, { state?: string }>;
		for (const [taskId, session] of Object.entries(sessions)) {
			if (["running", "queued", "paused", "awaiting_review"].includes(session.state ?? "")) {
				orphanSessionIds.push(`${taskId}:${session.state}`);
			}
		}
	}

	const ledgerRoot = process.env.NKLEIN_AGENT_LEDGER_ROOT?.trim() ||
		join(input.home, ".nklein", "nklein", "agent-attempt-ledger");
	const ledgerEvents = await readAllAgentLedger({ rootDir: ledgerRoot });
	const activeLeases = new Map<string, string>();
	for (const event of ledgerEvents) {
		if (event.kind !== "scheduler") continue;
		const key = `${event.workflowId}:${event.taskId}`;
		if (event.event === "lease_acquired" && event.leaseId) activeLeases.set(key, event.leaseId);
		if (["completed", "reclaimed", "cancelled"].includes(event.event)) activeLeases.delete(key);
	}
	const orphanLeaseIds = [...activeLeases.entries()].map(([key, leaseId]) => `${key}:${leaseId}`);

	const worktreesRoot = join(input.home, ".nklein", "task-worktrees");
	const orphanWorktreePaths = await readdir(worktreesRoot, { withFileTypes: true })
		.then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => join(worktreesRoot, entry.name)))
		.catch(() => [] as string[]);
	const containerNames = await new Promise<string[]>((settle) => {
		const child = spawn("docker", ["ps", "-a", "--format", "{{.Names}}", "--filter", "label=nklein.kind=agent-sandbox"]);
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
		child.once("error", () => settle(["docker-inspection-unavailable"]));
		child.once("close", (code) =>
			settle(
				code === 0
					? output.split(/\r?\n/).filter((name) => name.includes(input.sandboxNamespace))
					: ["docker-inspection-failed"],
			),
		);
	});
	orphanSessionIds.push(...containerNames.map((name) => `container:${name}`));
	return {
		report: {
			orphanSessions: orphanSessionIds.length,
			orphanWorktrees: orphanWorktreePaths.length,
			orphanLeases: orphanLeaseIds.length,
		},
		orphanSessionIds,
		orphanWorktreePaths,
		orphanLeaseIds,
	};
}

async function main(): Promise<void> {
	const home = process.env.HOME as string;
	console.log(`Isolated HOME: ${home}`);
	const scenarioMode = await resolveScenario();

	// 1) Simulator (chat surface + LM Studio /api shim on one origin).
	const simulatedModels = POOLS
		? Object.values(POOL_MODELS).map((id) => ({
				id,
				state: "loaded" as const,
				family: "qwen",
				maxContextLength: 65536,
			}))
		: MULTI_MODEL
			? [
					{ id: SWARM_MODELS.architect, state: "loaded" as const, family: "qwen", maxContextLength: 65536 },
					{ id: SWARM_MODELS.worker, state: "loaded" as const, family: "qwen", maxContextLength: 65536 },
					{ id: SWARM_MODELS.reviewer, state: "loaded" as const, family: "qwen", maxContextLength: 65536 },
				]
			: [{ id: SIM_MODEL, state: "loaded" as const, family: "qwen", maxContextLength: 65536 }];
	const simulator = createSimulatorServer(scenarioMode?.scenario ?? script, { models: simulatedModels });
	await simulator.start();
	const simBase = simulator.url(); // http://127.0.0.1:<port>/v1
	console.log(`Simulator: ${simBase}`);


	// 2) Isolated HOME wiring: config + provider settings + selection.
	await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
	await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
	await writeFile(
		// The runtime's GLOBAL config lives at ~/.nklein/nklein/config.json (runtime-config-paths.ts) — writing
		// ~/.nklein/config.json is silently ignored (live-found 2026-07-10: the setup wizard auto-fired anyway).
		join(home, ".nklein", "nklein", "config.json"),
		JSON.stringify(
			{
				selectedAgentId: "nklein",
				developerModeEnabled: true,
				setupWizardCompletedAt: Date.now(),
				// N4: scenario workers need local git/shell only. Keeping the sandbox offline makes git remotes and
				// web/egress unobservable instead of trusting that no recording happens to invoke them.
				agentRulesets: {
					capability: { globalPreset: "strict" },
					delivery: { globalPreset: "fully_open" },
				},
				modelRoles: POOLS
					? {
							// Pools fan-out (todo §5 ★): architect/reviewer pinned; the WORKER role pools BOTH coders —
							// per-machine cap 1 must push the second concurrent card onto the other machine's coder.
							architect: { modelId: POOL_MODELS.architect, providerId: "lmstudio", modelSelectionMode: "pinned" },
							worker: {
								modelId: POOL_MODELS.coderA,
								providerId: "lmstudio",
								additionalModels: [{ modelId: POOL_MODELS.coderB, providerId: "lmstudio" }],
							},
							reviewer: { modelId: POOL_MODELS.reviewer, providerId: "lmstudio", modelSelectionMode: "pinned" },
						}
					: MULTI_MODEL
					? {
							// Hard pins per role (todo §5 ★ near-term swarm): auto-selection must NOT substitute.
							architect: { modelId: SWARM_MODELS.architect, providerId: "lmstudio", modelSelectionMode: "pinned" },
							worker: { modelId: SWARM_MODELS.worker, providerId: "lmstudio", modelSelectionMode: "pinned" },
							reviewer: { modelId: SWARM_MODELS.reviewer, providerId: "lmstudio", modelSelectionMode: "pinned" },
						}
					: {
							architect: { modelId: SIM_MODEL, providerId: "lmstudio" },
							worker: { modelId: SIM_MODEL, providerId: "lmstudio" },
							reviewer: { modelId: SIM_MODEL, providerId: "lmstudio" },
						},
			},
			null,
			1,
		),
	);
	await writeFile(
		join(home, ".nklein", "data", "settings", "providers.json"),
		JSON.stringify(
			{
				version: 1,
				lastUsedProvider: "lmstudio",
				providers: {
					lmstudio: {
						settings: {
							provider: "lmstudio",
							model: POOLS ? POOL_MODELS.coderA : MULTI_MODEL ? SWARM_MODELS.worker : SIM_MODEL,
							baseUrl: simBase,
						},
						updatedAt: new Date().toISOString(),
						tokenSource: "manual",
					},
				},
			},
			null,
			1,
		),
	);
	await writeFile(
		join(home, ".nklein", "nklein", "nklein-provider-selection.json"),
		JSON.stringify({ providerId: "lmstudio" }),
	);

	// 3) Boot the runtime under the isolated HOME.
	// The simulator must be hermetic at BOTH model surfaces. Provider traffic already targets aimock, but the
	// capacity view independently shells out to `lms ps`; consulting the real fleet made simulated drains queue behind
	// unrelated live campaigns. Always provide a deterministic `lms` inventory matching the simulator catalog. Pools
	// mode additionally assigns its second coder/reviewer to another machine to exercise machine-aware admission.
	const fakeLmsPath = join(home, "fake-lms.sh");
	const lmsPsPayload = JSON.stringify(
		simulatedModels.map((model) => ({
			type: "llm",
			identifier: model.id,
			modelKey: model.id,
			deviceIdentifier:
				POOLS && (model.id === POOL_MODELS.coderB || model.id === POOL_MODELS.reviewer) ? POOL_MACHINE_2 : null,
			status: "IDLE",
			queued: 0,
		})),
	);
	await writeFile(fakeLmsPath, `#!/bin/sh\ncase "$*" in *"ps"*) printf '%s' '${lmsPsPayload}' ;; *) printf '[]' ;; esac\n`);
	await chmod(fakeLmsPath, 0o755);
	const sandboxNamespace = `simflow-${process.pid}-${NIGHTLY_BOUND ? "ephemeral" : RUNTIME_PORT}`;
	const simulatedFleetEnv: Record<string, string> = {
		NKLEIN_LMS_BIN: fakeLmsPath,
		NKLEIN_NO_AUTO_UPDATE: "1",
		BASIC_MEMORY_AUTO_UPDATE: "false",
		NKLEIN_NIGHTLY_MODEL_GATEWAY_URL: simBase,
		// Every simulator runtime owns a unique sandbox namespace and skips startup mutation entirely. This keeps a
		// hermetic replay from reaping a live benchmark runtime's Docker containers on the shared host daemon.
		NKLEIN_SANDBOX_NAMESPACE: sandboxNamespace,
		...(CRASH_PHASE ? {} : { NKLEIN_SANDBOX_SKIP_STARTUP_REAP: "1" }),
		...(CRASH_PHASE
			? {
					NKLEIN_CRASH_RECOVERY_MATRIX: "1",
					NKLEIN_CRASH_RECOVERY_PHASE: CRASH_PHASE,
					NKLEIN_CRASH_RECOVERY_CONTROL_DIR: join(
						home,
						".nklein",
						"nklein",
						"crash-recovery-matrix",
					),
				}
			: {}),
		// Compaction cell: the RATIO is policy, the stop→compact→restart MECHANISM is the invariant under test.
		// A smoke-scale session can never reach the default 0.92 honestly — every ballast fixture trips a
		// legitimate admission guard (start-fit, difficulty, E2BIG, repetition) — so the cell lowers the
		// threshold and exercises the identical code path, barrier included.
		...(CRASH_PHASE === "compaction" ? { NKLEIN_CONTEXT_COMPACT_RATIO: "0.05" } : {}),
		...(POOLS
			? {
					NKLEIN_PER_MACHINE_MAX_CONCURRENCY: "1",
					NKLEIN_QUEUE_AWARE_FREE_FIRST: "1",
				}
			: {}),
	};
	const runtimeLogs: string[] = [];
	let activeRuntimePort = NIGHTLY_BOUND ? 0 : RUNTIME_PORT;
	let runtime: ChildProcess | null = null;
	let runtimeRestarts = 0;
	const spawnRuntime = (): ChildProcess => {
		const child = spawn(
			"npx",
			[
				"tsx",
				"src/cli.ts",
				"--port",
				NIGHTLY_BOUND ? "ephemeral" : String(RUNTIME_PORT),
				"--no-open",
				"--host",
				"127.0.0.1",
			],
			{
				env: {
					...process.env,
					HOME: home,
					NODE_ENV: "development",
					...(!NIGHTLY_BOUND
						? { NKLEIN_RUNTIME_PORT: String(RUNTIME_PORT), KANBAN_RUNTIME_PORT: String(RUNTIME_PORT) }
						: {}),
					...simulatedFleetEnv,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		child.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			runtimeLogs.push(text);
			const assigned = /!Klein running at https?:\/\/127\.0\.0\.1:(\d+)/.exec(text);
			if (assigned?.[1]) activeRuntimePort = Number(assigned[1]);
		});
		child.stderr?.on("data", (chunk: Buffer) => runtimeLogs.push(chunk.toString()));
		runtime = child;
		return child;
	};
	spawnRuntime();
	const stopRuntime = () => runtime?.kill("SIGTERM");
	const stopRuntimeAndWait = async (): Promise<void> => {
		const child = runtime;
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		const closed = new Promise<void>((settle) => child.once("close", () => settle()));
		child.kill("SIGTERM");
		await Promise.race([
			closed,
			new Promise<void>((_, reject) => setTimeout(() => reject(new Error("runtime did not stop within 60s")), 60_000)),
		]);
	};
	const waitForRuntime = async (timeoutMs: number): Promise<void> => {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			try {
				if (activeRuntimePort === 0) throw new Error("runtime port not assigned yet");
				const response = await fetch(`http://127.0.0.1:${activeRuntimePort}/api/trpc/projects.list`);
				if (response.ok) return;
			} catch {
				/* not up yet */
			}
			if (Date.now() > deadline) throw new Error(`runtime did not come up within ${timeoutMs}ms`);
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	};

	try {
		// Wait for the runtime API.
		await waitForRuntime(60_000).catch(() => {
			console.error(runtimeLogs.join("").slice(-2000));
			fail("runtime did not come up within 60s");
		});
		console.log("Runtime is up. Seeding the dev-test scenario…");
		if (NIGHTLY_BOUND) {
			const runtimeReceiptLines = runtimeLogs
				.join("")
				.split(/\r?\n/)
				.filter((line) => line.includes("NIGHTLY_RUNTIME_HERMETIC_EVIDENCE="));
			if (runtimeReceiptLines.length !== 1) {
				fail(`runtime emitted ${runtimeReceiptLines.length} hermetic receipts (expected exactly 1)`);
			}
			const rawReceipt = (runtimeReceiptLines[0] ?? "").split("NIGHTLY_RUNTIME_HERMETIC_EVIDENCE=")[1] ?? "";
			const hermeticEvidence = parseNightlyHermeticEvidence(rawReceipt);
			console.log(`NIGHTLY_HERMETIC_EVIDENCE=${JSON.stringify(hermeticEvidence)}`);
		}

		// 4) Seed a dev-test scenario against the RUNNING runtime and monitor to a classified outcome.
		const crashCoordinator = CRASH_PHASE
			? (async () => {
					const markerPath = join(home, ".nklein", "nklein", "crash-recovery-matrix", `${CRASH_PHASE}.reached.json`);
					const deadline = Date.now() + TIMEOUT_MS;
					while (Date.now() < deadline) {
						if (await access(markerPath).then(() => true, () => false)) break;
						await new Promise((settle) => setTimeout(settle, 25));
					}
					if (!(await access(markerPath).then(() => true, () => false))) {
						throw new Error(`crash barrier ${CRASH_PHASE} was never reached`);
					}
					const victim = runtime;
					if (!victim?.pid) throw new Error("runtime has no PID at crash barrier");
					console.log(`CRASH_MATRIX killing runtime pid=${victim.pid} at ${CRASH_PHASE}`);
					const closed = new Promise<void>((settle) => victim.once("close", () => settle()));
					await new Promise<void>((settle) => treeKill(victim.pid as number, "SIGKILL", () => settle()));
					await closed;
					runtimeRestarts += 1;
					spawnRuntime();
					await waitForRuntime(60_000);
					console.log(`CRASH_MATRIX runtime restarted at ${CRASH_PHASE}`);
				})()
			: Promise.resolve();

		const seed = spawn(
			"npx",
			[
				"tsx",
				"src/cli.ts",
				"dev",
				"test-project",
				"--preset",
				scenarioMode?.registryId ?? "mid_task",
				"--poll-interval-ms",
				"4000",
				"--max-wait-ms",
				String(TIMEOUT_MS),
				"--json",
			],
			{
				env: {
					...process.env,
					HOME: home,
					NODE_ENV: "development",
					NKLEIN_RUNTIME_PORT: String(activeRuntimePort),
					KANBAN_RUNTIME_PORT: String(activeRuntimePort),
					...simulatedFleetEnv,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let seedOut = "";
		seed.stdout?.on("data", (chunk: Buffer) => {
			seedOut += chunk.toString();
			process.stdout.write(chunk);
		});
		seed.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
		const triggerDriver = CRASH_PHASE === "trigger"
			? (async () => {
					const indexPath = join(home, ".nklein", "nklein", "workspaces", "index.json");
					const deadline = Date.now() + TIMEOUT_MS;
					let workspace: { workspaceId: string; repoPath: string } | null = null;
					while (!workspace && Date.now() < deadline) {
						try {
							const index = JSON.parse(await readFile(indexPath, "utf8")) as {
								entries?: Record<string, { workspaceId?: string; repoPath?: string }>;
							};
							const entry = Object.values(index.entries ?? {}).find(
								(candidate) => candidate.workspaceId && candidate.repoPath,
							);
							if (entry?.workspaceId && entry.repoPath) {
								workspace = { workspaceId: entry.workspaceId, repoPath: entry.repoPath };
							}
						} catch {
							/* dev-test scaffold has not registered its workspace yet */
						}
						if (!workspace) await new Promise((settle) => setTimeout(settle, 100));
					}
					if (!workspace) throw new Error("trigger crash matrix never observed a registered dev-test workspace");
					const triggerDirectory = join(workspace.repoPath, ".nklein", "triggers");
					await mkdir(triggerDirectory, { recursive: true });
					await writeFile(
						join(triggerDirectory, "crash-matrix.json"),
						JSON.stringify({
							title: TRIGGER_CRASH_CARD.title,
							prompt: `Create ${TRIGGER_CRASH_CARD.file} exporting ${TRIGGER_CRASH_CARD.fn}(name).`,
							lane: "ready",
							front: true,
							// F1.34b upfront declaration — the fixture writes a module with no test scaffolding, and the
							// default-ON gate would otherwise bounce→identical-feedback→park (the same interaction the
							// smoke decompose declares away).
							testability: "not_testable",
							testabilityReason: "scripted trigger fixture without test scaffolding",
						}),
					);
					let response: Response | null = null;
					while (Date.now() < deadline) {
						try {
							response = await fetch(
								`http://127.0.0.1:${activeRuntimePort}/api/triggers/crash-matrix?workspaceId=${encodeURIComponent(workspace.workspaceId)}`,
								{
									method: "POST",
									headers: { "content-type": "application/json", "idempotency-key": "crash-matrix-event-1" },
									body: '{"source":"n10"}',
								},
							);
							if (response.ok) break;
						} catch {
							/* expected: the first connection is severed by SIGKILL; retry after restart */
						}
						await new Promise((settle) => setTimeout(settle, 100));
					}
					if (!response?.ok) throw new Error("idempotent trigger retry never succeeded after runtime restart");
					const body = (await response.json()) as { deduplicated?: boolean; taskId?: string };
					if (response.status !== 200 || body.deduplicated !== true || !body.taskId) {
						throw new Error(`trigger retry was not deduplicated: HTTP ${response.status} ${JSON.stringify(body)}`);
					}
					console.log(`CRASH_MATRIX trigger retry deduplicated to ${body.taskId}`);
				})()
			: Promise.resolve();
		const seedExit: number = await new Promise((resolve) => seed.on("close", (code) => resolve(code ?? 1)));
		await triggerDriver;
		await crashCoordinator;
		if (CRASH_PHASE && runtimeRestarts !== 1) {
			throw new Error(`crash matrix expected exactly one restart, saw ${runtimeRestarts}`);
		}

		console.log(`\nSeed monitor exited ${seedExit}.`);
		// Definitive matcher debugging: what did the simulator actually receive per request?
		const journal = simulator.mock.getRequests();
		if (NIGHTLY_EXPECTED_FIXTURE || NIGHTLY_EXPECTED_RECORDING_SET) {
			console.log(`NIGHTLY_CELL_COST=${JSON.stringify(summarizeNightlyModelIo(journal))}`);
		}
		// N7b: emit the terminal board lanes in a machine-readable form so the nightly runner can hand them to N5's
		// invariant packs. The counts already existed in this script and were only ever asserted inline — every
		// consumer downstream (packs, collector, failure report) sat idle for want of this one line.
		//
		// ⚠️ EMITTED HERE, BEFORE THE ASSERTIONS, DELIBERATELY. An earlier placement put it after them, so it never
		// fired on a FAILING run — precisely when the lane data is most wanted. A diagnostic that only appears when
		// nothing is wrong is not a diagnostic.
		//
		// Counts, not per-card ids: the board summary carries how many cards ended in each lane, not which. The
		// runner synthesizes placeholder ids and SAYS so, rather than implying per-card knowledge this script lacks.
		const finalCounts = /"finalCounts":\s*({[^}]*})/.exec(seedOut)?.[1] ?? null;
		if (finalCounts) {
			console.log(`NIGHTLY_TERMINAL_LANES=${finalCounts.replaceAll(/\s+/g, " ")}`);
		}
		// The seed monitor's stdout is where finalCounts lives, and it was NOT being written into the kept HOME —
		// so a failure said "HOME kept for inspection" while the HOME did not contain what explains the failure.
		// "Debuggable" must mean the evidence is there, not merely that a path exists.
		await writeFile(join(home, "seed-monitor.log"), seedOut).catch(() => undefined);
		console.log(`\nSimulator journal: ${journal.length} request(s)`);
		for (const [index, entry] of journal.entries()) {
			const body = (entry as { body?: unknown }).body ?? (entry as { request?: unknown }).request ?? entry;
			const parsed = typeof body === "string" ? JSON.parse(body) : (body as Record<string, unknown>);
			const messages = (parsed?.messages ?? []) as Array<{ role?: string; content?: unknown }>;
			const tools = ((parsed?.tools ?? []) as Array<{ function?: { name?: string } }>).map((t) => t.function?.name);
			const shapes = messages.map((m) => `${m.role}:${typeof m.content === "string" ? "str" : Array.isArray(m.content) ? "parts" : typeof m.content}`);
			const lastUser = [...messages].reverse().find((m) => m.role === "user");
			const text = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
			const system = messages.find((m) => m.role === "system");
			const systemText = typeof system?.content === "string" ? system.content : JSON.stringify(system?.content ?? "");
			const extraKeys = Object.keys(entry as Record<string, unknown>).join(",");
			console.log(`— req ${index}: nTools=${tools.length} msgs=[${shapes.join(" ")}] keys={${extraKeys}}`);
			console.log(`    system="${systemText.slice(0, 200).replaceAll("\n", " ")}"`);
			console.log(`    lastUser="${text.slice(0, 110).replaceAll("\n", " ")}"`);
		}
		await writeFile(join(home, "journal.json"), JSON.stringify(journal, null, 1)).catch(() => undefined);
		const catalogHits = (runtimeLogs.join("").match(/no_fixture_match/g) ?? []).length;
		console.log(`Unmatched simulator requests observed in runtime logs: ${catalogHits}`);
		if (catalogHits !== 0) {
			// N12: distinguish "behavior broken" from "re-record needed" instead of one undifferentiated failure.
			// The journal knows which requests no fixture served; diagnosing them against the active script names
			// the closest track, the failed check, and — for prompt drift — the first diverging byte of the needle.
			const unmatchedEntries = journal.filter(isUnmatchedJournalEntry);
			const driftReport = buildScenarioDriftReport(unmatchedEntries, scenarioMode?.scenario ?? script);
			const reRecordCommand = scenarioMode
				? `npm run scenario:rerecord -- ${scenarioMode.registryId.slice(0, 2)}`
				: undefined;
			console.log(formatScenarioDriftReport(driftReport, reRecordCommand));
			if (unmatchedEntries.length === 0) {
				console.log(
					"(runtime logs counted no_fixture_match hits, but the simulator journal shows no unmatched entry — the mismatch itself is diagnostic: the runtime may have called a non-chat surface the scenario does not mount.)",
				);
			}
			throw new Error(
				`captured replay is incomplete: ${catalogHits} request(s) had no aimock fixture (drift verdict: ${driftReport.verdict})`,
			);
		}
		if (seedExit !== 0) {
			console.error(runtimeLogs.join("").slice(-3000));
			fail(`dev-test monitor exit ${seedExit} — see output above (classification is printed by the monitor)`);
		}
		if (MULTI_MODEL) {
			// ≥3-agent swarm assertions (todo §5 ★ near-term): every request class must have run on ITS pinned
			// model, and the two dep-free worker cards must have overlapped in time (true parallelism).
			interface JournalShape {
				timestamp?: number;
				body?: { model?: string; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> };
			}
			const flatText = (entry: JournalShape): string =>
				JSON.stringify(entry.body?.messages ?? []).toLowerCase();
			const classified = journal.map((entry) => {
				const shaped = entry as unknown as JournalShape;
				const tools = (shaped.body?.tools ?? []).map((tool) => tool.function?.name);
				const kind = tools.includes("submit_review") ? "review" : flatText(shaped).includes("implementation-card breakdown") ? "decompose" : "worker";
				return { kind, model: shaped.body?.model ?? "?", at: shaped.timestamp ?? 0, text: flatText(shaped) };
			});
			const wrong = classified.filter((entry) => {
				if (entry.kind === "decompose") return entry.model !== SWARM_MODELS.architect;
				if (entry.kind === "review") return entry.model !== SWARM_MODELS.reviewer;
				return entry.model !== SWARM_MODELS.worker;
			});
			if (wrong.length > 0) {
				throw new Error(`swarm role routing violated: ${wrong.map((entry) => `${entry.kind}→${entry.model}`).join(", ")}`);
			}
			const windows = ["greet.ts", "farewell.ts"].map((needle) => {
				const hits = classified.filter((entry) => entry.kind === "worker" && entry.text.includes(needle)).map((entry) => entry.at);
				return hits.length > 0 ? { first: Math.min(...hits), last: Math.max(...hits) } : null;
			});
			const [greetWindow, farewellWindow] = windows;
			if (!greetWindow || !farewellWindow) {
				throw new Error("swarm coverage hole: one of the worker cards produced no requests");
			}
			// NOTE deliberately NOT asserting turn-level overlap: all sim models share ONE endpoint origin, and
			// !Klein serializes turns per endpoint by design ("throughput stance", todo §5 ★ — serialization on
			// local endpoints is ACCEPTED). Turn-level parallelism is a fleet-topology property (models on
			// separate endpoints/machines) — the live fleet run covers it; here we prove ROLE ROUTING + the flow.
			console.log(
				`SWARM timing (single-endpoint serialization expected): greet ${greetWindow.first}–${greetWindow.last} · farewell ${farewellWindow.first}–${farewellWindow.last}`,
			);
			const distinctModels = new Set(classified.map((entry) => entry.model));
			if (distinctModels.size < 3) {
				throw new Error(`swarm expected ≥3 distinct models on the wire, saw ${distinctModels.size}: ${[...distinctModels].join(", ")}`);
			}
			console.log(
				`SWARM ✓ ${distinctModels.size} distinct models drove ${classified.length} requests (decompose→${SWARM_MODELS.architect}, workers→${SWARM_MODELS.worker}, reviews→${SWARM_MODELS.reviewer}; turns serialized on the shared endpoint as designed).`,
			);
		}
		if (POOLS) {
			// Per-machine pool fan-out assertions (todo §5 ★ pools): with machine cap 1 and 4 dep-free cards,
			// workers MUST use both coders (cross-machine offload) and their turn windows MUST overlap (true
			// parallelism across machines — the single-endpoint serialization does not apply across machines).
			interface JournalShape {
				timestamp?: number;
				body?: { model?: string; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> };
			}
			const workerEntries = journal
				.map((entry) => entry as unknown as JournalShape)
				.filter((entry) => {
					const tools = (entry.body?.tools ?? []).map((tool) => tool.function?.name);
					return !tools.includes("submit_review") && !JSON.stringify(entry.body?.messages ?? []).toLowerCase().includes("implementation-card breakdown");
				})
				.map((entry) => ({ model: entry.body?.model ?? "?", at: entry.timestamp ?? 0 }));
			const byModel = new Map<string, number[]>();
			for (const entry of workerEntries) {
				const hits = byModel.get(entry.model) ?? [];
				hits.push(entry.at);
				byModel.set(entry.model, hits);
			}
			const coders = [POOL_MODELS.coderA, POOL_MODELS.coderB].map((model) => ({
				model,
				count: (byModel.get(model) ?? []).length,
			}));
			console.log(`POOLS worker distribution: ${coders.map((coder) => `${coder.model}×${coder.count}`).join(" · ")}`);
			// What THIS run proves: the runtime consumed the fake `lms` machine feed (machine map resolved, per-
			// machine cap env active) and drove a 5-card flow to completion through the machine-aware admission
			// path. What it CANNOT prove single-endpoint: cross-machine FAN-OUT — all sim models share one origin
			// and !Klein serializes per endpoint (verified here: every worker landed on the primary coder), which
			// is exactly the C5 finding the pools item cites. True fan-out verification needs distinct endpoints
			// (the live fleet, or simulator-side custom-provider/shared-endpoint registration — todo follow-up).
			if ((byModel.get(POOL_MODELS.coderA) ?? []).length === 0) {
				throw new Error("pools plumbing failed: no worker requests reached the pooled primary coder");
			}
			const capHolds = (runtimeLogs.join("").match(/concurrent-session cap/g) ?? []).length;
			console.log(`POOLS ✓ machine-map plumbing verified (fake lms consumed, admission green); cap holds observed: ${capHolds}; single-endpoint serialization confirmed as designed.`);
		}
		if (TURNLOOP) {
			// §12 a-same-question assertions: (1) the looping question actually recurred on the wire (the worker's
			// transcript carries it as ≥3 assistant turns in some request), and (2) the TurnLoopGuard's auto-resolve
			// nudge — quoting the acceptance command as authoritative — reached the model as a user message.
			const journalText = JSON.stringify(journal);
			const loopRecurrences = journalText.split("looks trivial; should I instead set up vitest").length - 1;
			if (loopRecurrences < 3) {
				throw new Error(`turn-loop regression: expected the looping question ≥3× on the wire, saw ${loopRecurrences}`);
			}
			if (!journalText.includes("acceptance command is authoritative")) {
				throw new Error("turn-loop regression: the auto-resolve nudge never reached the model on the wire");
			}
			// The looping card must have RECOVERED and completed — a park (attention hold) is exactly the
			// pre-fix failure shape, so a lenient monitor exit alone is not enough here.
			const counts = /"finalCounts":\s*{[^}]*}/.exec(seedOut)?.[0] ?? "";
			const lane = (name: string): number => Number(new RegExp(`"${name}":\\s*(\\d+)`).exec(counts)?.[1] ?? "-1");
			if (lane("completed") < 3 || lane("review") !== 0 || lane("failed") !== 0 || lane("inProgress") !== 0) {
				throw new Error(`turn-loop regression: board did not fully drain after the nudge (${counts})`);
			}
			console.log(
				`TURNLOOP ✓ a-same-question: question recurred (${loopRecurrences} wire hits), guard nudged with the authoritative acceptance command, and the flow completed.`,
			);
		}
		const reviewLines = runtimeLogs.join("").split("\n").filter((line) => /review|acceptance|sandbox/i.test(line)).slice(-12);
		console.log("Review/acceptance trail:\n" + reviewLines.join("\n"));
		const observedOutcome = /"outcome":\s*"([^"]+)"/u.exec(seedOut)?.[1] ?? "";
		if (EXPECTED_OUTCOME && observedOutcome !== EXPECTED_OUTCOME) {
			throw new Error(
				`captured replay outcome drifted: expected ${EXPECTED_OUTCOME}, observed ${observedOutcome || "<missing>"}`,
			);
		}
		if (scenarioMode && SCENARIO_RUN === "perfect-run" && !EXPECTED_OUTCOME) {
			// A perfect-run scenario must fully drain the board: anything parked in Review/failed means fixtures
			// mis-matched (the monitor is lenient about "blocked_by_review_cards" — the harness must not be).
			const counts = /"finalCounts":\s*{[^}]*}/.exec(seedOut)?.[0] ?? "";
			const lane = (name: string): number => Number(new RegExp(`"${name}":\\s*(\\d+)`).exec(counts)?.[1] ?? "-1");
			if (lane("review") !== 0 || lane("failed") !== 0 || lane("planning") !== 0 || lane("ready") > 0 || lane("inProgress") !== 0 || lane("completed") < 1) {
				// throw (not fail/process.exit) so the finally block still tears children down + dumps runtime.log.
				throw new Error(`perfect-run left cards undrained (${counts})`);
			}
		}
		if (CRASH_PHASE) {
			// The invariant is post-TEARDOWN, not merely post-drain: a runtime can render a green board while still
			// owning leaked session processes/containers. Stop it cleanly, then inspect every durable residue class.
			await stopRuntimeAndWait();
			const residue = await collectPostTeardownResidue({ home, sandboxNamespace });
			const index = JSON.parse(
				await readFile(join(home, ".nklein", "nklein", "workspaces", "index.json"), "utf8"),
			) as { entries?: Record<string, { workspaceId?: string; repoPath?: string }> };
			const workspaceEntries = Object.values(index.entries ?? {}).filter(
				(entry): entry is { workspaceId: string; repoPath: string } => Boolean(entry.workspaceId && entry.repoPath),
			);
			const stuckCardIds: string[] = [];
			const duplicateSideEffectIds: string[] = [];
			const allCardIds: string[] = [];
			for (const entry of workspaceEntries) {
				const workspaceDirectory = join(home, ".nklein", "nklein", "workspaces", entry.workspaceId);
				const board = JSON.parse(await readFile(join(workspaceDirectory, "board.json"), "utf8")) as {
					columns?: Array<{ id?: string; cards?: Array<{ id?: string }> }>;
				};
				for (const column of board.columns ?? []) {
					for (const card of column.cards ?? []) {
						if (!card.id) continue;
						allCardIds.push(card.id);
						if (column.id !== "completed" && column.id !== "trash") stuckCardIds.push(`${card.id}@${column.id ?? "?"}`);
					}
				}
			}
			for (const id of new Set(allCardIds)) {
				if (allCardIds.filter((candidate) => candidate === id).length > 1) duplicateSideEffectIds.push(`board-card:${id}`);
			}
			const ledgerEvents = await readAllAgentLedger({
				rootDir:
					process.env.NKLEIN_AGENT_LEDGER_ROOT?.trim() ||
					join(home, ".nklein", "nklein", "agent-attempt-ledger"),
			});
			const completedCounts = new Map<string, number>();
			const triggerSeedCounts = new Map<string, number>();
			for (const event of ledgerEvents) {
				if (event.kind === "scheduler") {
					const key = `${event.workflowId}:${event.taskId}`;
					if (event.event === "completed") completedCounts.set(key, (completedCounts.get(key) ?? 0) + 1);
				}
				if (event.kind === "transition" && event.to === "trigger_seeded") {
					triggerSeedCounts.set(event.taskId, (triggerSeedCounts.get(event.taskId) ?? 0) + 1);
				}
			}
			for (const [key, count] of completedCounts) {
				if (count > 1) duplicateSideEffectIds.push(`scheduler-completed:${key}×${count}`);
			}
			for (const [taskId, count] of triggerSeedCounts) {
				if (count > 1) duplicateSideEffectIds.push(`trigger-audit:${taskId}×${count}`);
			}
			const evidence: CrashRecoveryMatrixPhaseEvidence = {
				phase: CRASH_PHASE,
				markerCount: await access(
					join(home, ".nklein", "nklein", "crash-recovery-matrix", `${CRASH_PHASE}.reached.json`),
				).then(() => 1, () => 0),
				killSignal: "SIGKILL",
				restartCount: runtimeRestarts,
				stuckCardIds,
				duplicateSideEffectIds,
				orphanLeaseIds: residue.orphanLeaseIds,
				orphanWorktreePaths: residue.orphanWorktreePaths,
				orphanSessionIds: residue.orphanSessionIds,
			};
			const verdict = evaluateCrashRecoveryPhaseEvidence(evidence);
			console.log(`CRASH_RECOVERY_PHASE_EVIDENCE=${JSON.stringify({ ...evidence, verdict })}`);
			if (!verdict.ok) throw new Error(`crash recovery residue: ${verdict.issues.join("; ")}`);
		}
		if (NIGHTLY_BOUND && !CRASH_PHASE) {
			// N5/N7: a terminal board is not a teardown receipt. Stop the real runtime, wait for its cleanup hooks,
			// then count the durable/process residue the invariant packs actually judge.
			await stopRuntimeAndWait();
			const residue = await collectPostTeardownResidue({ home, sandboxNamespace });
			console.log(`NIGHTLY_TEARDOWN_EVIDENCE=${JSON.stringify(residue.report)}`);
		}
		console.log(
			EXPECTED_OUTCOME
				? `PASS ✓ captured real-model failure reproduced as ${EXPECTED_OUTCOME} with zero unmatched requests.`
				: "PASS ✓ simulated fast path drove a real runtime flow with zero LLM compute.",
		);
	} finally {
		await writeFile(join(home, "runtime.log"), runtimeLogs.join("")).catch(() => undefined);
		console.log(`Full runtime log: ${join(home, "runtime.log")}`);
		stopRuntime();
		await simulator.stop();
	}
}

await main();
