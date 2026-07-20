import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { collectDrainedState } from "../core/nightly-drain-collector";
import { buildNightlyFailureReport, summarizeNightlyFailures } from "../core/nightly-failure-report";
import { evaluatePack, resolvePack } from "../core/nightly-invariant-pack";
import {
	type CellVerdict,
	enumerateNightlyCells,
	type NightlyCell,
	type NightlyManifest,
	summarizeNightlyRun,
} from "../core/nightly-manifest";
import { NIGHTLY_PACK_REGISTRY } from "../core/nightly-pack-registry";
import { detectDurationRegressions, planNightlySchedule } from "../core/nightly-schedule";

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
 */

const DEFAULT_MANIFEST_PATH = "nightly-manifest.json";
const PORT_BASE = Number.parseInt(process.env.NKLEIN_NIGHTLY_PORT_BASE ?? "4500", 10);
/** Generous: a large scenario legitimately takes many minutes on a low-power machine. */
const CELL_TIMEOUT_MS = 45 * 60 * 1000;

async function loadManifest(path: string): Promise<NightlyManifest | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as NightlyManifest;
	} catch {
		return null;
	}
}

function portForCell(index: number): number {
	return PORT_BASE + index * 2;
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
async function readPriorDurations(): Promise<Map<string, number>> {
	try {
		const raw = JSON.parse(await readFile(LAST_RUN_PATH, "utf8")) as {
			verdicts?: { cell?: { projectId?: string; modelProfile?: string }; durationMs?: number }[];
		};
		const out = new Map<string, number>();
		for (const verdict of raw.verdicts ?? []) {
			const key = `${verdict.cell?.projectId} × ${verdict.cell?.modelProfile}`;
			if (typeof verdict.durationMs === "number" && verdict.durationMs > 0) {
				out.set(key, verdict.durationMs);
			}
		}
		return out;
	} catch {
		return new Map();
	}
}

const PROFILE_TO_SIMFLOW_RUN: Readonly<Record<string, string>> = {
	perfect: "perfect",
	flaky: "flaky",
};

async function runCell(cell: NightlyCell, index: number): Promise<CellVerdict> {
	const started = Date.now();
	let home: string;
	try {
		home = await mkdtemp(join(tmpdir(), `nklein-nightly-${cell.projectId}-`));
	} catch (error) {
		return { cell, outcome: "skipped", reason: `could not create an isolated HOME: ${String(error)}` };
	}
	const port = portForCell(index);
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
				NKLEIN_SIMFLOW_RUNTIME_PORT: String(port),
				// The profile must reach the variable the script READS, not a name only this runner knows.
				NKLEIN_SIMFLOW_RUN: simflowRun,
				NKLEIN_NIGHTLY_RECORDING_SET: cell.recordingSet,
			},
		});
		// F11.4c: a drain that leaves unmatched aimock requests did not cover what the run did. The summary core
		// refuses to call such a run ok, so surface the count rather than swallowing it.
		const unmatched = Number.parseInt(/unmatched[^0-9]*(\d+)/i.exec(stdout)?.[1] ?? "0", 10);
		return {
			cell,
			outcome: "passed",
			durationMs: Date.now() - started,
			unmatchedRequests: Number.isFinite(unmatched) ? unmatched : 0,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			cell,
			outcome: "failed",
			durationMs: Date.now() - started,
			reason: `${message.slice(0, 300)} (isolated HOME kept for inspection: ${home})`,
		};
	}
}

export async function runDevNightlyCommand(options: {
	project?: string;
	model?: string;
	manifest?: string;
	json?: boolean;
	dryRun?: boolean;
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
	const prior = await readPriorDurations();
	const cellKey = (cell: NightlyCell) => `${cell.projectId} × ${cell.modelProfile}`;
	const plan = planNightlySchedule({
		cells: enumerated.map((cell) => ({
			id: cellKey(cell),
			lastDurationMs: prior.get(cellKey(cell)) ?? null,
		})),
		maxParallel: 1,
	});
	const byKey = new Map(enumerated.map((cell) => [cellKey(cell), cell]));
	// planNightlySchedule throws CoverageWeakenedError rather than silently dropping a cell, so this cannot narrow
	// the suite; the filter is a type narrowing, not a safety net.
	const cells = plan.scheduledCells.map((id) => byKey.get(id)).filter((cell): cell is NightlyCell => Boolean(cell));
	if (options.dryRun) {
		process.stdout.write(`${cells.length} cell(s) would run SEQUENTIALLY (fastest-first from prior durations):\n`);
		for (const [index, cell] of cells.entries()) {
			process.stdout.write(
				`  ${cell.projectId} × ${cell.modelProfile}  (port ${portForCell(index)}, set ${cell.recordingSet})\n`,
			);
		}
		return;
	}

	const verdicts: CellVerdict[] = [];
	for (const [index, cell] of cells.entries()) {
		process.stderr.write(`== ${cell.projectId} × ${cell.modelProfile} (${index + 1}/${cells.length}) ==\n`);
		// SEQUENTIAL: awaited inside the loop, deliberately. See the docblock.
		verdicts.push(await runCell(cell, index));
	}

	const summary = summarizeNightlyRun(verdicts);

	// N7: every failing cell gets a report that is checked for being ACTIONABLE, not merely printed. A failure the
	// next morning cannot be re-run — the state is gone — so the summary is the only artifact that survives.
	const failureReports = verdicts
		.filter((verdict) => verdict.outcome === "failed")
		.map((verdict) => {
			const home = /isolated HOME kept for inspection: ([^)]+)/.exec(verdict.reason ?? "")?.[1]?.trim() ?? null;
			return buildNightlyFailureReport({
				cellId: `${verdict.cell.projectId} × ${verdict.cell.modelProfile}`,
				seed: NIGHTLY_FIXED_SEED,
				homePath: home,
				homeRetained: home !== null,
				packResult: null,
				error: verdict.reason ?? null,
				durationMs: verdict.durationMs ?? null,
			});
		});
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
	const packVerdicts = verdicts
		.filter((verdict) => verdict.outcome === "passed")
		.map((verdict) => {
			const pack = resolvePack(verdict.cell.invariantPack, NIGHTLY_PACK_REGISTRY);
			if (!pack) {
				return `${verdict.cell.projectId} × ${verdict.cell.modelProfile}: invariant pack "${verdict.cell.invariantPack}" is NOT REGISTERED — nothing was asserted for this cell`;
			}
			const collected = collectDrainedState({
				drainStartedAt: 0,
				// Nothing is subscribed. Stated, not simulated.
				subscriptions: [],
				events: [],
				// The drain's terminal lanes are not exposed to this runner yet, so no card state is claimed.
				terminalCards: [],
				unmatchedAimockRequests: verdict.unmatchedRequests ?? 0,
				teardown: { orphanSessions: 0, orphanWorktrees: 0, orphanLeases: 0 },
			});
			return `${verdict.cell.projectId} × ${verdict.cell.modelProfile}: ${evaluatePack(pack, collected.state).summary}`;
		});
	if (packVerdicts.length > 0 && !options.json) {
		process.stdout.write(`\nInvariant packs:\n`);
		for (const line of packVerdicts) {
			process.stdout.write(`  ${line}\n`);
		}
	}

	// N6: the suite watching its OWN cost. A cell drifting 40s -> 200s is a product regression that presents as
	// "the nightly got slower" and is usually absorbed rather than investigated.
	const regressions = detectDurationRegressions(
		verdicts.map((verdict) => ({
			cellId: `${verdict.cell.projectId} × ${verdict.cell.modelProfile}`,
			baselineMs: prior.get(`${verdict.cell.projectId} × ${verdict.cell.modelProfile}`) ?? null,
			currentMs: verdict.durationMs ?? 0,
		})),
	);
	if (regressions.length > 0 && !options.json) {
		process.stdout.write(`\n${regressions.length} cell(s) got materially slower:\n`);
		for (const regression of regressions) {
			process.stdout.write(`  ${regression.detail}\n`);
		}
	}
	if (failureReports.length > 0 && !options.json) {
		process.stdout.write(`\n${summarizeNightlyFailures(failureReports).text}\n`);
	}
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ ...summary, verdicts, failureReports, regressions, packVerdicts }, null, 2)}\n`,
		);
	} else {
		process.stdout.write(`\n${summary.summary}\n`);
	}
	await writeFile(
		join(tmpdir(), "nklein-nightly-last.json"),
		JSON.stringify({ ...summary, verdicts }, null, 2),
		"utf8",
	).catch(() => {});
	if (!summary.ok) {
		process.exitCode = 1;
	}
}
