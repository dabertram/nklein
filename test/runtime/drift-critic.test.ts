import { describe, expect, it } from "vitest";
import { buildDriftCriticPrompt, decideDriftCheck, parseDriftCriticVerdict } from "../../src/core/drift-critic";

describe("drift critic cadence (F12.92)", () => {
	it("stays quiet before the run has a trajectory to judge", () => {
		const decision = decideDriftCheck({ turn: 2, lastCheckTurn: null });
		expect(decision.check).toBe(false);
		expect(decision.reason).toContain("no trajectory to judge yet");
	});

	it("fires on the calm cadence and records the check turn", () => {
		expect(decideDriftCheck({ turn: 8, lastCheckTurn: null }).check).toBe(true);
		const later = decideDriftCheck({ turn: 20, lastCheckTurn: 12 });
		expect(later.check).toBe(true);
		expect(later.nextLastCheckTurn).toBe(20);
	});

	it("does not re-fire inside the cadence window", () => {
		const decision = decideDriftCheck({ turn: 14, lastCheckTurn: 12 });
		expect(decision.check).toBe(false);
		expect(decision.nextLastCheckTurn).toBeNull();
	});

	it("tightens the cadence under distress (a drifting run needs the critic sooner)", () => {
		const calm = decideDriftCheck({ turn: 17, lastCheckTurn: 12 });
		expect(calm.check).toBe(false);
		const distressed = decideDriftCheck({ turn: 17, lastCheckTurn: 12, inDistress: true });
		expect(distressed.check).toBe(true);
		expect(distressed.reason).toContain("distress-tightened");
	});
});

describe("drift critic prompt (F12.92)", () => {
	const prompt = buildDriftCriticPrompt({
		taskObjective: "Add retry with bounded backoff to fetchJson.",
		focusChain: "1. [x] read fetch.ts\n2. [ ] add retry",
		recentActivity: "edited src/ui/theme.css ×4",
	});

	it("states the steer-not-solve contract and forbids handing over the answer", () => {
		expect(prompt).toContain("You do NOT write code and you do NOT solve the task.");
		expect(prompt).toContain("never the solution");
		expect(prompt).toContain("Do not provide code, diffs, or step-by-step instructions.");
	});

	it("carries the objective, the worker's own plan, and the recent activity", () => {
		expect(prompt).toContain("Add retry with bounded backoff to fetchJson.");
		expect(prompt).toContain("2. [ ] add retry");
		expect(prompt).toContain("edited src/ui/theme.css ×4");
	});

	it("permits an explicit ON_TRACK so the critic need not invent concerns", () => {
		expect(prompt).toContain("`ON_TRACK`");
		expect(prompt).toContain("do not invent a concern to seem useful");
	});

	it("omits the plan section when the worker has no focus chain", () => {
		const noPlan = buildDriftCriticPrompt({ taskObjective: "Do the thing", recentActivity: "read files" });
		expect(noPlan).not.toContain("The worker's own plan");
	});
});

describe("drift critic parsing (F12.92)", () => {
	it("parses DRIFT/HINT pairs into a nudge note framed as optional", () => {
		const verdict = parseDriftCriticVerdict(
			[
				"DRIFT: editing CSS while the objective is a retry helper | HINT: re-read the objective before the next edit",
				"- DRIFT: no test touched yet | HINT: consider what proves the retry works",
			].join("\n"),
		);
		expect(verdict.onTrack).toBe(false);
		expect(verdict.flags).toHaveLength(2);
		expect(verdict.workerNote).toContain("nudges, not instructions");
		expect(verdict.workerNote).toContain("re-read the objective");
		expect(verdict.workerNote).toContain("If you disagree");
	});

	it("reads ON_TRACK, empty, and unparseable replies as on-track (never manufactures feedback)", () => {
		for (const reply of ["ON_TRACK", "", "the run looks broadly fine to me"]) {
			const verdict = parseDriftCriticVerdict(reply);
			expect(verdict.onTrack).toBe(true);
			expect(verdict.flags).toEqual([]);
			expect(verdict.workerNote).toBeNull();
		}
	});

	it("caps the flags so a chatty critic cannot flood the worker's context", () => {
		const many = Array.from({ length: 6 }, (_, index) => `DRIFT: d${index} | HINT: h${index}`).join("\n");
		expect(parseDriftCriticVerdict(many).flags).toHaveLength(3);
	});
});
