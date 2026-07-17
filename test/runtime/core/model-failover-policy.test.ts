import { describe, expect, it } from "vitest";
import { decideModelFailover, isModelSideError } from "../../../src/core/model-failover-policy";

describe("isModelSideError", () => {
	it("classifies the live-found model/engine errors as model-side", () => {
		expect(isModelSideError('Engine protocol predict request returned 500: {"error":…}')).toBe(true);
		expect(isModelSideError("The model has crashed without additional info")).toBe(true);
		expect(isModelSideError("Jinja Exception: conversation roles must alternate")).toBe(true);
		expect(isModelSideError("Selected LM Studio model x is not currently loaded")).toBe(true);
		expect(isModelSideError("fetch failed: ECONNREFUSED 127.0.0.1:1234")).toBe(true);
	});

	it("refuses task/sandbox/user-scoped errors (failover would just repeat them)", () => {
		expect(isModelSideError("Could not start Docker agent sandbox: bind source path does not exist")).toBe(false);
		expect(isModelSideError("Task canceled by user")).toBe(false);
		expect(isModelSideError("npm test exited with code 1")).toBe(false);
		expect(isModelSideError(null)).toBe(false);
		expect(isModelSideError("")).toBe(false);
	});
});

describe("decideModelFailover", () => {
	const base = {
		errorMessage: "Engine protocol predict request returned 500",
		failedModelKey: "ministral",
		triedModelKeys: [] as string[],
		rankedCandidateKeys: ["gemma", "ministral", "qwable"],
	};

	it("fails over to the best-ranked UNTRIED candidate on a model-side error", () => {
		const decision = decideModelFailover(base);
		expect(decision).toMatchObject({ failover: true, nextModelKey: "gemma" });
		expect(decision.reason).toContain("hop 1/2");
	});

	it("never revisits an already-tried model (ranking order preserved among the untried)", () => {
		const decision = decideModelFailover({ ...base, triedModelKeys: ["gemma"] });
		expect(decision).toMatchObject({ failover: true, nextModelKey: "qwable" });
	});

	it("does not fail over on a non-model-side error", () => {
		const decision = decideModelFailover({ ...base, errorMessage: "Docker bind mount failed" });
		expect(decision.failover).toBe(false);
		expect(decision.reason).toContain("not model-side");
	});

	it("respects the failover cap (third strike parks)", () => {
		const decision = decideModelFailover({ ...base, triedModelKeys: ["gemma", "qwable"] });
		expect(decision.failover).toBe(false);
		expect(decision.reason).toContain("cap reached");
	});

	it("parks when no untried candidate remains", () => {
		const decision = decideModelFailover({
			...base,
			rankedCandidateKeys: ["ministral"],
		});
		expect(decision.failover).toBe(false);
		expect(decision.reason).toContain("no untried");
	});

	it("honors a custom cap", () => {
		const decision = decideModelFailover({ ...base, triedModelKeys: ["gemma"], maxFailovers: 1 });
		expect(decision.failover).toBe(false);
		expect(decision.reason).toContain("cap reached");
	});
});
