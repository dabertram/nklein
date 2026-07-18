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

	it("hard task × struggling model ⇒ the chat hookup maps the gate's consistency pick to the BOUNCE loop", async () => {
		// The gate picks self_consistency for a low-reliability profile with no stronger peer, but exact-match voting
		// degenerates on free-form chat output (live-found on the resident 9B) — the hookup maps it to the persona
		// bounce, whose critique→revise rounds work on any output shape.
		const calls: string[] = [];
		const out = await maybeEnforceReasoning({
			task: HARD_TASK,
			draft: "v1",
			profile: strugglingProfile(),
			modelId: "weak",
			complete: async ({ system, user }) => {
				calls.push(system ? "critique" : "revise");
				if (system) {
					return user.includes("v2") ? "Fine.\nVERDICT: ok" : "1. Naive.\nVERDICT: revise";
				}
				return "v2";
			},
			enabled: true,
		});
		expect(out).toBe("v2");
		expect(calls[0]).toBe("critique");
	});

	it("F3.13: a stronger loaded peer flips the gate to cross_model_carry and the PEER completion drives the repair", async () => {
		let peerCalls = 0;
		let selfCalls = 0;
		const out = await maybeEnforceReasoning({
			task: HARD_TASK,
			draft: "draft-needs-help",
			profile: strugglingProfile(),
			modelId: "weak-7b",
			complete: async () => {
				selfCalls += 1;
				return "self-answer";
			},
			resolveStrongerPeer: async (draftModelId) => {
				expect(draftModelId).toBe("weak-7b");
				return {
					modelId: "strong-32b",
					complete: async () => {
						peerCalls += 1;
						// The carry loop's critique+repair reply: a REPAIRED section replaces the draft.
						return "FINDINGS: shallow reasoning\nREPAIRED:\npeer-repaired-answer";
					},
				};
			},
			enabled: true,
		});
		expect(peerCalls).toBeGreaterThan(0);
		expect(selfCalls).toBe(0);
		expect(out).toContain("peer-repaired-answer");
	});

	it("F3.13: no stronger peer (resolver null) ⇒ the pre-existing bounce path runs on the SAME model", async () => {
		let selfCalls = 0;
		const out = await maybeEnforceReasoning({
			task: HARD_TASK,
			draft: "draft-2",
			profile: strugglingProfile(),
			modelId: "weak-7b",
			complete: async () => {
				selfCalls += 1;
				return "self-improved";
			},
			resolveStrongerPeer: async () => null,
			enabled: true,
		});
		expect(selfCalls).toBeGreaterThan(0);
		expect(typeof out).toBe("string");
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
