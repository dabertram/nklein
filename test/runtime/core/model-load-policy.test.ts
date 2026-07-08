import { describe, expect, it } from "vitest";
import { decideModelLoadAction } from "../../../src/core/model-load-policy";

const RESIDENT = ["qwopus3.5-9b-coder-mtp"];

describe("decideModelLoadAction (§10 sweep resource governance — residents sacred, headroom-gated)", () => {
	it("no-ops on an already-loaded model and loads directly with headroom", () => {
		expect(
			decideModelLoadAction({
				requestedModelId: "a",
				requestedSizeGb: 5,
				loaded: [{ id: "a", sizeGb: 5, busy: false }],
				freeGb: 1,
				residentModelIds: RESIDENT,
			}).action,
		).toBe("noop");
		expect(
			decideModelLoadAction({
				requestedModelId: "b",
				requestedSizeGb: 5,
				loaded: [],
				freeGb: 12,
				residentModelIds: RESIDENT,
			}).action,
		).toBe("load");
	});

	it("evicts the LARGEST non-resident idle model first when headroom is short", () => {
		const decision = decideModelLoadAction({
			requestedModelId: "next-14b",
			requestedSizeGb: 10,
			loaded: [
				{ id: "qwopus3.5-9b-coder-mtp", sizeGb: 9, busy: false }, // resident — untouchable
				{ id: "small-guest", sizeGb: 4, busy: false },
				{ id: "big-guest", sizeGb: 12, busy: false },
			],
			freeGb: 3,
			residentModelIds: RESIDENT,
		});
		expect(decision).toMatchObject({ action: "unload_first", unloadModelId: "big-guest" });
	});

	it("never evicts residents or busy models — blocks instead; unknown sizes demand the floor", () => {
		const blocked = decideModelLoadAction({
			requestedModelId: "next",
			requestedSizeGb: 10,
			loaded: [
				{ id: "qwopus3.5-9b-coder-mtp", sizeGb: 9, busy: false },
				{ id: "busy-guest", sizeGb: 12, busy: true },
			],
			freeGb: 3,
			residentModelIds: RESIDENT,
		});
		expect(blocked.action).toBe("blocked");
		expect(blocked.reason).toContain("never unloaded");

		const unknownSize = decideModelLoadAction({
			requestedModelId: "mystery",
			requestedSizeGb: null,
			loaded: [],
			freeGb: 6,
			residentModelIds: RESIDENT,
		});
		// 6GB free < the 8GB unknown-size floor and nothing evictable ⇒ blocked, never a blind load.
		expect(unknownSize.action).toBe("blocked");
	});
});
