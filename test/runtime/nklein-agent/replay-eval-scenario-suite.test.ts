import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { runScenarioSuite } from "../../../src/nklein-agent/replay-eval-scenario-suite";

/** A minimal fake ChildProcess: an EventEmitter with stdout/stderr emitters, plus `settle` to drive close/error. */
function fakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	return child;
}

type SpawnCall = { command: string; args: string[]; options: { cwd?: string; env?: NodeJS.ProcessEnv } };

function harness(overrides?: { closeCode?: number; emitError?: Error; stderr?: string }) {
	const calls: SpawnCall[] = [];
	const ensured: Array<{ treePath: string; from: string }> = [];
	const child = fakeChild();
	const spawnProcess = ((command: string, args: string[], options: SpawnCall["options"]) => {
		calls.push({ command, args, options });
		// Drive the child to its terminal event on the next tick so the awaiter's listeners are attached first.
		queueMicrotask(() => {
			if (overrides?.stderr) {
				child.stderr.emit("data", Buffer.from(overrides.stderr));
			}
			if (overrides?.emitError) {
				child.emit("error", overrides.emitError);
				return;
			}
			child.emit("close", overrides?.closeCode ?? 0);
		});
		return child;
	}) as never;
	const run = (extra?: Partial<Parameters<typeof runScenarioSuite>[0]>) =>
		runScenarioSuite({
			treePath: "/work/tree",
			ledgerRootDir: "/caps/baseline",
			nodeModulesFrom: "/repo",
			runtimePort: 3991,
			spawnProcess,
			ensureNodeModules: async (treePath, from) => {
				ensured.push({ treePath, from });
			},
			makeTempHome: async () => "/tmp/home-X",
			...extra,
		});
	return { calls, ensured, run };
}

describe("runScenarioSuite (F1.26b live scenario primitive)", () => {
	it("spawns the tree's harness with cwd=treePath, isolated HOME, and the ledger-root env override", async () => {
		const { calls, ensured, run } = harness();
		await run();
		expect(ensured).toEqual([{ treePath: "/work/tree", from: "/repo" }]);
		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call?.command).toBe("npx");
		expect(call?.args).toEqual(["tsx", "/work/tree/scripts/verify-simulated-flow.mts"]);
		expect(call?.options.cwd).toBe("/work/tree");
		expect(call?.options.env?.HOME).toBe("/tmp/home-X");
		// The whole point: the child runtime's ledger must land in the orchestrator's dir.
		expect(call?.options.env?.NKLEIN_AGENT_LEDGER_ROOT).toBe("/caps/baseline");
		expect(call?.options.env?.NKLEIN_SIMFLOW_RUNTIME_PORT).toBe("3991");
		expect(call?.options.env?.NODE_ENV).toBe("development");
	});

	it("resolves when the harness exits 0", async () => {
		const { run } = harness({ closeCode: 0 });
		await expect(run()).resolves.toBeUndefined();
	});

	it("rejects with an output tail when the harness exits non-zero", async () => {
		const { run } = harness({ closeCode: 2, stderr: "perfect-run left cards undrained" });
		await expect(run()).rejects.toThrow(/exited 2.*undrained/s);
	});

	it("rejects when the child fails to spawn", async () => {
		const { run } = harness({ emitError: new Error("ENOENT npx") });
		await expect(run()).rejects.toThrow(/ENOENT npx/);
	});

	it("skips node_modules linking when nodeModulesFrom is not provided", async () => {
		const { ensured, run } = harness();
		await run({ nodeModulesFrom: undefined as never });
		expect(ensured).toEqual([]);
	});
});
