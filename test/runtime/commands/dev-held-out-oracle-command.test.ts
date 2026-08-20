import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDevHeldOutOracleCommand } from "../../../src/commands/dev-held-out-oracle-command";

/**
 * P23.5's oracle machinery was fully built and tested but had NO caller outside its own tests, so the item's
 * remaining leg ("run a longer/decomposed attempt and grade it") could not execute at all. These pin the wire.
 */
describe("dev oracle-grade", () => {
	let workspace: string;

	beforeEach(async () => {
		workspace = await mkdtemp(join(tmpdir(), "oracle-grade-ws-"));
	});
	afterEach(async () => {
		await rm(workspace, { recursive: true, force: true });
	});

	it("refuses without a probe source instead of grading nothing silently", async () => {
		const lines: string[] = [];
		const code = await runDevHeldOutOracleCommand({ workspace }, (line) => lines.push(line));
		expect(code).toBe(64);
		expect(lines.join("\n")).toContain("--project");
	});

	it("null-agent gate: an EMPTY workspace is graded independently and scores zero", async () => {
		// The gate that makes the oracle meaningful — if doing nothing scored above zero it would be forgeable.
		const lines: string[] = [];
		const code = await runDevHeldOutOracleCommand(
			{
				workspace,
				project: "02_construction_jobsite_safety_compliance",
				acceptanceCommand: "npm test",
				repoRoot: process.cwd(),
			},
			(line) => lines.push(line),
		);
		const output = lines.join("\n");
		expect(output).toContain("INDEPENDENT ✓");
		expect(output).toContain("fail_to_pass: 0/");
		expect(output).toContain("delivered: false");
		// 1 = graded, not delivered. Distinct from 65 (oracle not independent), so a misconfigured run can
		// never be mistaken for an honest negative result.
		expect(code).toBe(1);
	}, 120_000);
});
