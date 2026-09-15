import { describe, expect, it } from "vitest";

import { type LmsPsModel, LOCAL_MACHINE_ID } from "../../../src/core/lms-ps-json";
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

describe("buildLmStudioMachineByModelId — the same model local AND over LM Link (finding 9)", () => {
	const model = (overrides: Partial<LmsPsModel>): LmsPsModel =>
		({
			identifier: "x",
			modelKey: "x",
			path: null,
			indexedModelIdentifier: null,
			machineId: LOCAL_MACHINE_ID,
			isEmbedding: false,
			contextLength: null,
			...overrides,
		}) as LmsPsModel;

	it("keeps the bare key on the LOCAL instance even though the linked copy is listed later with the same key", () => {
		const map = buildLmStudioMachineByModelId([
			model({ identifier: "qwen/qwen3.6-35b-a3b", modelKey: "qwen/qwen3.6-35b-a3b", path: "qwen/q.gguf" }),
			model({
				identifier: "qwen3.6-35b-a3b@legion",
				modelKey: "qwen/qwen3.6-35b-a3b",
				path: "qwen/q.gguf",
				machineId: "legion",
			}),
		]);
		expect(map.get("qwen/qwen3.6-35b-a3b")).toBe(LOCAL_MACHINE_ID);
		expect(map.get("qwen3.6-35b-a3b@legion")).toBe("legion");
		expect(map.get("qwen/q.gguf")).toBe(LOCAL_MACHINE_ID);
	});

	it("still maps a key that is loaded ONLY on a linked machine to that machine", () => {
		const map = buildLmStudioMachineByModelId([
			model({ identifier: "qwen/qwen3.8-27b", modelKey: "qwen/qwen3.8-27b" }),
			model({ identifier: "dirk-qwen3.8-iq4xs@m4mini", modelKey: "dirk/qwen3.8-iq4xs", machineId: "m4mini" }),
		]);
		expect(map.get("dirk/qwen3.8-iq4xs")).toBe("m4mini");
		expect(map.get("dirk-qwen3.8-iq4xs@m4mini")).toBe("m4mini");
		expect(map.get("qwen/qwen3.8-27b")).toBe(LOCAL_MACHINE_ID);
	});
});
