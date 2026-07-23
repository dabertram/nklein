import { describe, expect, it } from "vitest";
import {
	buildConsultantPrompt,
	CONSULT_FIELD_CHAR_CAP,
	CONSULT_MIN_CAPABILITY_MARGIN,
	CONSULT_MIN_FAILED_ATTEMPTS,
	CONSULT_TOOL_DESCRIPTION,
	type ConsultCandidate,
	clampConsultRequest,
	decideConsultAdmission,
	selectConsultant,
	wrapConsultAnswer,
} from "../../../src/core/model-consult";

const candidate = (over: Partial<ConsultCandidate>): ConsultCandidate => ({
	key: "lmstudio:big:default",
	modelId: "big",
	capability: 80,
	loadedAndIdle: true,
	...over,
});

describe("model-consult (adopted pattern; docs/attributions.md)", () => {
	it("harness stuck-gate: admits only after enough failed attempts AND within the consult budget", () => {
		expect(decideConsultAdmission({ failedAttempts: 0, consultsUsed: 0, consultBudget: 2 }).admitted).toBe(false);
		expect(
			decideConsultAdmission({ failedAttempts: CONSULT_MIN_FAILED_ATTEMPTS - 1, consultsUsed: 0, consultBudget: 2 })
				.admitted,
		).toBe(false);
		expect(
			decideConsultAdmission({ failedAttempts: CONSULT_MIN_FAILED_ATTEMPTS, consultsUsed: 0, consultBudget: 2 })
				.admitted,
		).toBe(true);
		const spent = decideConsultAdmission({ failedAttempts: 5, consultsUsed: 2, consultBudget: 2 });
		expect(spent.admitted).toBe(false);
		expect(spent.reason).toMatch(/budget spent/i);
	});

	it("selects the strongest loaded+idle local model that is MATERIALLY stronger — never the asker, never a busy or absent one", () => {
		const selection = selectConsultant({
			askerModelId: "small",
			askerCapability: 40,
			candidates: [
				candidate({ key: "a:busy-strongest:x", modelId: "busy-strongest", capability: 95, loadedAndIdle: false }),
				candidate({ key: "b:strong:x", modelId: "strong", capability: 80 }),
				candidate({ key: "c:stronger:x", modelId: "stronger", capability: 90 }),
				candidate({ key: "d:small:x", modelId: "small", capability: 99 }), // the asker itself — excluded
				candidate({ key: "e:barely:x", modelId: "barely", capability: 40 + CONSULT_MIN_CAPABILITY_MARGIN - 1 }),
			],
		});
		expect(selection.selected?.modelId).toBe("stronger");
	});

	it("declines honestly when no eligible consultant exists (never proposes a load/unload)", () => {
		const selection = selectConsultant({
			askerModelId: "small",
			askerCapability: 60,
			candidates: [candidate({ modelId: "peer", capability: 62 })],
		});
		expect(selection.selected).toBeNull();
		expect(selection.reason).toMatch(/never load\/unload/);
	});

	it("clamps every request field so a consult cannot smuggle a repository dump", () => {
		const long = "x".repeat(CONSULT_FIELD_CHAR_CAP + 500);
		const clamped = clampConsultRequest({
			problem: long,
			attemptsTried: "a",
			errorOutput: "",
			relevantContext: long,
		});
		expect(clamped.problem.length).toBeLessThanOrEqual(CONSULT_FIELD_CHAR_CAP + 20);
		expect(clamped.problem).toContain("…[truncated]");
		expect(clamped.attemptsTried).toBe("a");
	});

	it("consultant prompt is a scoped peer consult (diagnose + fix), omitting empty sections", () => {
		const prompt = buildConsultantPrompt({
			problem: "Tests fail on the tree rebalance",
			attemptsTried: "Recursive rotate; iterative rotate",
			errorOutput: "",
			relevantContext: "",
		});
		expect(prompt).toContain("consulted by a colleague");
		expect(prompt).toContain("Do not re-plan their whole task");
		expect(prompt).not.toContain("## Current error");
		expect(prompt).not.toContain("## Relevant code/context");
	});

	it("the answer comes back clearly advisory, and the tool description carries the article's three stuck-conditions", () => {
		const wrapped = wrapConsultAnswer({ consultantModelId: "big", answer: "  Use a sentinel node.  " });
		expect(wrapped).toMatch(/^\[consult answer from big — ADVISORY/);
		expect(wrapped).toContain("Use a sentinel node.");
		expect(CONSULT_TOOL_DESCRIPTION).toContain("two materially different approaches have failed");
		expect(CONSULT_TOOL_DESCRIPTION).toContain("cannot identify another reasonable approach");
	});
});
