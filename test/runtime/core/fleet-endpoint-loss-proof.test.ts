import { describe, expect, it } from "vitest";
import {
	assessFleetEndpointLossProof,
	assessFleetProofBoardCompletion,
} from "../../../src/core/fleet-endpoint-loss-proof";

describe("assessFleetEndpointLossProof", () => {
	it("keeps the ordinary host-spread verifier independent when no fault is requested", () => {
		expect(
			assessFleetEndpointLossProof({
				faultModel: null,
				injected: false,
				modelAbsentAfterInjection: false,
				targetTaskId: null,
				sameTaskRerouted: false,
				allResultsMerged: false,
			}),
		).toEqual({ required: false, ok: true, missing: [] });
	});

	it("requires the complete removal, same-card reroute, and merge chain", () => {
		const complete = assessFleetEndpointLossProof({
			faultModel: "worker-b",
			injected: true,
			modelAbsentAfterInjection: true,
			targetTaskId: "card-2",
			sameTaskRerouted: true,
			allResultsMerged: true,
		});
		expect(complete).toEqual({ required: true, ok: true, missing: [] });

		const incomplete = assessFleetEndpointLossProof({
			faultModel: "worker-b",
			injected: true,
			modelAbsentAfterInjection: true,
			targetTaskId: "card-2",
			sameTaskRerouted: false,
			allResultsMerged: false,
		});
		expect(incomplete.ok).toBe(false);
		expect(incomplete.missing).toEqual([
			"the faulted card was not observed on another model",
			"not every card result reached Completed/Done",
		]);
	});
});

describe("assessFleetProofBoardCompletion", () => {
	it("rejects the transient empty-board snapshot that previously produced 0 === 0", () => {
		const result = assessFleetProofBoardCompletion({
			expectedTaskIds: ["leaf-a", "leaf-b", "join"],
			columns: [],
		});
		expect(result.ok).toBe(false);
		expect(result.missingTaskIds).toEqual(["join", "leaf-a", "leaf-b"]);
		expect(result.unmergedTaskIds).toEqual(["join", "leaf-a", "leaf-b"]);
	});

	it("requires every pinned card id in Completed/Done and rejects fixture contamination", () => {
		const incomplete = assessFleetProofBoardCompletion({
			expectedTaskIds: ["leaf-a", "leaf-b", "join"],
			columns: [
				{ id: "review", cards: [{ id: "leaf-a" }] },
				{ id: "completed", cards: [{ id: "leaf-b" }, { id: "join" }, { id: "surprise" }] },
			],
		});
		expect(incomplete.ok).toBe(false);
		expect(incomplete.missingTaskIds).toEqual([]);
		expect(incomplete.unmergedTaskIds).toEqual(["leaf-a"]);
		expect(incomplete.unexpectedTaskIds).toEqual(["surprise"]);

		const complete = assessFleetProofBoardCompletion({
			expectedTaskIds: ["leaf-a", "leaf-b", "join"],
			columns: [
				{ id: "completed", cards: [{ id: "leaf-a" }, { id: "leaf-b" }] },
				{ id: "done", cards: [{ id: "join" }] },
			],
		});
		expect(complete.ok).toBe(true);
		expect(complete.mergedCount).toBe(3);
	});
});
