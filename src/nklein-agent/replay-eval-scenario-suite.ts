import { type ChildProcess, spawn as defaultSpawn } from "node:child_process";
import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * F1.26b — the live `runScenarioSuite` primitive for the replay-eval auto-capture. Rather than build a first-of-its-kind
 * in-process runtime boot (the runtime is architecturally a subprocess: HTTP server, HOME-based config/ledger), this
 * reuses the PROVEN `scripts/verify-simulated-flow.mts` harness (green via `npm run test:simulated-flows`): it stands up
 * the `@copilotkit/aimock`-based simulator, boots the runtime, seeds a dev-test scenario, and drains it — with ZERO LLM
 * compute (deterministic), which is exactly what a replay comparison needs.
 *
 * The one adaptation the auto-capture needs over the raw harness:
 *  - Run the harness from `treePath` (`cwd`), so the BASELINE pass exercises the current code and the REPLAY pass
 *    exercises the patched result-branch worktree — the whole point of the comparison.
 *  - Force the runtime's ledger to the orchestrator's `ledgerRootDir` via `NKLEIN_AGENT_LEDGER_ROOT` (the env override
 *    in `agent-attempt-ledger-store.ts`), since the child process can't see the in-process AsyncLocalStorage scope. That
 *    is what makes `runScenarioSuite`'s write and `readCapturedLedger`'s read agree on the same dir.
 *
 * A fresh git worktree has NO `node_modules` (gitignored), so the patched tree isn't runnable until they're linked —
 * `ensureNodeModules` symlinks them from `nodeModulesFrom` (the source repo). Every effectful primitive (spawn, symlink,
 * temp-HOME) is injected so the command/env/cwd assembly + the throw-on-nonzero contract are unit-tested without a real
 * multi-minute simulated drain; the CLI supplies the live implementations.
 */

export interface RunScenarioSuiteInput {
	/** The source tree to run the runtime FROM — current repo for baseline, the patched worktree for replay. */
	treePath: string;
	/** Where the child runtime must write its agent ledger (via `NKLEIN_AGENT_LEDGER_ROOT`). */
	ledgerRootDir: string;
	/** Repo whose `node_modules` the worktree borrows when it has none (a fresh worktree is dependency-less). */
	nodeModulesFrom?: string;
	/** Runtime port for the child (baseline/replay run sequentially, so one port is fine). Defaults to the harness's 3986. */
	runtimePort?: number;
	/** Extra env for the child (e.g. a scenario selector). */
	env?: NodeJS.ProcessEnv;
	// --- injected seams (defaults are the live implementations) ---
	spawnProcess?: typeof defaultSpawn;
	/** Ensure `treePath` has a usable `node_modules` (symlink from `nodeModulesFrom` when absent). */
	ensureNodeModules?: (treePath: string, nodeModulesFrom: string) => Promise<void>;
	/** Provision the isolated HOME the child's config/state live under. */
	makeTempHome?: () => Promise<string>;
}

async function defaultEnsureNodeModules(treePath: string, nodeModulesFrom: string): Promise<void> {
	// Best-effort symlink; if it already exists (or the source has none) the child's own `npx` resolution is the fallback.
	await symlink(join(nodeModulesFrom, "node_modules"), join(treePath, "node_modules"), "dir").catch(() => {});
}

const defaultMakeTempHome = (): Promise<string> => mkdtemp(join(tmpdir(), "nklein-replay-home-"));

const HARNESS_SCRIPT_REL = join("scripts", "verify-simulated-flow.mts");

export async function runScenarioSuite(input: RunScenarioSuiteInput): Promise<void> {
	const spawnProcess = input.spawnProcess ?? defaultSpawn;
	const ensureNodeModules = input.ensureNodeModules ?? defaultEnsureNodeModules;
	const makeTempHome = input.makeTempHome ?? defaultMakeTempHome;

	if (input.nodeModulesFrom) {
		await ensureNodeModules(input.treePath, input.nodeModulesFrom);
	}
	const home = await makeTempHome();
	const port = input.runtimePort ?? 3986;

	const child = spawnProcess("npx", ["tsx", join(input.treePath, HARNESS_SCRIPT_REL)], {
		cwd: input.treePath,
		env: {
			...process.env,
			...input.env,
			HOME: home,
			NODE_ENV: "development",
			// The subprocess ledger writes land HERE (the env override in agent-attempt-ledger-store.ts).
			NKLEIN_AGENT_LEDGER_ROOT: input.ledgerRootDir,
			NKLEIN_SIMFLOW_RUNTIME_PORT: String(port),
			NKLEIN_RUNTIME_PORT: String(port),
			KANBAN_RUNTIME_PORT: String(port),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	await awaitSuiteExit(child);
}

/** Resolve when the harness child exits 0; reject with a tail of its output on a non-zero exit or spawn error. */
function awaitSuiteExit(child: ChildProcess): Promise<void> {
	const logs: string[] = [];
	const collect = (chunk: Buffer): void => {
		logs.push(chunk.toString());
		if (logs.length > 200) {
			logs.splice(0, logs.length - 200);
		}
	};
	child.stdout?.on("data", collect);
	child.stderr?.on("data", collect);
	return new Promise<void>((resolve, reject) => {
		child.on("error", (error) => reject(error));
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Scenario suite exited ${code}. Tail:\n${logs.join("").slice(-2000)}`));
		});
	});
}
