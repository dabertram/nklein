import { describe, expect, it } from "vitest";
import { type AutoResumeCandidate, selectAutoResumeProjects } from "../src/auto-resume.js";

const c = (projectId: string, autoResumeEnabled: boolean, lastActiveAt?: number): AutoResumeCandidate => ({
	projectId,
	autoResumeEnabled,
	lastActiveAt,
});

describe("selectAutoResumeProjects", () => {
	it("selects only flagged projects", () => {
		expect(selectAutoResumeProjects([c("a", true), c("b", false), c("d", true)], 5)).toEqual(["a", "d"]);
	});

	it("defaults to at most ONE (the start-with-1 policy)", () => {
		expect(selectAutoResumeProjects([c("a", true, 100), c("b", true, 200)])).toEqual(["b"]);
	});

	it("orders most-recently-active first", () => {
		const out = selectAutoResumeProjects([c("old", true, 100), c("new", true, 300), c("mid", true, 200)], 3);
		expect(out).toEqual(["new", "mid", "old"]);
	});

	it("is stable for equal/absent timestamps (preserves input order)", () => {
		const out = selectAutoResumeProjects([c("a", true), c("b", true), c("d", true)], 3);
		expect(out).toEqual(["a", "b", "d"]);
	});

	it("caps at maxConcurrent", () => {
		expect(selectAutoResumeProjects([c("a", true, 3), c("b", true, 2), c("d", true, 1)], 2)).toEqual(["a", "b"]);
	});

	it("maxConcurrent 0 / negative → none", () => {
		expect(selectAutoResumeProjects([c("a", true)], 0)).toEqual([]);
		expect(selectAutoResumeProjects([c("a", true)], -3)).toEqual([]);
	});

	it("no flagged projects → empty", () => {
		expect(selectAutoResumeProjects([c("a", false), c("b", false)], 5)).toEqual([]);
	});
});
