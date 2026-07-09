import { describe, expect, it } from "vitest";

import { buildLmStudioMachineByModelId } from "../../../src/nklein-agent/nklein-lmstudio-host-map";

describe("buildLmStudioMachineByModelId", () => {
	it("maps LM Studio aliases and registry keys to the owning host", () => {
		const map = buildLmStudioMachineByModelId(
			[
				{
					identifier: "gemma-4-12b-it-qat",
					modelKey: "lmstudio-community/gemma-4-12B-it-QAT-GGUF",
					indexedModelIdentifier:
						"040891f3ad9352c2ec9389aba79cd022:lmstudio-community/gemma-4-12B-it-QAT-GGUF/gemma.gguf",
					path: "lmstudio-community/gemma-4-12B-it-QAT-GGUF/gemma.gguf",
					machineId: "040891f3ad9352c2ec9389aba79cd022",
					isEmbedding: false,
					status: "idle",
					queued: 0,
					parallel: 1,
					trainedForToolUse: true,
					contextLength: 32768,
				},
			],
			{
				providerIds: ["lmstudio"],
				endpoints: ["http://127.0.0.1:1234/v1"],
			},
		);

		expect(map.get("gemma-4-12b-it-qat")).toBe("040891f3ad9352c2ec9389aba79cd022");
		expect(map.get("lmstudio-community/gemma-4-12B-it-QAT-GGUF")).toBe("040891f3ad9352c2ec9389aba79cd022");
		expect(map.get("040891f3ad9352c2ec9389aba79cd022:lmstudio-community/gemma-4-12B-it-QAT-GGUF/gemma.gguf")).toBe(
			"040891f3ad9352c2ec9389aba79cd022",
		);
		expect(map.get("lmstudio-community/gemma-4-12B-it-QAT-GGUF/gemma.gguf")).toBe("040891f3ad9352c2ec9389aba79cd022");
		expect(map.get("lmstudio:gemma-4-12b-it-qat:http://localhost:1234/v1")).toBe("040891f3ad9352c2ec9389aba79cd022");
		expect(map.get("lmstudio:lmstudio-community/gemma-4-12B-it-QAT-GGUF:default")).toBe(
			"040891f3ad9352c2ec9389aba79cd022",
		);
	});
});
