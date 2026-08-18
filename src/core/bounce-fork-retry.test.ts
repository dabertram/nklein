import { describe, expect, it } from "vitest";
import { planBounceForkRetry } from "./bounce-fork-retry";

describe("planBounceForkRetry (#37 observe-first)", () => {
	it("is eligible with a safe boundary, reporting how much the fork would rewind", () => {
		expect(
			planBounceForkRetry({
				preview: { messageCount: 20, boundaryIndex: 14 },
				alreadyEscalated: false,
				specMirrorActive: false,
			}),
		).toEqual({
			eligible: true,
			reason: "boundary_found",
			boundaryIndex: 14,
			messageCount: 20,
			rewoundMessages: 5,
		});
	});

	it("defers to the escalation rung — an escalated card never adds a fork arm", () => {
		const observation = planBounceForkRetry({
			preview: { messageCount: 20, boundaryIndex: 14 },
			alreadyEscalated: true,
			specMirrorActive: false,
		});
		expect(observation).toMatchObject({ eligible: false, reason: "already_escalated" });
	});

	it("defers to an active ::spec mirror — best-of-N is already running", () => {
		const observation = planBounceForkRetry({
			preview: { messageCount: 20, boundaryIndex: 14 },
			alreadyEscalated: false,
			specMirrorActive: true,
		});
		expect(observation).toMatchObject({ eligible: false, reason: "spec_mirror_active" });
	});

	it("is ineligible without a persisted transcript, an empty one, or no safe boundary", () => {
		expect(planBounceForkRetry({ preview: null, alreadyEscalated: false, specMirrorActive: false })).toMatchObject({
			eligible: false,
			reason: "no_persisted_transcript",
		});
		expect(
			planBounceForkRetry({
				preview: { messageCount: 0, boundaryIndex: null },
				alreadyEscalated: false,
				specMirrorActive: false,
			}),
		).toMatchObject({ eligible: false, reason: "empty_transcript" });
		expect(
			planBounceForkRetry({
				preview: { messageCount: 7, boundaryIndex: null },
				alreadyEscalated: false,
				specMirrorActive: false,
			}),
		).toMatchObject({ eligible: false, reason: "no_safe_boundary", messageCount: 7 });
	});

	it("a boundary at the tip rewinds nothing (fork = pure continuation retry)", () => {
		expect(
			planBounceForkRetry({
				preview: { messageCount: 12, boundaryIndex: 11 },
				alreadyEscalated: false,
				specMirrorActive: false,
			}),
		).toMatchObject({ eligible: true, rewoundMessages: 0 });
	});
});
