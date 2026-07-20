import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildNightlyFailureReport, summarizeNightlyFailures } from "../core/nightly-failure-report";
import {
	type CellVerdict,
	enumerateNightlyCells,
	type NightlyCell,
	type NightlyManifest,
	summarizeNightlyRun,
} from "../core/nightly-manifest";

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

	const cells = enumerateNightlyCells(manifest, { project: options.project, model: options.model });
	if (options.dryRun) {
		process.stdout.write(`${cells.length} cell(s) would run SEQUENTIALLY:\n`);
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
	if (failureReports.length > 0 && !options.json) {
		process.stdout.write(`\n${summarizeNightlyFailures(failureReports).text}\n`);
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...summary, verdicts, failureReports }, null, 2)}\n`);
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
