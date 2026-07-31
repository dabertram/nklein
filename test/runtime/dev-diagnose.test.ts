import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDevDiagnoseCommand } from "../../src/commands/dev-diagnose-command";
import { evaluateHiddenSplits, summarizeRepeatRuns } from "../../src/core/diagnostic-oracles";

/**
 * P20.2 / diagnostic-oracles wire — the diagnosis the `dev diagnose` command surfaces. The load-bearing property
 * is that only the unambiguous success is a pass: every failure mode AND the no-fail-to-pass labelling bug are
 * distinguished, so a green board over a fixture that measures nothing does not read as success.
 */

describe("dev diagnose verdicts", () => {
	it("names WHICH failure mode occurred, not just red", () => {
		expect(
			evaluateHiddenSplits({
				failToPass: [{ id: "t1", passed: false }],
				passToPass: [{ id: "r1", passed: true }],
			}).outcome,
		).toBe("behavior_missing");
		expect(
			evaluateHiddenSplits({
				failToPass: [{ id: "t1", passed: true }],
				passToPass: [{ id: "r1", passed: false }],
			}).outcome,
		).toBe("regression_introduced");
	});

	it("treats NO fail_to_pass tests as inconclusive, never a pass — a fixture that measures nothing", () => {
		expect(evaluateHiddenSplits({ failToPass: [], passToPass: [{ id: "r1", passed: true }] }).outcome).toBe(
			"inconclusive_no_fail_to_pass",
		);
	});

	it("flags repeats that DISAGREE as flaky, distinct from reliable fail", () => {
		expect(summarizeRepeatRuns([{ passed: true }, { passed: false }]).flaky).toBe(true);
		expect(summarizeRepeatRuns([{ passed: false }, { passed: false }]).flaky).toBe(false);
	});
});

/**
 * The `--oracle` WIRE, exercised through the command rather than the core.
 *
 * The core is tested exhaustively in `core/held-out-oracle.test.ts`; what this adds is proof that the command
 * actually reaches it and that the EXIT CODE carries the verdict. That is the half this backlog keeps finding
 * broken — a correct core with a consumer that never calls it, or calls it and drops the answer.
 */
describe("dev diagnose --oracle", () => {
	async function runOracle(plan: unknown): Promise<{ out: string; exitCode: typeof process.exitCode }> {
		const directory = await mkdtemp(join(tmpdir(), "nklein-oracle-wire-"));
		const planPath = join(directory, "plan.json");
		await writeFile(planPath, JSON.stringify(plan), "utf8");
		const originalWrite = process.stdout.write.bind(process.stdout);
		const originalExit = process.exitCode;
		let out = "";
		process.stdout.write = ((chunk: string) => {
			out += chunk;
			return true;
		}) as typeof process.stdout.write;
		try {
			await runDevDiagnoseCommand({ oracle: planPath });
			return { out, exitCode: process.exitCode };
		} finally {
			process.stdout.write = originalWrite;
			process.exitCode = originalExit;
			await rm(directory, { recursive: true, force: true });
		}
	}

	const HELD_OUT = {
		probes: [{ id: "h1", kind: "fail_to_pass", sourcePath: "/oracles/p/h1.test.ts" }],
		agentWritableRoots: ["/sandbox/ws"],
		runner: ["/usr/bin/node", "--test", "/oracles/p/h1.test.ts"],
		projectAcceptanceCommand: "npm test",
	};

	it("fails a plan whose probe sits in the agent's workspace, and SAYS why", async () => {
		const { out, exitCode } = await runOracle({
			...HELD_OUT,
			probes: [{ id: "h1", kind: "fail_to_pass", sourcePath: "/sandbox/ws/test/h1.test.ts" }],
		});
		expect(exitCode).toBe(1);
		expect(out).toContain("NOT INDEPENDENT");
		expect(out).toContain("probe_reachable_by_agent");
	});

	it("passes a held-out plan that carries no scores yet — validating before a run is not a failure", async () => {
		const { out, exitCode } = await runOracle(HELD_OUT);
		expect(exitCode).toBe(0);
		expect(out).toContain("HELD OUT");
		// No gap section: there is nothing to report, and a "no held-out measurement" verdict here would read as a
		// failure rather than as "you have not run it yet".
		expect(out).not.toContain("VISIBLE/HELD-OUT GAP");
	});

	it("fails a held-out plan whose RESULT is the memorization signature", async () => {
		const { out, exitCode } = await runOracle({ ...HELD_OUT, visibleScore: 100, heldOutScore: 0, linesOfCode: 4200 });
		expect(exitCode).toBe(1);
		expect(out).toContain("HELD OUT");
		expect(out).toContain("memorized_visible_suite");
	});

	it("passes only when the oracle is independent AND the gap is inside the envelope", async () => {
		const { exitCode } = await runOracle({ ...HELD_OUT, visibleScore: 90, heldOutScore: 80, linesOfCode: 4200 });
		expect(exitCode).toBe(0);
	});
});
