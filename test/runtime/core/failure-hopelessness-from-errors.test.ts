import { describe, expect, it } from "vitest";
import { assessHopelessnessFromErrors } from "../../../src/core/failure-hopelessness-from-errors";
import { classifyFailureSignature } from "../../../src/core/failure-signature";

/**
 * §5.AW raw-error adapter: two DIFFERENT-lineage models failing with the SAME CLASS of error (after classification)
 * park the card early; everything else keeps the ladder running. The tests below build REAL error inputs whose
 * `classifyFailureSignature` outputs are asserted, so the diversity/short-circuit logic is exercised end-to-end.
 */
describe("assessHopelessnessFromErrors (§5.AW — park early from raw thrown errors)", () => {
	it("CENTERPIECE: two diverse lineages throwing the same CLASS of error (differently phrased) = hopeless", () => {
		// A thrown Error vs a raw string — DIFFERENT text, but both classify to `model_unavailable`.
		const gptOssError = new Error("connect ECONNREFUSED 127.0.0.1:1234");
		const deepseekError = "connection refused by the endpoint";
		// Guard the premise: distinct raw errors, one shared classified signature.
		expect(classifyFailureSignature(gptOssError).signature).toBe("model_unavailable");
		expect(classifyFailureSignature(deepseekError).signature).toBe("model_unavailable");

		const verdict = assessHopelessnessFromErrors([
			{ modelId: "openai/gpt-oss-120b", error: gptOssError },
			{ modelId: "deepseek-r1-distill-qwen-7b", error: deepseekError },
		]);

		expect(verdict.hopeless).toBe(true);
		expect(verdict).toMatchObject({ signature: "model_unavailable" });
	});

	it("same-lineage twin failures prove nothing (correlated blind spots) = not hopeless", () => {
		const verdict = assessHopelessnessFromErrors([
			{ modelId: "qwopus3.5-4b-coder-mtp", error: new Error("connection refused") },
			{ modelId: "qwen3.5-9b-mlx", error: "econnrefused" },
		]);
		expect(verdict.hopeless).toBe(false);
	});

	it("a single attempt keeps the ladder running (needs two to compare)", () => {
		const verdict = assessHopelessnessFromErrors([
			{ modelId: "openai/gpt-oss-120b", error: new Error("connection refused") },
		]);
		expect(verdict.hopeless).toBe(false);
	});

	it("ADVERSARIAL: diverse lineages but DIFFERENT classified signatures = not hopeless (keys on signature, not text)", () => {
		// Two genuinely different failure classes: a context-window overflow vs a rate-limit throttle.
		const overflowError = new Error("This model's maximum context length is 8192 tokens");
		const rateLimitError = "429 Too Many Requests — rate limit exceeded";
		expect(classifyFailureSignature(overflowError).signature).toBe("context_overflow");
		expect(classifyFailureSignature(rateLimitError).signature).toBe("rate_limited");

		const verdict = assessHopelessnessFromErrors([
			{ modelId: "openai/gpt-oss-120b", error: overflowError },
			{ modelId: "gemma-3-27b-it", error: rateLimitError },
		]);
		expect(verdict.hopeless).toBe(false);
	});

	it("no attempts at all = not hopeless (empty history)", () => {
		expect(assessHopelessnessFromErrors([]).hopeless).toBe(false);
	});
});
