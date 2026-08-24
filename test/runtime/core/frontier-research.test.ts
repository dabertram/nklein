import { describe, expect, it } from "vitest";
import {
	assessFrontierFreshness,
	buildFrontierSynthesisMessages,
	clampFrontierSynthesis,
	FRONTIER_SYNTHESIS_JSON_SCHEMA,
	frontierReportSchema,
	frontierSynthesisSchema,
} from "../../../src/core/frontier-research";

describe("frontier research core", () => {
	it("frames evidence as untrusted data and carries device/installed/mechanism context", () => {
		const { system, user } = buildFrontierSynthesisMessages({
			evidence: [{ url: "https://example.com/a", title: "New model X", text: "X".repeat(5_000) }],
			installedModels: ["qwen3.8-27b-mlx", "qwen/qwen3.6-35b-a3b"],
			deviceRamGb: 128,
			mechanisms: ["review-redecompose", "spec-index", "held-out-oracle"],
		});
		expect(system).toContain("untrusted data");
		expect(system).toContain("recommend NOTHING that is closed-weights or anonymous");
		expect(user).toContain("128 GB unified");
		expect(user).toContain("qwen3.8-27b-mlx");
		expect(user).toContain("review-redecompose");
		// Per-source budget bounds the prompt: 5k of source text must not arrive whole.
		expect(user.length).toBeLessThan(4_500);
	});

	it("says honestly when nothing was fetched", () => {
		const { user } = buildFrontierSynthesisMessages({
			evidence: [],
			installedModels: [],
			deviceRamGb: null,
			mechanisms: [],
		});
		expect(user).toContain("(no sources were fetched)");
		expect(user).toContain("DEVICE RAM: unknown");
	});

	it("clamps an overlong synthesis instead of rejecting it (first live flight lesson)", () => {
		const clamped = clampFrontierSynthesis({
			findings: [],
			modelRecommendations: [],
			selfReflection: [{ topic: "t", frontier: "f", self: "S".repeat(450), verdict: "par" }],
			funLine: "F".repeat(250),
		}) as { selfReflection: { self: string }[]; funLine: string };
		expect(clamped.selfReflection[0]?.self.length).toBe(300);
		expect(clamped.selfReflection[0]?.self.endsWith("…")).toBe(true);
		expect(clamped.funLine.length).toBe(200);
		expect(frontierSynthesisSchema.safeParse(clamped).success).toBe(true);
	});

	it("freshness ladder: never → fresh (<3d) → aging (<10d) → stale", () => {
		const now = 1_787_300_000_000;
		expect(assessFrontierFreshness(now, null).status).toBe("never");
		expect(assessFrontierFreshness(now, now - 3_600_000).status).toBe("fresh");
		expect(assessFrontierFreshness(now, now - 5 * 86_400_000).status).toBe("aging");
		expect(assessFrontierFreshness(now, now - 30 * 86_400_000)).toEqual({ status: "stale", ageDays: 30 });
	});

	it("the synthesis zod schema and the structured-output JSON schema agree on required fields", () => {
		const sample = {
			findings: [
				{
					kind: "model",
					name: "Example-32B",
					summary: "An open-weight coder.",
					sourceUrl: "https://example.com",
					publisher: "Example Lab",
					openWeights: true,
				},
			],
			modelRecommendations: [
				{
					name: "Example-32B",
					publisher: "Example Lab",
					reason: "Leads local coding benchmarks at a size that fits.",
					localFit: "fits",
					alreadyInstalled: false,
				},
			],
			selfReflection: [
				{
					topic: "review loops",
					frontier: "Multi-agent verify passes.",
					self: "Second-opinion review with bounded redrives.",
					verdict: "par",
				},
			],
			funLine: "The frontier moved; !Klein moved with it.",
		};
		expect(frontierSynthesisSchema.safeParse(sample).success).toBe(true);
		const properties = FRONTIER_SYNTHESIS_JSON_SCHEMA.properties as Record<string, unknown>;
		expect(Object.keys(properties).sort()).toEqual(["findings", "funLine", "modelRecommendations", "selfReflection"]);
		// A full report = synthesis + runner stamps.
		expect(
			frontierReportSchema.safeParse({
				...sample,
				schemaVersion: 1,
				ranAt: 1_787_300_000_000,
				researchModelId: "qwen3.8-27b-mlx",
				questionsAsked: ["q"],
				sourceCount: 1,
			}).success,
		).toBe(true);
	});
});
