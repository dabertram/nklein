import { describe, expect, it } from "vitest";
import {
	buildConsultObservation,
	consultInFlightStatusLabel,
	describeConsultForTrail,
	formatConsultAnswerNotice,
	formatConsultDeclinedNotice,
	formatConsultStartNotice,
	MODEL_CONSULT_CATEGORY,
	summarizeConsultProblem,
} from "../../../src/core/model-consult-visibility";

describe("model-consult visibility (David 2026-07-23: consults must be properly shown)", () => {
	it("telemetry observation carries every measurable fact under the single model_consult category", () => {
		const observation = buildConsultObservation({
			taskId: "card-7",
			askerModelId: "qwen3.5-9b",
			consultantModelId: "qwen3.6-35b",
			admissionReason: "Stuck-gate satisfied: repeated failure with budget remaining.",
			requestBytes: 2_400,
			answerBytes: 900,
			durationMs: 12_300,
			followUpOutcome: null,
		});
		expect(observation.metadata.category).toBe(MODEL_CONSULT_CATEGORY);
		expect(observation.metadata.askerModelId).toBe("qwen3.5-9b");
		expect(observation.metadata.consultantModelId).toBe("qwen3.6-35b");
		expect(observation.metadata.followUpOutcome).toBeNull();
		expect(observation.message).toContain("qwen3.5-9b asked qwen3.6-35b");
	});

	it("chat start notice names asker, consultant, the failed-attempt count, and a one-line problem summary", () => {
		const notice = formatConsultStartNotice({
			askerModelId: "small",
			consultantModelId: "big",
			failedAttempts: 3,
			problem: "Tree rebalance keeps failing the rotation invariant\nlong detail...",
		});
		expect(notice).toContain("Consulting stronger model big");
		expect(notice).toContain("stuck after 3 failed attempt(s)");
		expect(notice).toContain("Tree rebalance keeps failing the rotation invariant");
		expect(notice).not.toContain("long detail");
	});

	it("answer notice reports duration and size and keeps the advisory framing; declines are equally visible", () => {
		expect(formatConsultAnswerNotice({ consultantModelId: "big", durationMs: 12_340, answerBytes: 900 })).toBe(
			"🤝 big answered in 12.3s (900B, advisory) — the worker verifies and applies below.",
		);
		expect(formatConsultDeclinedNotice("No loaded, idle local model is stronger")).toContain("Consult declined:");
	});

	it("in-flight status label and trail entry expose the consult on the live chip and the card timeline", () => {
		expect(consultInFlightStatusLabel("qwen3.6-35b")).toBe("Consulting qwen3.6-35b…");
		expect(
			describeConsultForTrail({
				askerModelId: "small",
				consultantModelId: "big",
				durationMs: 12_000,
				followUpOutcome: "success",
			}),
		).toBe("Consult: small → big (12s; next attempt SUCCEEDED)");
		expect(
			describeConsultForTrail({ askerModelId: "s", consultantModelId: "b", durationMs: 500, followUpOutcome: null }),
		).toContain("follow-up pending");
	});

	it("problem summaries hard-cap at one line", () => {
		expect(summarizeConsultProblem(`${"p".repeat(200)}\nsecond line`)).toHaveLength(141);
	});
});
