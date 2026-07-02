import { describe, expect, it } from "vitest";
import { assessHopelessness } from "../../../src/core/failure-hopelessness";

describe("assessHopelessness (W4.4 — cross-lineage identical failures park early)", () => {
	it("two DIFFERENT lineages failing identically = hopeless (park early)", () => {
		const verdict = assessHopelessness([
			{ modelId: "qwopus3.5-4b-coder-mtp", signature: "context_overflow" },
			{ modelId: "openai/gpt-oss-120b", signature: "context_overflow" },
		]);
		expect(verdict.hopeless).toBe(true);
		expect(verdict).toMatchObject({ signature: "context_overflow" });
	});

	it("the SAME lineage failing twice proves nothing (correlated blind spots)", () => {
		const verdict = assessHopelessness([
			{ modelId: "qwopus3.5-4b-coder-mtp", signature: "context_overflow" },
			{ modelId: "qwen3.5-9b-mlx", signature: "context_overflow" },
		]);
		expect(verdict.hopeless).toBe(false);
	});

	it("different signatures across lineages = not hopeless (different problems, keep the ladder)", () => {
		const verdict = assessHopelessness([
			{ modelId: "qwopus3.5-4b-coder-mtp", signature: "context_overflow" },
			{ modelId: "openai/gpt-oss-120b", signature: "tool_argument_error" },
		]);
		expect(verdict.hopeless).toBe(false);
	});

	it("unknown lineages (per-machine aliases) never trip the short-circuit", () => {
		const verdict = assessHopelessness([
			{ modelId: "coder-gpu", signature: "context_overflow" },
			{ modelId: "openai/gpt-oss-120b", signature: "context_overflow" },
		]);
		expect(verdict.hopeless).toBe(false);
	});

	it("fewer than two attempts keeps the ladder running", () => {
		expect(assessHopelessness([{ modelId: "openai/gpt-oss-120b", signature: "x" }]).hopeless).toBe(false);
		expect(assessHopelessness([]).hopeless).toBe(false);
	});
});
