import { describe, expect, it } from "vitest";
import { checkRoleModelReadiness } from "../../../src/core/role-model-readiness";

const loaded = [
	{ identifier: "qwen/qwen3.6-27b-m5max", modelKey: "qwen/qwen3.6-27b" },
	{ identifier: "qwopus3.5-9b-coder-mtp", modelKey: "qwopus3.5-9b-coder-mtp" },
];

describe("checkRoleModelReadiness", () => {
	it("flags a role whose configured model is not loaded", () => {
		const result = checkRoleModelReadiness({
			requirements: [
				{ role: "architect", modelId: "qwopus3.5-9b-coder-mtp" },
				{ role: "worker", modelId: "qwen/qwen2.5-coder-14b" },
				{ role: "reviewer", modelId: "qwen/qwen2.5-coder-14b" },
			],
			loaded,
		});
		expect(result.ready).toBe(false);
		expect(result.missing.map((m) => m.role).sort()).toEqual(["reviewer", "worker"]);
		expect(result.satisfied.map((s) => s.role)).toEqual(["architect"]);
	});

	it("is ready when every configured role model is loaded (matching identifier OR modelKey)", () => {
		const result = checkRoleModelReadiness({
			requirements: [
				{ role: "architect", modelId: "qwopus3.5-9b-coder-mtp" },
				// Matches via the publisher modelKey rather than the invoke identifier.
				{ role: "worker", modelId: "qwen/qwen3.6-27b" },
			],
			loaded,
		});
		expect(result.ready).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it("ignores unset roles (null modelId inherits the default model)", () => {
		const result = checkRoleModelReadiness({
			requirements: [
				{ role: "architect", modelId: null },
				{ role: "worker", modelId: "qwen/qwen3.6-27b-m5max" },
			],
			loaded,
		});
		expect(result.ready).toBe(true);
		expect(result.satisfied.map((s) => s.role)).toEqual(["worker"]);
	});

	it("matches case-insensitively and trims whitespace", () => {
		const result = checkRoleModelReadiness({
			requirements: [{ role: "worker", modelId: "  QWOPUS3.5-9B-Coder-MTP  " }],
			loaded,
		});
		expect(result.ready).toBe(true);
	});
});
