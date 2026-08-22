import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFrontierResearchRunner } from "../../../src/server/frontier-research-runner";

function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
	const startedAt = Date.now();
	return new Promise((resolve, reject) => {
		const poll = async () => {
			if (await check()) return resolve();
			if (Date.now() - startedAt > timeoutMs) return reject(new Error("condition not reached"));
			setTimeout(() => void poll(), 25);
		};
		void poll();
	});
}

const SYNTHESIS = {
	findings: [
		{
			kind: "model" as const,
			name: "Example-32B",
			summary: "Open-weight coder from the evidence.",
			sourceUrl: "https://example.com/a",
			publisher: "Example Lab",
			openWeights: true,
		},
	],
	modelRecommendations: [],
	selfReflection: [
		{ topic: "review", frontier: "verify passes", self: "second-opinion loop", verdict: "par" as const },
	],
	funLine: "Radar spun; frontier seen.",
};

describe("frontier research runner", () => {
	let storeRootDir: string;
	beforeEach(() => {
		storeRootDir = mkdtempSync(join(tmpdir(), "frontier-"));
	});
	afterEach(() => {
		rmSync(storeRootDir, { recursive: true, force: true });
	});

	it("refuses honestly when egress is off — the icon must know WHY the radar is dark", async () => {
		const runner = createFrontierResearchRunner({
			runRetrieval: null,
			createSynthesisClient: async () => null,
			installedModels: async () => [],
			mechanisms: async () => [],
			deviceRamGb: () => null,
			isEgressEnabled: () => false,
			storeRootDir,
		});
		const outcome = await runner.run();
		expect(outcome.started).toBe(false);
		expect(outcome.reason).toContain("egress is off");
		expect((await runner.status()).freshness).toBe("never");
	});

	it("runs the sweep, synthesizes with the local model, persists, and status turns fresh", async () => {
		const asked: string[] = [];
		const runner = createFrontierResearchRunner({
			runRetrieval: async (question) => {
				asked.push(question);
				return { sources: [{ url: "https://example.com/a", title: "A", text: "evidence text" }] };
			},
			createSynthesisClient: async () => ({
				modelId: "qwen3.8-27b-mlx",
				generateStructured: async () => SYNTHESIS,
			}),
			installedModels: async () => ["qwen3.8-27b-mlx"],
			mechanisms: async () => ["review-redecompose"],
			deviceRamGb: () => 128,
			isEgressEnabled: () => true,
			storeRootDir,
		});
		const outcome = await runner.run();
		expect(outcome.started).toBe(true);
		await waitFor(async () => (await runner.latest()) !== null);
		const report = await runner.latest();
		expect(asked.length).toBe(3);
		expect(report?.researchModelId).toBe("qwen3.8-27b-mlx");
		expect(report?.sourceCount).toBe(3);
		expect(report?.funLine).toBe("Radar spun; frontier seen.");
		const status = await runner.status();
		expect(status.freshness).toBe("fresh");
		expect(status.latestFunLine).toBe("Radar spun; frontier seen.");
	});

	it("a failed retrieval question does not sink the run; a second run while one is live is refused", async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const runner = createFrontierResearchRunner({
			runRetrieval: async (question) => {
				if (question.includes("techniques")) throw new Error("backend_error");
				await gate;
				return { sources: [] };
			},
			createSynthesisClient: async () => ({
				modelId: "m",
				generateStructured: async () => SYNTHESIS,
			}),
			installedModels: async () => [],
			mechanisms: async () => [],
			deviceRamGb: () => null,
			isEgressEnabled: () => true,
			storeRootDir,
		});
		const first = await runner.run();
		expect(first.started).toBe(true);
		const second = await runner.run();
		expect(second.started).toBe(false);
		expect(second.reason).toContain("already in progress");
		release();
		await waitFor(async () => (await runner.latest()) !== null);
		expect((await runner.latest())?.sourceCount).toBe(0);
	});
});
