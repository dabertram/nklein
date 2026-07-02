import { describe, expect, it } from "vitest";
import { estimateNKleinStartDifficulty } from "../../../src/nklein-agent/nklein-task-start-guard";

describe("estimateNKleinStartDifficulty with content signals (W1.2)", () => {
	it("reproduces the historical token-only score when no signals are given", () => {
		expect(estimateNKleinStartDifficulty(0)).toBe(25);
		expect(estimateNKleinStartDifficulty(8_000)).toBe(35); // 25 + 8000/800
	});

	it("a terse HARD card no longer scores as trivial (the under-routing fix)", () => {
		const terseHard = estimateNKleinStartDifficulty(120, {
			taskText: "Fix the race condition in the scheduler",
		});
		expect(terseHard).toBeGreaterThan(estimateNKleinStartDifficulty(120));
	});

	it("a verbose EASY card is dampened (the over-provisioning fix)", () => {
		const verboseEasy = estimateNKleinStartDifficulty(8_000, {
			taskText: "Fix a typo in the README documentation",
		});
		expect(verboseEasy).toBeLessThan(estimateNKleinStartDifficulty(8_000));
	});

	it("hard keywords win over easy keywords when both appear", () => {
		const mixed = estimateNKleinStartDifficulty(200, {
			taskText: "Rename the module and refactor the concurrency handling",
		});
		expect(mixed).toBeGreaterThan(estimateNKleinStartDifficulty(200));
	});

	it("a plan card is bumped above the token-only score (bump, not a floor — feasibility-cliff safety)", () => {
		expect(estimateNKleinStartDifficulty(50, { isPlanCard: true })).toBe(estimateNKleinStartDifficulty(50) + 10);
	});

	it("the planning skill bumps like a plan card", () => {
		expect(estimateNKleinStartDifficulty(50, { skillIds: ["planning", "code_editing"] })).toBe(
			estimateNKleinStartDifficulty(50) + 10,
		);
	});

	it("clamps to [5, 100]", () => {
		expect(estimateNKleinStartDifficulty(0, { taskText: "fix typo in comment" })).toBeGreaterThanOrEqual(5);
		expect(
			estimateNKleinStartDifficulty(1_000_000, { isPlanCard: true, taskText: "massive security refactor" }),
		).toBeLessThanOrEqual(100);
	});
});
