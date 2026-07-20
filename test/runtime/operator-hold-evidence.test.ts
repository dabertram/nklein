import { describe, expect, it } from "vitest";
import {
	buildOperatorHoldEvidence,
	classifyHoldReason,
	collectBlockedDependents,
} from "../../src/core/operator-hold-evidence";

describe("classifyHoldReason", () => {
	it("classifies the real 2026-07-20 case", () => {
		// The exact message from the failing run.
		expect(
			classifyHoldReason(
				"Could not capture sandbox task result patch: the sandbox workspace was unavailable before capture (workspace_disposed_before_capture).",
			),
		).toBe("workspace_disposed_before_capture");
	});

	it("distinguishes the other hold causes", () => {
		expect(classifyHoldReason("Task result capture has not settled for x; held in Review")).toBe("capture_unsettled");
		expect(classifyHoldReason("Empty-patch card x held in Review (fail-closed)")).toBe("empty_patch_no_signoff");
		expect(classifyHoldReason("Self-improvement card x held in Review (M4 fail-closed)")).toBe(
			"self_improvement_blocked",
		);
		expect(classifyHoldReason("Acceptance-failure re-drive of x failed (boom)")).toBe("acceptance_redrive_failed");
	});

	it("returns `unknown` rather than guessing at an unrecognised message", () => {
		// A wrong code is worse than no code: it would group an unrelated stall with a known class and send the
		// reader to the wrong remedy.
		expect(classifyHoldReason("something else entirely")).toBe("unknown");
	});
});

describe("collectBlockedDependents", () => {
	const edges = [
		{ fromTaskId: "b", toTaskId: "a" },
		{ fromTaskId: "c", toTaskId: "b" },
		{ fromTaskId: "d", toTaskId: "c" },
		{ fromTaskId: "z", toTaskId: "unrelated" },
	];

	it("collects the TRANSITIVE subtree, not just direct dependents", () => {
		// The severity number. One held card blocked 22 in the real case; direct dependents were only 3.
		expect(collectBlockedDependents("a", edges)).toEqual(["b", "c", "d"]);
	});

	it("excludes unrelated cards", () => {
		expect(collectBlockedDependents("a", edges)).not.toContain("z");
	});

	it("returns empty for a leaf", () => {
		expect(collectBlockedDependents("d", edges)).toEqual([]);
	});

	it("terminates on a dependency CYCLE rather than hanging", () => {
		// A malformed graph must not hang the reporter that exists to explain a stall.
		const cyclic = [
			{ fromTaskId: "b", toTaskId: "a" },
			{ fromTaskId: "a", toTaskId: "b" },
		];
		expect(collectBlockedDependents("a", cyclic).sort()).toEqual(["a", "b"]);
	});
});

describe("buildOperatorHoldEvidence", () => {
	const base = {
		cardId: "s03",
		holdMessage: "unavailable before capture (workspace_disposed_before_capture)",
		dependencyEdges: [
			{ fromTaskId: "s10", toTaskId: "s03" },
			{ fromTaskId: "s11", toTaskId: "s10" },
		],
		logLines: ["[review-phase] s03: review-session done (request_changes)", "unrelated line", "s03: bounced"],
		survivingArtefacts: [
			{ kind: "result_branch" as const, ref: "nklein/tasks/s03-0c797", detail: "7 files, +76/-143" },
		],
		seed: "7",
		cellId: "01 × perfect",
	};

	it("says plainly that a hold is NOT a defect", () => {
		// The nightly must not report a deliberate hold as a bug — that is how a correct behaviour gets 'fixed'.
		expect(buildOperatorHoldEvidence(base).summary).toContain("NOT a defect");
	});

	it("reports the SUBTREE as the severity, not the single card", () => {
		const evidence = buildOperatorHoldEvidence(base);
		expect(evidence.blockedDependents).toEqual(["s10", "s11"]);
		expect(evidence.summary).toContain("this, not the single card, is the severity");
	});

	it("states that the WORK SURVIVED when an artefact is present — the field that decides the remedy", () => {
		// The real case held a card whose work was entirely intact. A remedy that re-does it would discard it.
		const evidence = buildOperatorHoldEvidence(base);
		expect(evidence.summary).toContain("WORK SURVIVED");
		expect(evidence.summary).toContain("would discard it");
	});

	it("says so explicitly when NO artefact survived — a different remedy set", () => {
		const evidence = buildOperatorHoldEvidence({ ...base, survivingArtefacts: [] });
		expect(evidence.summary).toContain("NO SURVIVING ARTEFACT");
		expect(evidence.summary).toContain("changes which remedies are sensible");
	});

	it("carries seed and cell so the run can be repeated", () => {
		expect(buildOperatorHoldEvidence(base).summary).toContain("seed 7");
	});

	it("marks an unrecorded seed rather than omitting it", () => {
		// An absent seed must be visible: a reader who cannot see it would assume the run is reproducible.
		expect(buildOperatorHoldEvidence({ ...base, seed: null }).summary).toContain("<unrecorded>");
	});

	it("retains only the held card's own processing chain", () => {
		const evidence = buildOperatorHoldEvidence(base);
		expect(evidence.processingChain).toHaveLength(2);
		expect(evidence.processingChain.every((step) => step.line.includes("s03"))).toBe(true);
	});

	it("prescribes NO remedy — that is a product decision", () => {
		// A detector that also prescribes settles a question it is not entitled to settle, and the blanket answer
		// is wrong for at least one existing hold (self-improvement M4, where manual review is the point).
		const evidence = buildOperatorHoldEvidence(base);
		expect(evidence).not.toHaveProperty("remedy");
		expect(evidence.summary).not.toMatch(/re-?drive it|retry it|the fix is/i);
	});
});
