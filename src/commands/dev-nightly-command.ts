import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { defaultOnKillSwitches } from "../core/feature-flag-registry";
import {
	detectNightlyCostRegressions,
	type NightlyModelIoCost,
	parseNightlyModelIoCost,
} from "../core/nightly-cell-cost";
import { collectDrainedState, parseNightlyTeardownReport } from "../core/nightly-drain-collector";
import { buildNightlyFailureReport, summarizeNightlyFailures } from "../core/nightly-failure-report";
import {
	detectVerdictFlips,
	formatQuarantineReport,
	mergeNightlyQuarantine,
	type PairedCellRun,
	parseNightlyQuarantineFile,
	serializeNightlyQuarantineFile,
	splitVerdictsByQuarantine,
} from "../core/nightly-flake-quarantine";
import { type NightlyHermeticEvidence, parseNightlyHermeticEvidence } from "../core/nightly-hermeticity";
import { applyProfileToPack, evaluatePack, resolvePack } from "../core/nightly-invariant-pack";
import {
	type CellVerdict,
	enumerateNightlyCells,
	isNightlyOverallOk,
	type NightlyCell,
	type NightlyManifest,
	nightlyCellKey,
	nightlyCellName,
	summarizeNightlyRun,
} from "../core/nightly-manifest";
import { NIGHTLY_PACK_REGISTRY } from "../core/nightly-pack-registry";
import {
	collectNightlyPersistedStateEvidence,
	hashNightlyPersistedStateFixture,
	materializeNightlyPersistedStateFixture,
} from "../core/nightly-persisted-state-compatibility";
import { type NightlyRecordingEvidence, parseNightlyRecordingEvidence } from "../core/nightly-recording-evidence";
import { detectDurationRegressions, planNightlySchedule } from "../core/nightly-schedule";
import { extractDrainSignalEvents, OBSERVABLE_DRAIN_SIGNALS } from "../core/nightly-signal-extraction";
import { extractOperatorHold } from "../core/operator-hold-extraction";

const execFileAsync = promisify(execFile);

/**
 * N1b — `nklein dev nightly [--project <id>] [--model <profile>] [--json] [--dry-run]`.
 *
 * Manifest-driven successor to `scripts/verify-all-simulated-flows.sh`. Three properties are carried over from
 * that script deliberately, because each one is a lesson that was learned the expensive way:
 *
 *  1. **SEQUENTIAL by default.** Parallel drains of the large sets starve each other's in-scenario `npm test`
 *     steps and FALSE-TIMEOUT (live-hit 2026-07-11). A nightly suite that reports flaky failures trains people
 *     to ignore it, which is worse than having none.
 *  2. **Per-run PORT.** The harness's fixed default port is a stale-server trap: a lingering runtime from the
 *     previous cell gets "already running"-reused and reads as unreachable.
 *  3. **Isolated HOME per cell** (fresh `.nklein` + `NKLEIN_AGENT_LEDGER_ROOT`), so one cell's ledger and config
 *     cannot leak into the next and make a failure look like a different cell's problem.
 *
 * ── WHAT A GREEN RUN DOES AND DOES NOT LICENSE (P20.13) ──
 * Every cell drives a SIMULATED model. That is what makes the suite fast, hermetic and worth running — and it is
 * also its ceiling: a simulated counterpart establishes that a MECHANISM fires end-to-end, never a user-facing
 * success rate. See {@link NIGHTLY_SIMULATION_SCOPE_NOTE}, which is PRINTED with every verdict rather than left
 * here, because the over-reading happens when someone quotes "28/28 passed" without the caveat attached.
 */

/**
 * P20.13 — the SCOPE of every verdict this suite produces.
 *
 * Research on τ-bench retail found agent success swings ~9pp purely from which LLM plays the counterpart, with
 * systematic miscalibration and a fairness failure (AAVE speakers 11.2pp lower, compounding to 19pp for speakers
 * 55+). A simulated counterpart can therefore establish that a MECHANISM fires end-to-end; it cannot establish a
 * user-facing success rate.
 *
 * Exported and printed rather than left in a comment: the over-reading happens when someone quotes "28/28 passed",
 * so the caveat has to travel with the number.
 */
export const NIGHTLY_SIMULATION_SCOPE_NOTE =
	"SCOPE: these cells drive SIMULATED models. A pass proves the MECHANISM fires end-to-end; it is not a " +
	"user-facing success rate, and no green run here licenses a claim about real-model quality.";

const DEFAULT_MANIFEST_PATH = "nightly-manifest.json";
/** N13: repo-visible quarantine data (excluding a cell from the gate must survive machines and show up in diffs). */
const QUARANTINE_PATH = "nightly-quarantine.json";
/** Generous: a large scenario legitimately takes many minutes on a low-power machine. */
const CELL_TIMEOUT_MS = 45 * 60 * 1000;
/** Six sequential low-power SIGKILL drains; each phase owns the regular cell budget. */
const CRASH_RECOVERY_MATRIX_TIMEOUT_MS = 6 * CELL_TIMEOUT_MS;
/** One browser journey lane (own sim/HOME + runtime + vite + playwright); generous for low-power boots. */
const UI_JOURNEYS_TIMEOUT_MS = 10 * 60 * 1000;

async function loadManifest(path: string): Promise<NightlyManifest | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as NightlyManifest;
	} catch {
		return null;
	}
}

/**
 * Profiles the drain script actually understands, mapped onto the env var it reads.
 *
 * ⚠️ THIS MAP IS THE POINT. The first cut of this runner passed `NKLEIN_NIGHTLY_MODEL_PROFILE`, which
 * `verify-simulated-flow.mts` does not read — so every cell silently drained the DEFAULT profile while the
 * summary reported N profiles covered. Invisible from outside: all cells pass, coverage is a fraction of what it
 * claims. An unknown profile is therefore SKIPPED WITH A REASON rather than quietly falling back.
 */
/**
 * The drain script pins `seed: 7` internally and exposes no override. Recorded here so the failure report can
 * state it (N7 requires cell id + seed + HOME to be debuggable from the summary alone) rather than leaving a
 * reader to discover it by reading the script.
 *
 * ⚠️ A FIXED SEED MEANS REPEAT NIGHTLY RUNS ARE NOT INDEPENDENT SAMPLES. They re-walk one path. That is excellent
 * for reproducibility and worthless for estimating variance — so per P20.6, repeats of this suite buy NOTHING
 * statistically, because they do not resample anything. Widening coverage means more CELLS, not more runs.
 */
const NIGHTLY_FIXED_SEED = "7";

/** Where the previous run's per-cell durations live — used to order the next run fastest-first (N6). */
const LAST_RUN_PATH = join(tmpdir(), "nklein-nightly-last.json");

/** Read prior per-cell wall times, keyed `project × profile`. Absent/corrupt file = no history, not an error. */
/**
 * Turn the drain's `finalCounts` emission into per-card terminal lanes.
 *
 * Returns EMPTY on absent or unparseable input rather than guessing. N5 treats zero observed cards as
 * `indeterminate`, so an unreadable emission surfaces as "we could not tell" instead of as a clean board — which
 * is the whole reason that check exists.
 */
/**
 * Read the cell's self-observation telemetry as one blob. Empty when absent — never throws.
 *
 * N7c: this is the drain's signal evidence. Parsing lives in `nightly-signal-extraction.ts`; an absent or
 * unreadable log yields no events, which N5 reports as `indeterminate` rather than as a clean run.
 */
async function readTelemetryText(home: string): Promise<string> {
	const dir = join(home, ".nklein", "nklein", "telemetry");
	const files = await readdir(dir).catch(() => [] as string[]);
	const parts = await Promise.all(
		files.filter((name) => name.endsWith(".jsonl")).map((name) => readFile(join(dir, name), "utf8").catch(() => "")),
	);
	return parts.join("\n");
}

function parseTerminalLanes(json: string | null): { cardId: string; lane: string }[] {
	if (!json) {
		return [];
	}
	let counts: Record<string, unknown>;
	try {
		counts = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return [];
	}
	const cards: { cardId: string; lane: string }[] = [];
	for (const [lane, value] of Object.entries(counts)) {
		const total = typeof value === "number" ? Math.max(0, Math.trunc(value)) : 0;
		for (let index = 1; index <= total; index += 1) {
			cards.push({ cardId: `${lane}#${index}`, lane });
		}
	}
	return cards;
}

interface PriorCellBaseline {
	readonly durationMs?: number;
	readonly modelIoCost?: NightlyModelIoCost | null;
}

async function readPriorBaselines(): Promise<Map<string, PriorCellBaseline>> {
	try {
		const raw = JSON.parse(await readFile(LAST_RUN_PATH, "utf8")) as {
			verdicts?: {
				cell?: {
					projectId?: string;
					modelProfile?: string;
					persistedStateFixture?: { releaseVersion?: string };
				};
				durationMs?: number;
				modelIoCost?: NightlyModelIoCost | null;
			}[];
		};
		const out = new Map<string, PriorCellBaseline>();
		for (const verdict of raw.verdicts ?? []) {
			const release = verdict.cell?.persistedStateFixture?.releaseVersion;
			const key = `${verdict.cell?.projectId} × ${verdict.cell?.modelProfile}${release ? `@home-${release}` : ""}`;
			out.set(key, { durationMs: verdict.durationMs, modelIoCost: verdict.modelIoCost });
		}
		return out;
	} catch {
		return new Map();
	}
}

const PROFILE_TO_SIMFLOW_RUN: Readonly<Record<string, string>> = {
	perfect: "perfect",
	flaky: "flaky",
	// N2 no-proof mechanism profiles (each maps to a `<value>-run.json` recording): loop_park proves the
	// repeated-tool-call guard + budget_wall park with a parked-terminal pack.
	loop_park: "loop-park",
	syntax_guard: "syntax-guard",
	failover: "failover",
	taint_gate: "taint-gate",
	park_resume: "park-resume",
	// N2 standing §12 turn-loop cell (2026-07-28): runs the INLINE smoke scenario (projectId "smoke") — there is
	// no recording file; the drain digests the serialized inline script as its evidence. The profile additionally
	// needs NKLEIN_SIMFLOW_TURNLOOP=1 (see PROFILE_EXTRA_ENV) to activate the a-same-question worker + the
	// harness's own wire assertions (question recurred, guard nudged, full drain).
	turn_loop: "turnloop",
	// N11 flag-matrix lane (2026-07-29): the SAME `perfect-run` recording, replayed with every default-OFF
	// opt-in switched ON. Rationale: 29 of the 43 registered mechanisms are flag-gated, and a measurement over
	// three real campaign runs found none of them firing — not because they are broken, but because a default
	// profile can never exercise them. One profile gives all of them their chance in a single drain instead of
	// 29 bespoke cells, and needs no new recording at all.
	flags_on: "perfect",
	// N11 lane (c) (2026-08-05): the SAME perfect recording with every DEFAULT-ON kill-switch turned OFF — the
	// escape hatch each default flip promises ("opt-out: NKLEIN_X=0") proven as one drained posture, so flag
	// interactions with the defaults ABSENT are exercised rather than assumed.
	kill_switches_off: "perfect",
	// N3 per-family behavior matrix, first family (2026-08-04): the ministral/Mistral-family Jinja quirk as a
	// NEGATIVE-SPACE tripwire — the recording is the perfect run PLUS a messagesNonAlternating→500 track that
	// only a prompt-shape regression can light. Green means "!Klein never sent this family a non-alternating
	// conversation across a full drain"; red names the exact wire shape that regressed.
	ministral_quirk: "ministral-quirk",
	// N3 family 2: reasoning-channel-only models (DeepSeek-R1/qwen-think class; live-found in the eval harness:
	// "reasoning/mtp models return empty content — must read reasoning_content"). Every conversational text turn
	// of the perfect run moves its payload into the reasoning channel with EMPTY content — green proves the
	// product's reasoning_content reads survive a full drain.
	reasoning_only_quirk: "reasoning-only-quirk",
	// N3 family 3: the json_schema dead-end contract as a tripwire — the recording answers any json_schema
	// request to the reasoning-named architect with the family's real SILENT EMPTY; the structured-output
	// contract (reasoning ids -> native_tool_call, never json_schema) keeps it dark on a healthy drain.
	schema_deadend_quirk: "schema-deadend-quirk",
	// N3 family 4: the no-verdict reviewer — review-class turns are prose forever; the silent-reviewer-park
	// pack asserts the ladder parks for the operator instead of spinning (terminal shape review+planning).
	silent_reviewer_quirk: "silent-reviewer-quirk",
};

/** Per-profile env the drain needs beyond NKLEIN_SIMFLOW_RUN (kept beside the run map so they stay in sync). */
const PROFILE_EXTRA_ENV: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	turn_loop: { NKLEIN_SIMFLOW_TURNLOOP: "1" },
	// Every flag that `MECHANISM_REGISTRY` names as gating a mechanism. Kept exhaustive on purpose and guarded by
	// `nightly-flag-matrix-coverage.test.ts`, which fails when a newly registered flag is missing here — otherwise
	// this lane would silently stop covering the very mechanisms it exists to surface.
	flags_on: {
		// Added 2026-08-03 with the a2a_task_ingress registration (P17.8). Opens a QUIET loopback listener
		// route only — no replay traffic reaches it, so the drain shape is untouched; coverage here just
		// proves the flag-ON posture boots and drains clean.
		NKLEIN_A2A_SERVER: "1",
		// N11's five, validated one-at-a-time 2026-08-05 (all solo flags_on drains green) and admitted once their
		// mechanisms were actually claimable: property_gate + spec_deliberation registered (spec's emit already
		// existed unregistered), visual maps to the existing visual_delivery_gate mechanism, N_EYES was already
		// claimed via `covers` (the lane test now reads covers), EXPLORER is the documented ledger-observable class.
		NKLEIN_EXPLORER_SUBAGENT: "1",
		NKLEIN_PROPERTY_GATE: "1",
		NKLEIN_SPEC_DELIBERATION: "1",
		NKLEIN_VISUAL_GATE: "1",
		NKLEIN_N_EYES_REVIEW: "1",
		NKLEIN_ADAPTIVE_RETRY: "1",
		NKLEIN_ARCHITECT_EDITOR: "1",
		NKLEIN_BASELINE_PROBE: "1",
		// Added 2026-08-01 with the memory_freshness_audit registration. Same class as NKLEIN_SANDBOX_MCP and
		// NKLEIN_UNIFIED_MEMORY, already in this lane: it adds agent tooling rather than altering the drain shape.
		NKLEIN_BASIC_MEMORY: "1",
		NKLEIN_DRIFT_CRITIC: "1",
		NKLEIN_FEWSHOT_EXEMPLARS: "1",
		NKLEIN_FLEET_AWARE_DECOMPOSE: "1",
		NKLEIN_FOCUS_CHAIN_NUDGE: "1",
		NKLEIN_GOAL_REANCHOR: "1",
		NKLEIN_HISTORY_BLIND_CORRECTOR: "1",
		NKLEIN_KNOWS_TODAY: "1",
		NKLEIN_LEDGER_EXEMPLARS: "1",
		NKLEIN_NATIVE_FORCE_TOOL_CALL: "1",
		NKLEIN_OPPORTUNISTIC_IDLE_WORK: "1",
		NKLEIN_PROCEDURAL_SKILLS: "1",
		NKLEIN_QUEUE_AWARE_FREE_FIRST: "1",
		NKLEIN_REASONING_BREACH: "1",
		NKLEIN_RESIDENCY_HEARTBEAT: "1",
		NKLEIN_REVIEW_LENSES: "1",
		NKLEIN_REVIEW_PANEL: "1",
		NKLEIN_RUNAWAY_ABORT: "1",
		NKLEIN_SKILL_PROMPT_FRAGMENTS: "1",
		NKLEIN_SPEC_LINT: "1",
		NKLEIN_STALL_REPLAN: "1",
		NKLEIN_TOOL_GATE_OBSERVE: "1",
		NKLEIN_TWO_PHASE_TOOL_PICK: "1",
		NKLEIN_TYPECHECK_FIRST: "1",
		NKLEIN_UNIFIED_MEMORY: "1",
		NKLEIN_VERIFICATION_FIRST: "1",
		NKLEIN_SANDBOX_MCP: "1",
		NKLEIN_TEST_DRIVEN_MODE: "1",
		NKLEIN_TOOL_TRUST_DECAY: "1",
	},
	// N11 lane (c): every DEFAULT-ON kill-switch OFF, built from the registry so a newly shipped default-ON flag
	// joins this lane automatically instead of drifting past it. "off" is the one disable value every registered
	// kill-switch gate honors (isEnabledByDefaultEnv, both /^(0|false|off)$/i gates, and the model-sensitive-prune
	// `!== "off"` gate) — the lane test pins that a new default-ON flag keeps honoring it.
	kill_switches_off: Object.fromEntries(defaultOnKillSwitches().map((flag) => [flag, "off"])),
};

async function runCell(cell: NightlyCell): Promise<CellVerdict> {
	const started = Date.now();
	let home: string;
	try {
		home = await mkdtemp(join(tmpdir(), `nklein-nightly-${cell.projectId}-`));
	} catch (error) {
		return { cell, outcome: "skipped", reason: `could not create an isolated HOME: ${String(error)}` };
	}
	if (cell.persistedStateFixture) {
		try {
			await materializeNightlyPersistedStateFixture({ fixture: cell.persistedStateFixture, targetHome: home });
		} catch (error) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `could not materialize the registered persisted-state fixture: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
	const simflowRun = PROFILE_TO_SIMFLOW_RUN[cell.modelProfile];
	if (simflowRun === undefined) {
		return {
			cell,
			outcome: "skipped",
			reason: `model profile "${cell.modelProfile}" is not one the drain script understands (${Object.keys(PROFILE_TO_SIMFLOW_RUN).join(", ")}) — SKIPPED rather than silently draining the default profile, which would report coverage this run did not have`,
		};
	}
	try {
		const { stdout } = await execFileAsync("npx", ["tsx", "scripts/verify-simulated-flow.mts"], {
			timeout: CELL_TIMEOUT_MS,
			maxBuffer: 32 * 1024 * 1024,
			env: {
				...process.env,
				HOME: home,
				NKLEIN_AGENT_LEDGER_ROOT: join(home, "ledger"),
				NKLEIN_SIMFLOW_SCENARIO: cell.projectId,
				// These fields used to be decorative manifest prose. The drain now refuses to run if either does not
				// resolve to the exact scenario it opened, and emits a digest-bound receipt for the bytes it served.
				NKLEIN_NIGHTLY_EXPECTED_FIXTURE: cell.fixture,
				NKLEIN_NIGHTLY_EXPECTED_RECORDING_SET: cell.recordingSet,
				// The profile must reach the variable the script READS, not a name only this runner knows.
				NKLEIN_SIMFLOW_RUN: simflowRun,
				NKLEIN_NIGHTLY_RECORDING_SET: cell.recordingSet,
				// N4: activates the runtime's deterministic clock/mtime/power/watchdog seams. The child emits a
				// typed receipt and this parent refuses a clean exit without exactly one matching receipt.
				NKLEIN_NIGHTLY_HERMETIC: "1",
				...(PROFILE_EXTRA_ENV[cell.modelProfile] ?? {}),
			},
		});
		// F11.4c: a drain that leaves unmatched aimock requests did not cover what the run did. The summary core
		// refuses to call such a run ok, so surface the count rather than swallowing it.
		// SAFETY of the `?? "0"` default (verified 2026-07-20): a missing "Unmatched…" line would otherwise read as
		// "0 unmatched" = clean coverage the run may not have had — the silent-failure class this suite guards. It is
		// safe ONLY because we reach here exclusively on a subprocess exit 0, and verify-simulated-flow's fail() does
		// process.exit(1) on every failure BEFORE it prints that line (any non-zero exit rejects execFileAsync → the
		// catch below → a failure verdict, never this "passed" branch). So a clean exit always printed the line first.
		// If that script is ever changed to succeed without printing it, this default silently under-reports — treat
		// the fail()-forces-nonzero-exit contract as load-bearing here, not incidental.
		const unmatched = Number.parseInt(/unmatched[^0-9]*(\d+)/i.exec(stdout)?.[1] ?? "0", 10);
		const receiptLines = stdout.split(/\r?\n/).filter((line) => line.startsWith("NIGHTLY_RECORDING_EVIDENCE="));
		if (receiptLines.length !== 1) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `drain exited cleanly with ${receiptLines.length} NIGHTLY_RECORDING_EVIDENCE receipts (expected exactly 1); refusing to claim that the manifest's fixture/recording set was exercised`,
			};
		}
		let recordingEvidence: NightlyRecordingEvidence;
		try {
			recordingEvidence = parseNightlyRecordingEvidence({
				raw: (receiptLines[0] ?? "").slice("NIGHTLY_RECORDING_EVIDENCE=".length),
				expectedFixture: cell.fixture,
				expectedRecordingSet: cell.recordingSet,
				expectedRunFile: `${simflowRun}-run.json`,
			});
		} catch (error) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `invalid NIGHTLY_RECORDING_EVIDENCE: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const costLines = stdout.split(/\r?\n/).filter((line) => line.startsWith("NIGHTLY_CELL_COST="));
		if (costLines.length !== 1) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `drain exited cleanly with ${costLines.length} NIGHTLY_CELL_COST receipts (expected exactly 1); refusing to hide an unmeasured nightly cell`,
			};
		}
		let modelIoCost: NightlyModelIoCost;
		try {
			modelIoCost = parseNightlyModelIoCost((costLines[0] ?? "").slice("NIGHTLY_CELL_COST=".length));
		} catch (error) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `invalid NIGHTLY_CELL_COST: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const hermeticLines = stdout.split(/\r?\n/).filter((line) => line.startsWith("NIGHTLY_HERMETIC_EVIDENCE="));
		if (hermeticLines.length !== 1) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `drain exited cleanly with ${hermeticLines.length} NIGHTLY_HERMETIC_EVIDENCE receipts (expected exactly 1); refusing a host-dependent nightly verdict`,
			};
		}
		let hermeticEvidence: NightlyHermeticEvidence;
		try {
			hermeticEvidence = parseNightlyHermeticEvidence(
				(hermeticLines[0] ?? "").slice("NIGHTLY_HERMETIC_EVIDENCE=".length),
			);
		} catch (error) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `invalid NIGHTLY_HERMETIC_EVIDENCE: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		const teardownLines = stdout.split(/\r?\n/).filter((line) => line.startsWith("NIGHTLY_TEARDOWN_EVIDENCE="));
		if (teardownLines.length !== 1) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `drain exited cleanly with ${teardownLines.length} NIGHTLY_TEARDOWN_EVIDENCE receipts (expected exactly 1); refusing to replace post-shutdown inspection with assumed zeroes`,
			};
		}
		let teardownEvidence: CellVerdict["teardownEvidence"];
		try {
			teardownEvidence = parseNightlyTeardownReport(
				(teardownLines[0] ?? "").slice("NIGHTLY_TEARDOWN_EVIDENCE=".length),
			);
		} catch (error) {
			return {
				cell,
				outcome: "failed",
				durationMs: Date.now() - started,
				homePath: home,
				reason: `invalid NIGHTLY_TEARDOWN_EVIDENCE: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		let persistedStateEvidence: CellVerdict["persistedStateEvidence"];
		if (cell.persistedStateFixture) {
			try {
				persistedStateEvidence = await collectNightlyPersistedStateEvidence({
					fixture: cell.persistedStateFixture,
					home,
				});
			} catch (error) {
				return {
					cell,
					outcome: "failed",
					durationMs: Date.now() - started,
					homePath: home,
					reason: `persisted-state compatibility oracle failed: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}
		return {
			cell,
			outcome: "passed",
			durationMs: Date.now() - started,
			unmatchedRequests: Number.isFinite(unmatched) ? unmatched : 0,
			// N7b: the drain now emits its terminal board lanes. Absent leaves this null, which N5 reports as
			// `indeterminate` rather than as a pass.
			terminalLanesJson: /NIGHTLY_TERMINAL_LANES=(\{[^\n]*\})/.exec(stdout)?.[1] ?? null,
			homePath: home,
			recordingEvidence,
			modelIoCost,
			hermeticEvidence,
			teardownEvidence,
			...(persistedStateEvidence ? { persistedStateEvidence } : {}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			cell,
			outcome: "failed",
			durationMs: Date.now() - started,
			homePath: home,
			reason: // 300 chars cut the failure mid-`finalCounts` on the first real run, hiding the lane data that explained it.
				// The report is the artifact that survives, so it should not economise on the part that diagnoses.
				`${message.slice(0, 1200)} (isolated HOME kept for inspection: ${home}; seed monitor output at ${join(home, "seed-monitor.log")})`,
		};
	}
}

export async function runDevNightlyCommand(options: {
	project?: string;
	model?: string;
	manifest?: string;
	json?: boolean;
	dryRun?: boolean;
	/** N13 (pre-release): run every cell twice; a verdict flip quarantines the cell until root-caused. */
	doubleRun?: boolean;
	/** Retain a PASSING cell's isolated HOME. Failures always retain theirs. */
	keepHome?: boolean;
}): Promise<void> {
	const manifestPath = options.manifest ?? DEFAULT_MANIFEST_PATH;
	const manifest = await loadManifest(manifestPath);
	if (!manifest) {
		process.stdout.write(
			`No nightly manifest at ${manifestPath}. Registration is DATA: add one entry per project ({id, fixture, recordingSet, invariantPack, modelProfiles}) and this command picks it up with no code change.\n`,
		);
		process.exitCode = 1;
		return;
	}

	const enumerated = enumerateNightlyCells(manifest, { project: options.project, model: options.model });

	// N6: order fastest-first from the PREVIOUS run's durations, so a failure surfaces at minute 4 rather than
	// hour 3. Execution stays strictly sequential (maxParallel 1) — the ordering is the whole gain here, and the
	// parallelism half is what makes the two largest projects false-timeout.
	const prior = await readPriorBaselines();
	const plan = planNightlySchedule({
		cells: enumerated.map((cell) => ({
			id: nightlyCellKey(cell),
			lastDurationMs: prior.get(nightlyCellKey(cell))?.durationMs ?? null,
		})),
		maxParallel: 1,
	});
	const byKey = new Map(enumerated.map((cell) => [nightlyCellKey(cell), cell]));
	// planNightlySchedule throws CoverageWeakenedError rather than silently dropping a cell, so this cannot narrow
	// the suite; the filter is a type narrowing, not a safety net.
	const cells = plan.scheduledCells.map((id) => byKey.get(id)).filter((cell): cell is NightlyCell => Boolean(cell));
	// N1 said "registration is DATA", and nothing validated that data against reality. A cell naming a scenario
	// that does not exist was registered for weeks and could NEVER pass — found 2026-07-20 by actually running it.
	// A dry run that does not check this tells you the shape of a run, not whether it can work.
	const scenarioDir = "packages/llm-simulator/scenarios";
	let scenarioNames: string[] = [];
	try {
		scenarioNames = await readdir(scenarioDir);
	} catch {
		scenarioNames = [];
	}
	// Two corrections, both from a fully GREEN 28/28 run on 2026-07-30 that this check nonetheless failed:
	//
	// (1) INLINE cells have no on-disk recording BY DESIGN — their evidence digest binds the harness's in-code
	//     script instead (the `smoke×turn_loop` cell, registered 2026-07-28; the same category is documented in
	//     `nightly-smallest-tranche-integrity.test.ts`, which excludes them from the tranche cost accounting).
	//     Reporting "these cells cannot pass" about a cell that PASSED is the confident-wrong-verdict failure this
	//     very check exists to prevent, and it fired on every single run.
	// (2) It also set `process.exitCode = 1`, so a nightly reporting `ok: true, 28 passed, 0 failed` still EXITED
	//     NON-ZERO. Any CI step or script gating on exit status read a green suite as a red one. The exit code now
	//     tracks only genuinely unmatched registrations.
	//
	// Matching moved from projectId-prefix to the FIXTURE, which is the exact directory name — strictly more
	// precise (it would also catch a project whose id matches a directory but whose fixture does not, previously
	// invisible), and verified to flag nothing new against the current manifest.
	const isInlineScenarioFixture = (fixture: string): boolean => fixture.endsWith("-inline");
	const unmatched =
		scenarioNames.length === 0
			? []
			: [...new Set(cells.filter((cell) => !isInlineScenarioFixture(cell.fixture)).map((cell) => cell.fixture))]
					.filter((fixture) => !scenarioNames.includes(fixture))
					.sort();
	if (unmatched.length > 0) {
		process.stdout.write(
			`⚠️ ${unmatched.length} registered cell(s) name a fixture with NO scenario under ${scenarioDir}: ${unmatched.join(", ")}\n` +
				`   These cells cannot pass. Registration is data, and this is the check that the data is real.\n\n`,
		);
		process.exitCode = 1;
	}
	const compatibilityFixtureProblems: string[] = [];
	for (const cell of cells) {
		if (!cell.persistedStateFixture) continue;
		try {
			const actual = await hashNightlyPersistedStateFixture(cell.persistedStateFixture.fixtureRoot);
			if (actual !== cell.persistedStateFixture.fixtureSha256) {
				compatibilityFixtureProblems.push(
					`${nightlyCellName(cell)} expected sha256:${cell.persistedStateFixture.fixtureSha256}, got sha256:${actual}`,
				);
			}
		} catch (error) {
			compatibilityFixtureProblems.push(
				`${nightlyCellName(cell)} could not validate its fixture: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (compatibilityFixtureProblems.length > 0) {
		process.stdout.write(
			`⚠️ ${compatibilityFixtureProblems.length} persisted-state fixture problem(s):\n${compatibilityFixtureProblems.map((problem) => `  ${problem}`).join("\n")}\n\n`,
		);
		process.exitCode = 1;
	}

	if (options.dryRun) {
		process.stdout.write(
			`${cells.length} cell(s) would run SEQUENTIALLY (fastest-first from prior durations)${options.doubleRun ? ", EACH TWICE (N13 double-run flake screen)" : ""}:\n`,
		);
		for (const cell of cells) {
			process.stdout.write(`  ${nightlyCellName(cell)}  (kernel-ephemeral port, set ${cell.recordingSet})\n`);
		}
		if (manifest.crashRecoveryMatrix?.enabled && !options.project && !options.model) {
			process.stdout.write("  crash-recovery-matrix  (6 sequential real-runtime SIGKILL phase drains)\n");
		}
		if (manifest.uiJourneys?.enabled && !options.project && !options.model) {
			process.stdout.write(
				"  ui-journeys            (N14 browser lanes: drained board + review-merge + review-bounce)\n",
			);
		}
		return;
	}

	const verdicts: CellVerdict[] = [];
	const keepHome = options.keepHome === true;
	const doubleRunPairs: PairedCellRun[] = [];
	for (const [index, cell] of cells.entries()) {
		process.stderr.write(`== ${nightlyCellName(cell)} (${index + 1}/${cells.length}) ==\n`);
		// SEQUENTIAL: awaited inside the loop, deliberately. See the docblock.
		const first = await runCell(cell);
		verdicts.push(first);
		if (options.doubleRun) {
			// N13: the second, identical run. A deterministic cell repeats its verdict; a flip is the finding.
			process.stderr.write(`== ${nightlyCellName(cell)} (${index + 1}/${cells.length}) — double-run pass 2 ==\n`);
			const second = await runCell(cell);
			doubleRunPairs.push({
				cellId: nightlyCellName(cell),
				first: { outcome: first.outcome, reason: first.reason ?? null },
				second: { outcome: second.outcome, reason: second.reason ?? null },
			});
		}
	}
	// N13: quarantine is read on EVERY run (a quarantined cell stays out of the gate until a human clears it),
	// and double-run flips join it durably in the same pass.
	const priorQuarantine = parseNightlyQuarantineFile(await readFile(QUARANTINE_PATH, "utf8").catch(() => null));
	const newlyQuarantined = options.doubleRun ? detectVerdictFlips(doubleRunPairs, new Date().toISOString()) : [];
	const quarantine = mergeNightlyQuarantine(priorQuarantine, newlyQuarantined);
	if (newlyQuarantined.length > 0) {
		await writeFile(QUARANTINE_PATH, serializeNightlyQuarantineFile(quarantine), "utf8");
	}
	const quarantineSplit = splitVerdictsByQuarantine(verdicts, (verdict) => nightlyCellName(verdict.cell), quarantine);
	let crashRecoveryMatrix: {
		outcome: "passed" | "failed" | "not_selected";
		reason: string;
		evidence: unknown | null;
	} = { outcome: "not_selected", reason: "not enabled or a project/model filter selected", evidence: null };
	if (manifest.crashRecoveryMatrix?.enabled && !options.project && !options.model) {
		process.stderr.write("== crash-recovery-matrix (standing N10 lane) ==\n");
		try {
			const { stdout, stderr } = await execFileAsync("npx", ["tsx", "scripts/verify-crash-recovery-matrix.mts"], {
				timeout: CRASH_RECOVERY_MATRIX_TIMEOUT_MS,
				maxBuffer: 20 * 1024 * 1024,
			});
			if (stderr) process.stderr.write(stderr);
			const receiptLines = stdout
				.split(/\r?\n/)
				.filter((line) => line.startsWith("CRASH_RECOVERY_MATRIX_EVIDENCE="));
			if (receiptLines.length !== 1) {
				throw new Error(
					`matrix exited cleanly with ${receiptLines.length} aggregate receipt(s), expected exactly one`,
				);
			}
			const evidence = JSON.parse((receiptLines[0] ?? "").slice("CRASH_RECOVERY_MATRIX_EVIDENCE=".length)) as {
				verdict?: { ok?: boolean; issues?: string[] };
			};
			if (evidence.verdict?.ok !== true) {
				throw new Error(`matrix receipt is not green: ${(evidence.verdict?.issues ?? []).join("; ")}`);
			}
			crashRecoveryMatrix = {
				outcome: "passed",
				reason: "all six SIGKILL phase receipts passed",
				evidence,
			};
		} catch (error) {
			crashRecoveryMatrix = {
				outcome: "failed",
				reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
				evidence: null,
			};
		}
	}

	// N14: the browser journey lanes — same manifest-gated shape as the crash matrix. Each launcher owns its
	// full stack (sim/drained HOME + runtime + vite + playwright) and prints a definitive PASS line; both must
	// exit 0. Skipped under project/model filters exactly like the matrix.
	let uiJourneys: { outcome: "passed" | "failed" | "not_selected"; reason: string } = {
		outcome: "not_selected",
		reason: "not enabled or a project/model filter selected",
	};
	if (manifest.uiJourneys?.enabled && !options.project && !options.model) {
		process.stderr.write("== ui-journeys (N14 browser lanes) ==\n");
		const lanes: { script: string; passLine: string }[] = [
			{ script: "scripts/ui-journey-drained.mts", passLine: "DRAINED JOURNEYS PASS" },
			{ script: "scripts/ui-journey-review.mts", passLine: "REVIEW JOURNEY PASS" },
			{ script: "scripts/ui-journey-bounce.mts", passLine: "BOUNCE JOURNEY PASS" },
		];
		const laneReasons: string[] = [];
		let allPassed = true;
		for (const lane of lanes) {
			try {
				const { stdout, stderr } = await execFileAsync("npx", ["tsx", lane.script], {
					timeout: UI_JOURNEYS_TIMEOUT_MS,
					maxBuffer: 20 * 1024 * 1024,
				});
				if (stderr) process.stderr.write(stderr);
				if (!stdout.includes(lane.passLine)) {
					throw new Error(`${lane.script} exited 0 without its PASS line`);
				}
				laneReasons.push(`${lane.script}: pass`);
			} catch (error) {
				allPassed = false;
				laneReasons.push(`${lane.script}: ${error instanceof Error ? error.message.slice(0, 400) : String(error)}`);
			}
		}
		uiJourneys = {
			outcome: allPassed ? "passed" : "failed",
			reason: laneReasons.join(" · "),
		};
	}

	// N13: the gate sees only non-quarantined cells; quarantined ones still ran and are reported loudly below.
	const summary = summarizeNightlyRun(quarantineSplit.gated);

	// N7: every failing cell gets a report that is checked for being ACTIONABLE, not merely printed. A failure the
	// next morning cannot be re-run — the state is gone — so the summary is the only artifact that survives.
	// N7d: a cell can fail because a card is HELD FOR THE OPERATOR — a deliberate fail-closed hold
	// (`nklein-sandbox-review-finalizer.ts`: "an explicit operator hold ... a manual redrive starts cleanly"),
	// not a defect. Unattended, that hold blocks every dependent card and the run reports "left cards undrained",
	// which reads as a bug when it is the system doing exactly what it was told.
	//
	// This NAMES the case; it deliberately does NOT change the verdict. Whether an operator hold should count as
	// a nightly pass is a product decision (see N7d's options a/b/c) and not one a reporting change should make
	// quietly.
	// N16: assemble REPRODUCIBLE evidence for an operator hold, not just a note. The remedy is a product
	// decision; the detection and the evidence are what let one be made.
	const operatorHoldNote = async (home: string | null, cellId: string): Promise<string> => {
		if (!home) {
			return "";
		}
		// This function is now a FILE READER only. All parsing moved to `operator-hold-extraction.ts`, because both
		// defects found by running this against a real retained HOME were in the parsing — the reason code read
		// from the wrong source, and an unscoped branch match that returned s00's branch for a hold on s03. Neither
		// threw; both produced a complete-looking report with the two decisive fields wrong. That logic is now
		// pure and pinned by an acceptance fixture built from that run's actual strings.
		const runtimeLog = await readFile(join(home, "runtime.log"), "utf8").catch(() => "");
		const telemetryText = await readTelemetryText(home);

		// null (not "") when no board was readable: the extractor reports UNKNOWN dependents rather than zero, and
		// zero is the reading that makes a run which stalled 21 cards look harmless.
		let boardJson: string | null = null;
		try {
			const boards = await readdir(join(home, ".nklein", "nklein", "workspaces"));
			for (const entry of boards) {
				const raw = await readFile(
					join(home, ".nklein", "nklein", "workspaces", entry, "board.json"),
					"utf8",
				).catch(() => "");
				if (raw) {
					boardJson = raw;
					break;
				}
			}
		} catch {
			// Leave it null — "could not read the board" stays distinct from "no dependents".
		}

		return (
			extractOperatorHold({ runtimeLog, telemetryText, boardJson, cellId, seed: NIGHTLY_FIXED_SEED })?.note ?? ""
		);
	};

	const failureReports = await Promise.all(
		verdicts
			.filter((verdict) => verdict.outcome === "failed")
			.map(async (verdict) => {
				const home = verdict.homePath ?? null;
				const holdNote = await operatorHoldNote(home, nightlyCellName(verdict.cell));
				return buildNightlyFailureReport({
					cellId: nightlyCellName(verdict.cell),
					seed: NIGHTLY_FIXED_SEED,
					homePath: home,
					homeRetained: home !== null,
					packResult: null,
					error: `${verdict.reason ?? ""}${holdNote}`.trim() || null,
					durationMs: verdict.durationMs ?? null,
				});
			}),
	);
	// N5/N5b/N7: resolve each cell's invariant pack and judge the drained state against it.
	//
	// ⚠️ `subscriptions` IS DELIBERATELY ALMOST EMPTY, and that is the honest wire rather than a stub. The runner
	// observes exactly one thing today: the unmatched-request count it greps out of stdout. It does NOT subscribe
	// to board lanes or to any gate/guard signal. N5b refuses to derive `watchedSignals` from the pack precisely so
	// this shows up as `indeterminate` instead of as a pass — the alternative would report coverage the nightly does
	// not have, which is the failure the whole design exists to prevent.
	//
	// So the packs currently assert little, and the output SAYS SO. That is the correct starting state: signals get
	// added to a pack when the collector can genuinely observe them, never in advance of that.
	const packEvaluations = await Promise.all(
		quarantineSplit.gated
			.filter((verdict) => verdict.outcome === "passed")
			.map(async (verdict) => {
				const resolved = resolvePack(verdict.cell.invariantPack, NIGHTLY_PACK_REGISTRY);
				if (!resolved) {
					return {
						passed: false,
						text: `${nightlyCellName(verdict.cell)}: invariant pack "${verdict.cell.invariantPack}" is NOT REGISTERED — nothing was asserted for this cell`,
					};
				}
				// N5: specialize for the cell's profile — a flaky cell's injected-fault noise is exempt from the
				// quiet checks the pack declares exemptions for (see quietExemptionsByProfile).
				const pack = applyProfileToPack(resolved, verdict.cell.modelProfile);
				if (!verdict.teardownEvidence) {
					return {
						passed: false,
						text: `${nightlyCellName(verdict.cell)}: teardown evidence is ABSENT — no clean-shutdown claim was asserted`,
					};
				}
				// N7c: real signal events, read from the drain's own self-observation log.
				const extraction = extractDrainSignalEvents(
					verdict.homePath ? await readTelemetryText(verdict.homePath) : "",
				);
				const collected = collectDrainedState({
					drainStartedAt: 0,
					// SUBSCRIBE TO THE OBSERVABLE SET, NOT TO WHAT FIRED.
					//
					// Deriving subscriptions from fired signals made `mustStayQuiet` **unassertable by construction**:
					// a signal that stays quiet never appears in the fired set, so it was never watched, so it reported
					// `indeterminate` forever. Every "this must not happen" assertion in every pack was silently
					// incapable of passing — and `indeterminate` reads as caution rather than as a bug, which is why it
					// survived being run.
					//
					// This is still not the shortcut N7c forbids. `OBSERVABLE_DRAIN_SIGNALS` lists only signals
					// confirmed to reach the self-observation sink, which is an unconditional listener established
					// before the drain starts. A signal a pack names but this list omits stays `indeterminate` — the
					// safe direction, and the one that makes an omission visible instead of flattering.
					subscriptions: OBSERVABLE_DRAIN_SIGNALS.map((signal) => ({ signal, registeredAt: 0 })),
					events: extraction.events,
					// The drain's terminal lanes are not exposed to this runner yet, so no card state is claimed.
					// N7b: real terminal lanes, parsed from the drain's own emission. The board reports COUNTS per lane,
					// not per-card ids, so ids are synthesized (`completed#1`) and that is stated rather than disguised —
					// the lane assertion needs only the lane, and inventing plausible real ids would imply knowledge this
					// runner does not have.
					terminalCards: parseTerminalLanes(verdict.terminalLanesJson ?? null),
					unmatchedAimockRequests: verdict.unmatchedRequests ?? 0,
					teardown: verdict.teardownEvidence,
				});
				const evaluation = evaluatePack(pack, collected.state);
				return {
					passed: evaluation.passed,
					cellKey: nightlyCellKey(verdict.cell),
					text: `${nightlyCellName(verdict.cell)}: ${evaluation.summary} [${extraction.summary}]`,
				};
			}),
	);
	const packVerdicts = packEvaluations.map((evaluation) => evaluation.text);
	const invariantPacksOk = packEvaluations.every((evaluation) => evaluation.passed);
	// A PASSED cell's isolated HOME is removed only NOW — after pack evaluation, which re-reads the HOME's
	// telemetry (extractDrainSignalEvents above). The first version of this cleanup lived inside runCell, and
	// deleting the HOME there silently destroyed the telemetry the packs were about to read: every passing
	// non-`--keep-home` run violated `must_fire:agent_sandbox_result_patch` + `second_opinion_review_session`
	// with "[No signal events were readable from telemetry]", masquerading as a flaky pack (filed as N19 before
	// the root cause surfaced — the "flake" was exactly correlated with the --keep-home flag). Failures always
	// retain their HOME for diagnosis; the leak this cleanup exists for (331 HOMEs / 6.3 GB, 2026-08-01) is
	// still closed, one phase later.
	// Chip task_3d5b0ac9 (2026-08-04): "passed" here is the DRAIN-level outcome — a cell whose invariant
	// PACK violated used to lose its HOME too, so diagnosing a pack violation cost a full --keep-home re-run
	// (hit twice the day this landed). Pack-violated cells now retain their HOME like failed cells do; the
	// leak protection (331 HOMEs / 6.3 GB) still applies to genuinely green cells.
	const packViolatedCellKeys = new Set(
		packEvaluations.filter((evaluation) => !evaluation.passed).map((evaluation) => evaluation.cellKey),
	);
	if (!keepHome) {
		for (const verdict of verdicts) {
			if (
				verdict.outcome === "passed" &&
				verdict.homePath &&
				!packViolatedCellKeys.has(nightlyCellKey(verdict.cell))
			) {
				await rm(verdict.homePath, { recursive: true, force: true }).catch(() => undefined);
			}
		}
	}
	const overallOk = isNightlyOverallOk({
		cellsOk: summary.ok,
		crashRecoveryOk: crashRecoveryMatrix.outcome !== "failed",
		invariantPacksOk,
		uiJourneysOk: uiJourneys.outcome !== "failed",
	});
	const quarantineReport = formatQuarantineReport({ file: quarantine, newlyQuarantined });
	if (quarantineReport && !options.json) {
		process.stdout.write(`\n${quarantineReport}\n`);
	}
	if (packVerdicts.length > 0 && !options.json) {
		process.stdout.write(`\nInvariant packs:\n`);
		for (const line of packVerdicts) {
			process.stdout.write(`  ${line}\n`);
		}
	}
	const recordingReceipts = verdicts.filter(
		(verdict): verdict is CellVerdict & { recordingEvidence: NonNullable<CellVerdict["recordingEvidence"]> } =>
			verdict.recordingEvidence != null,
	);
	if (recordingReceipts.length > 0 && !options.json) {
		process.stdout.write(`\nRecording receipts (${recordingReceipts.length}/${verdicts.length} cells):\n`);
		for (const verdict of recordingReceipts) {
			const evidence = verdict.recordingEvidence;
			process.stdout.write(
				`  ${nightlyCellName(verdict.cell)}: ${evidence.fixture}/${evidence.runFile} · ${evidence.setId} · sha256:${evidence.sha256}\n`,
			);
		}
	}
	const costReceipts = verdicts.filter(
		(verdict): verdict is CellVerdict & { modelIoCost: NightlyModelIoCost } => verdict.modelIoCost != null,
	);
	if (costReceipts.length > 0 && !options.json) {
		process.stdout.write(
			`\nModel-I/O cost (${costReceipts.length}/${verdicts.length} cells; exact bytes, not estimated tokens):\n`,
		);
		for (const verdict of costReceipts) {
			const measured = verdict.modelIoCost;
			process.stdout.write(
				`  ${nightlyCellName(verdict.cell)}: ${measured.modelRequests} request(s) · ${measured.requestBytes} input B + ${measured.responseBytes} response B = ${measured.totalBytes} B\n`,
			);
		}
	}
	const persistedStateReceipts = verdicts.filter(
		(
			verdict,
		): verdict is CellVerdict & {
			persistedStateEvidence: NonNullable<CellVerdict["persistedStateEvidence"]>;
		} => verdict.persistedStateEvidence != null,
	);
	if (persistedStateReceipts.length > 0 && !options.json) {
		process.stdout.write(`\nPersisted-state compatibility receipts (${persistedStateReceipts.length}):\n`);
		for (const verdict of persistedStateReceipts) {
			const evidence = verdict.persistedStateEvidence;
			process.stdout.write(
				`  ${nightlyCellName(verdict.cell)}: v${evidence.workspaceMigration.fromVersion}→v${evidence.workspaceMigration.toVersion} · ${evidence.ledger.legacyEvents}+${evidence.ledger.currentEvents} ledger events · ${evidence.ledger.corruptRecordsSkipped} corrupt record(s) skipped · sha256:${evidence.fixtureSha256}\n`,
			);
		}
	}
	if (crashRecoveryMatrix.outcome !== "not_selected" && !options.json) {
		process.stdout.write(
			`\nCrash-recovery matrix: ${crashRecoveryMatrix.outcome.toUpperCase()} — ${crashRecoveryMatrix.reason}\n`,
		);
	}
	if (uiJourneys.outcome !== "not_selected" && !options.json) {
		process.stdout.write(`\nUI journeys: ${uiJourneys.outcome.toUpperCase()} — ${uiJourneys.reason}\n`);
	}

	// N6: the suite watching its OWN cost. A cell drifting 40s -> 200s is a product regression that presents as
	// "the nightly got slower" and is usually absorbed rather than investigated.
	const regressions = detectDurationRegressions(
		verdicts.map((verdict) => ({
			cellId: nightlyCellName(verdict.cell),
			baselineMs: prior.get(nightlyCellKey(verdict.cell))?.durationMs ?? null,
			currentMs: verdict.durationMs ?? 0,
		})),
	);
	const costRegressions = detectNightlyCostRegressions(
		verdicts
			.filter((verdict): verdict is CellVerdict & { modelIoCost: NightlyModelIoCost } => verdict.modelIoCost != null)
			.map((verdict) => ({
				cellId: nightlyCellName(verdict.cell),
				baseline: prior.get(nightlyCellKey(verdict.cell))?.modelIoCost ?? null,
				current: verdict.modelIoCost,
			})),
	);
	if (regressions.length > 0 && !options.json) {
		process.stdout.write(`\n${regressions.length} cell(s) got materially slower:\n`);
		for (const regression of regressions) {
			process.stdout.write(`  ${regression.detail}\n`);
		}
	}
	if (costRegressions.length > 0 && !options.json) {
		process.stdout.write(`\n${costRegressions.length} cell cost metric(s) grew materially:\n`);
		for (const regression of costRegressions) process.stdout.write(`  ${regression.detail}\n`);
	}
	if (failureReports.length > 0 && !options.json) {
		process.stdout.write(`\n${summarizeNightlyFailures(failureReports).text}\n`);
	}
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ ...summary, ok: overallOk, verdicts, failureReports, regressions, costRegressions, packVerdicts, crashRecoveryMatrix, uiJourneys, quarantine: { entries: quarantine.entries, newlyQuarantined: newlyQuarantined.map((entry) => entry.cellId) } }, null, 2)}\n`,
		);
	} else {
		process.stdout.write(`\n${summary.summary}${overallOk ? "" : " Overall nightly verdict: FAILED."}\n`);
		// P20.13 — SCOPE, printed where the number is read rather than buried in a doc nobody opens.
		//
		// Every cell here drives a SIMULATED model. Research on τ-bench retail found agent success swings ~9pp
		// purely from which LLM plays the counterpart, with systematic miscalibration and a fairness failure
		// (AAVE speakers 11.2pp lower, compounding to 19pp for speakers 55+). So a simulated counterpart can
		// establish that a MECHANISM fires, and cannot establish a user-facing success rate.
		//
		// This is printed on a GREEN run specifically. A red run is already read as bad news; it is "28/28
		// passed" that quietly invites the stronger claim, and the whole suite's honesty rests on that claim not
		// being made.
		process.stdout.write(`${NIGHTLY_SIMULATION_SCOPE_NOTE}\n`);
	}
	// Write the baseline through the SAME constant readPriorDurations reads (not a re-spelled literal): if the two
	// paths ever drifted, the write would land elsewhere, every read would miss, and detectDurationRegressions would
	// go permanently dead WITHOUT any error — the exact silent-regression-detection failure this whole suite guards.
	await writeFile(LAST_RUN_PATH, JSON.stringify({ ...summary, verdicts }, null, 2), "utf8").catch(() => {});
	if (!overallOk) {
		process.exitCode = 1;
	}
}
