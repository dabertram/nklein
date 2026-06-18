import { describe, expect, it } from "vitest";
import {
	clampRuntimeSwarmCardStartBatchSize,
	RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH,
} from "../../src/core/api-contract";

describe("runtime swarm card start budget", () => {
	it("caps batch card starts while preserving smaller positive limits", () => {
		expect(clampRuntimeSwarmCardStartBatchSize(0)).toBe(0);
		expect(clampRuntimeSwarmCardStartBatchSize(3)).toBe(3);
		expect(clampRuntimeSwarmCardStartBatchSize(RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH + 10)).toBe(
			RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH,
		);
	});
});
