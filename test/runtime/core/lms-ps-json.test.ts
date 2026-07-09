import { describe, expect, it } from "vitest";
import {
	fetchLmsPsModels,
	groupModelsByMachine,
	LOCAL_MACHINE_ID,
	parseLmsPsModels,
} from "../../../src/core/lms-ps-json";

// Shaped after real `lms ps --json` output: local instances report deviceIdentifier:null, linked remotes report a hex id.
const STDOUT = JSON.stringify([
	{
		type: "llm",
		modelKey: "qwopus3.6-27b-v2-mlx",
		identifier: "qwopus3.6-27b-v2-mlx",
		deviceIdentifier: null,
		status: "idle",
		queued: 0,
		parallel: 2,
		trainedForToolUse: true,
		contextLength: 40000,
	},
	{
		type: "llm",
		modelKey: "unsloth/qwen3.5-9b",
		indexedModelIdentifier: "040891f3ad9352c2ec9389aba79cd022:unsloth/qwen3.5-9b",
		path: "unsloth/qwen3.5-9b",
		identifier: "qwen3.5-9b-mtp-q4-k-xl-legion5pro",
		deviceIdentifier: "040891f3ad9352c2ec9389aba79cd022",
		status: "idle",
		queued: 2,
		parallel: 1,
		trainedForToolUse: true,
		contextLength: 40000,
	},
	{
		type: "embedding",
		modelKey: "nomic-ai/nomic-embed",
		identifier: "text-embedding-nomic-embed-text-v1.5@q8_0-m4mini",
		deviceIdentifier: "2d30f46d0371d004b1758e6df7790a03",
		status: "idle",
		queued: 0,
	},
]);

describe("parseLmsPsModels", () => {
	it("tags each instance with its owning machine (local host vs linked remote)", () => {
		const models = parseLmsPsModels(STDOUT);
		expect(models.map((m) => [m.identifier, m.machineId])).toEqual([
			["qwopus3.6-27b-v2-mlx", LOCAL_MACHINE_ID], // deviceIdentifier:null ⇒ local
			["qwen3.5-9b-mtp-q4-k-xl-legion5pro", "040891f3ad9352c2ec9389aba79cd022"],
			["text-embedding-nomic-embed-text-v1.5@q8_0-m4mini", "2d30f46d0371d004b1758e6df7790a03"],
		]);
	});

	it("captures the real modelKey, embedding flag, status, queue depth, and parallel slots", () => {
		const models = parseLmsPsModels(STDOUT);
		const legion = models[1];
		expect(legion).toMatchObject({
			modelKey: "unsloth/qwen3.5-9b",
			indexedModelIdentifier: "040891f3ad9352c2ec9389aba79cd022:unsloth/qwen3.5-9b",
			path: "unsloth/qwen3.5-9b",
			isEmbedding: false,
			status: "idle",
			queued: 2,
			parallel: 1,
		});
		expect(models[2]?.isEmbedding).toBe(true);
		expect(models[0]?.modelKey).toBe("qwopus3.6-27b-v2-mlx");
		expect(models[0]?.parallel).toBe(2);
	});

	it("falls back modelKey→identifier, defaults queued/parallel, and tolerates junk", () => {
		expect(parseLmsPsModels(JSON.stringify([{ identifier: "only-id" }]))[0]).toMatchObject({
			identifier: "only-id",
			modelKey: "only-id",
			indexedModelIdentifier: null,
			path: null,
			machineId: LOCAL_MACHINE_ID,
			queued: 0,
			parallel: null,
		});
		expect(parseLmsPsModels("not json")).toEqual([]);
		expect(parseLmsPsModels(JSON.stringify({ nope: true }))).toEqual([]);
		expect(parseLmsPsModels(JSON.stringify([{ modelKey: "no-identifier" }]))).toEqual([]); // no id ⇒ skipped
	});

	it("tolerates a wrapped { data: [...] } / { models: [...] } envelope", () => {
		expect(parseLmsPsModels(JSON.stringify({ data: [{ identifier: "a" }] }))).toHaveLength(1);
		expect(parseLmsPsModels(JSON.stringify({ models: [{ identifier: "b" }] }))).toHaveLength(1);
	});
});

describe("groupModelsByMachine", () => {
	it("groups loaded models into per-machine pools", () => {
		const byMachine = groupModelsByMachine(parseLmsPsModels(STDOUT));
		expect(byMachine.get(LOCAL_MACHINE_ID)?.map((m) => m.identifier)).toEqual(["qwopus3.6-27b-v2-mlx"]);
		expect(byMachine.get("040891f3ad9352c2ec9389aba79cd022")).toHaveLength(1);
		expect(byMachine.get("2d30f46d0371d004b1758e6df7790a03")).toHaveLength(1);
		expect(byMachine.size).toBe(3); // three distinct machines
	});
});

describe("fetchLmsPsModels", () => {
	it("parses the runner's stdout and returns [] on failure", async () => {
		expect(await fetchLmsPsModels(async () => ({ stdout: STDOUT, exitCode: 0 }))).toHaveLength(3);
		expect(
			await fetchLmsPsModels(async () => {
				throw new Error("lms not found");
			}),
		).toEqual([]);
	});
});
