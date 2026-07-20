import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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

async function runCell(cell: NightlyCell, index: number): Promise<CellVerdict> {
	const started = Date.now();
	let home: string;
	try {
		home = await mkdtemp(join(tmpdir(), `nklein-nightly-${cell.projectId}-`));
	} catch (error) {
		return { cell, outcome: "skipped", reason: `could not create an isolated HOME: ${String(error)}` };
	}
	const port = portForCell(index);
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
				NKLEIN_NIGHTLY_MODEL_PROFILE: cell.modelProfile,
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
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...summary, verdicts }, null, 2)}\n`);
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
