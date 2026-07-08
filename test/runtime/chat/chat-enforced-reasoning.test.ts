import { describe, expect, it } from "vitest";
import { maybeEnforceReasoning } from "../../../src/chat/chat-enforced-reasoning";
import { emptyModelBehaviorProfile, recordModelBehaviorOutcome } from "../../../src/core/model-behavior-profile";

/** A profile with enough samples + a low success rate to trip the gate's struggle signal. */
function strugglingProfile() {
	let profile = emptyModelBehaviorProfile("lmstudio:weak:v1");
	for (let index = 0; index < 5; index += 1) {
		profile = recordModelBehaviorOutcome(profile, { kind: "no_tool_call" });
	}
	return profile;
}

// ~90 test-backed words — comfortably past the chat-surface calibration (0.3 ≈ a 54+ word test-backed ask).
const HARD_TASK =
	"Refactor the whole persistence subsystem to an event-sourced design, migrate every existing store including " +
	"the board, sessions, ledger, and telemetry files, keep backwards compatibility for all on-disk formats so a " +
	"mixed-version fleet keeps working, add property-based tests for every migration invariant including crash " +
	"recovery mid-migration, wire the new event log into the runtime state hub without changing any observable " +
	"behavior, benchmark the read path before and after, and document the rollback procedure step by step for " +
	"operators running mixed versions in production. " +
	"Acceptance check: npm test";

describe("maybeEnforceReasoning (§5.AD flag-gated chat hookup)", () => {
	it("flag OFF ⇒ the draft passes through untouched and the model is never called", async () => {
		let called = 0;
		const out = await maybeEnforceReasoning({
			task: HARD_TASK,
			draft: "draft-1",
			profile: strugglingProfile(),
			complete: async () => {
				called += 1;
				return "x";
			},
			enabled: false,
		});
		expect(out).toBe("draft-1");
		expect(called).toBe(0);
	});

	it("gate quiet (easy task / no struggle signal) ⇒ draft unchanged even when enabled", async () => {
		let called = 0;
		const out = await maybeEnforceReasoning({
			task: "What does this function do?",
			draft: "It parses JSON.",
			profile: strugglingProfile(),
			complete: async () => {
				called += 1;
				return "x";
			},
			enabled: true,
		});
		expect(out).toBe("It parses JSON.");
		expect(called).toBe(0);
	});

	it("hard task × struggling model ⇒ the gate fires self_consistency and the majority sample wins", async () => {
		// The gate's external-signal ladder picks self_consistency for a low-reliability profile with no stronger
		// peer (the chat hookup never supplies one) — majority vote washes out a flaky model's variance.
		let samples = 0;
		const out = await maybeEnforceReasoning({
			task: HARD_TASK,
			draft: "answer-A",
			profile: strugglingProfile(),
			modelId: "weak",
			complete: async () => {
				samples += 1;
				return "answer-B";
			},
			enabled: true,
		});
		// draft(A) + two fresh samples(B, B) ⇒ majority B replaces the draft.
		expect(samples).toBeGreaterThanOrEqual(2);
		expect(out).toBe("answer-B");
	});

	it("a throwing completion never breaks the turn — the draft survives", async () => {
		const out = await maybeEnforceReasoning({
			task: HARD_TASK,
			draft: "v1",
			profile: strugglingProfile(),
			complete: async () => {
				throw new Error("model down");
			},
			enabled: true,
		});
		expect(out).toBe("v1");
	});
});
