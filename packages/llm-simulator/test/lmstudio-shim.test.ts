import { describe, expect, it } from "vitest";
import { createSimulatorServer } from "../src/server.js";
import type { ScenarioScript } from "../src/scenario/track-types.js";

const emptyScript: ScenarioScript = { name: "shim", seed: 1, tracks: [] };

describe("LM Studio /api/v0 shim", () => {
	it("serves the declared fleet with load states on both catalog surfaces", async () => {
		const server = createSimulatorServer(emptyScript, {
			models: [
				{ id: "qwen-coder-loaded", state: "loaded", family: "qwen", maxContextLength: 32768 },
				{ id: "deepseek-available", state: "not-loaded", family: "deepseek" },
			],
		});
		await server.start();
		try {
			const port = server.port();
			const v0 = await (await fetch(`http://127.0.0.1:${port}/api/v0/models`)).json();
			expect(v0.data.map((m: { id: string }) => m.id).sort()).toEqual(["deepseek-available", "qwen-coder-loaded"]);
			expect(v0.data.find((m: { id: string }) => m.id === "qwen-coder-loaded").state).toBe("loaded");
			expect(v0.data.find((m: { id: string }) => m.id === "deepseek-available").state).toBe("not-loaded");

			const v1 = await (await fetch(`http://127.0.0.1:${port}/api/v1/models`)).json();
			expect(v1.models.map((m: { id: string }) => m.id).sort()).toEqual(["deepseek-available", "qwen-coder-loaded"]);
		} finally {
			await server.stop();
		}
	});
});
