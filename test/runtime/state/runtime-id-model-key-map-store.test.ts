import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	initSharedRuntimeIdModelKeyMap,
	learnSharedLoadedDescriptors,
	loadRuntimeIdModelKeyMap,
	RuntimeIdModelKeyMapStore,
	resetSharedRuntimeIdModelKeyMapForTest,
	saveRuntimeIdModelKeyMap,
	sharedRuntimeIdModelKeyMap,
} from "../../../src/state/runtime-id-model-key-map-store";

const tmpFile = async (): Promise<string> => join(await mkdtemp(join(tmpdir(), "nklein-idmap-")), "map.json");

afterEach(() => resetSharedRuntimeIdModelKeyMapForTest());

describe("loadRuntimeIdModelKeyMap / saveRuntimeIdModelKeyMap", () => {
	it("round-trips a saved map", async () => {
		const path = await tmpFile();
		await saveRuntimeIdModelKeyMap(path, { "coder-gpu": "qwen2.5-coder-14b" });
		expect(await loadRuntimeIdModelKeyMap(path)).toEqual({ "coder-gpu": "qwen2.5-coder-14b" });
	});

	it("returns an empty map for a missing file (never throws)", async () => {
		expect(await loadRuntimeIdModelKeyMap(await tmpFile())).toEqual({});
	});

	it("is tolerant of corrupt JSON and non-object / non-string entries", async () => {
		const bad = await tmpFile();
		await writeFile(bad, "not json", "utf8");
		expect(await loadRuntimeIdModelKeyMap(bad)).toEqual({});

		const mixed = await tmpFile();
		await writeFile(mixed, JSON.stringify({ good: "qwen3-8b", bad: 42, blank: "  " }), "utf8");
		expect(await loadRuntimeIdModelKeyMap(mixed)).toEqual({ good: "qwen3-8b" });
	});
});

describe("RuntimeIdModelKeyMapStore", () => {
	it("learns from live descriptors and persists (debounced)", async () => {
		const path = await tmpFile();
		const store = new RuntimeIdModelKeyMapStore(path, 0);
		store.learn([{ runtimeId: "coder-gpu", modelKey: "qwen2.5-coder-14b" }]);
		expect(store.current()).toEqual({ "coder-gpu": "qwen2.5-coder-14b" });
		await new Promise((r) => setTimeout(r, 5));
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ "coder-gpu": "qwen2.5-coder-14b" });
	});

	it("retains cold ids across loads (a not-currently-loaded model still resolves)", async () => {
		const path = await tmpFile();
		await saveRuntimeIdModelKeyMap(path, { "cold-id": "phi-4-reasoning-plus" });
		const store = new RuntimeIdModelKeyMapStore(path, 0);
		await store.load();
		store.learn([{ runtimeId: "hot-id", modelKey: "qwen3-8b" }]);
		expect(store.current()).toEqual({ "cold-id": "phi-4-reasoning-plus", "hot-id": "qwen3-8b" });
	});
});

describe("shared singleton", () => {
	it("is inert (empty map) until initialized, then reads learned entries", async () => {
		expect(sharedRuntimeIdModelKeyMap()).toEqual({}); // uninitialized
		learnSharedLoadedDescriptors([{ runtimeId: "x", modelKey: "y" }]); // no-op, uninitialized
		expect(sharedRuntimeIdModelKeyMap()).toEqual({});

		await initSharedRuntimeIdModelKeyMap(await tmpFile());
		learnSharedLoadedDescriptors([{ runtimeId: "coder-gpu", modelKey: "qwen2.5-coder-14b" }]);
		expect(sharedRuntimeIdModelKeyMap()).toEqual({ "coder-gpu": "qwen2.5-coder-14b" });
	});
});
