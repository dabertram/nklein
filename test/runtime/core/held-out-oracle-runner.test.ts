import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { listHeldOutProbes, runHeldOutOracle } from "../../../src/core/held-out-oracle-runner";

/**
 * P23.5 — the executor's contract: independence fail-closed BEFORE any probe runs, the host-owned runner on
 * the dispatch path, per-probe verdicts, and `delivered` only when every fail_to_pass probe passed.
 */
let probeDir: string;
let repoRoot: string;

beforeAll(async () => {
	const root = await mkdtemp(join(tmpdir(), "oracle-runner-"));
	probeDir = join(root, "probes");
	repoRoot = join(root, "repo");
	await mkdir(probeDir, { recursive: true });
	await mkdir(join(repoRoot, "node_modules", ".bin"), { recursive: true });
	await writeFile(join(probeDir, "alpha.probe.mts"), "// probe alpha");
	await writeFile(join(probeDir, "beta.probe.mts"), "// probe beta");
	await writeFile(join(probeDir, "notes.md"), "not a probe");
});

describe("listHeldOutProbes", () => {
	it("discovers only *.probe.mts files, sorted, as fail_to_pass probes", async () => {
		const probes = await listHeldOutProbes(probeDir);
		expect(probes.map((probe) => probe.id)).toEqual(["alpha", "beta"]);
		expect(probes.every((probe) => probe.kind === "fail_to_pass")).toBe(true);
	});
});

describe("runHeldOutOracle", () => {
	it("refuses to grade when the probes sit inside the agent's writable root (fail-closed, zero executions)", async () => {
		let executions = 0;
		const verdict = await runHeldOutOracle(
			{ workspacePath: join(probeDir, ".."), probeDir, repoRoot },
			{
				exec: async () => {
					executions += 1;
					return { ok: true, output: "" };
				},
			},
		);
		expect(verdict.independence.independent).toBe(false);
		expect(executions).toBe(0);
		expect(verdict.delivered).toBe(false);
	});

	it("runs each probe through the HOST tsx runner with the workspace in env, and folds the verdict", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "oracle-ws-"));
		const seen: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
		const verdict = await runHeldOutOracle(
			{ workspacePath: workspace, probeDir, repoRoot, projectAcceptanceCommand: "npm test" },
			{
				exec: async (command, args, env) => {
					seen.push({ command, args, env });
					return { ok: args[1]?.includes("alpha") ?? false, output: "tap" };
				},
			},
		);
		expect(seen).toHaveLength(2);
		expect(seen[0]?.command).toBe(join(repoRoot, "node_modules", ".bin", "tsx"));
		expect(seen[0]?.env.NKLEIN_ORACLE_WORKSPACE).toBe(workspace);
		expect(verdict.failToPassTotal).toBe(2);
		expect(verdict.failToPassPassed).toBe(1);
		expect(verdict.delivered).toBe(false); // beta failed — ALL fail_to_pass must pass
	});

	it("an empty probe dir cannot deliver (no_probes finding, nothing to grade)", async () => {
		const emptyDir = await mkdtemp(join(tmpdir(), "oracle-empty-"));
		const workspace = await mkdtemp(join(tmpdir(), "oracle-ws2-"));
		const verdict = await runHeldOutOracle(
			{ workspacePath: workspace, probeDir: emptyDir, repoRoot },
			{ exec: async () => ({ ok: true, output: "" }) },
		);
		expect(verdict.independence.independent).toBe(false);
		expect(verdict.independence.findings.some((finding) => finding.code === "no_probes")).toBe(true);
	});
});
