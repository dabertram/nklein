import { describe, expect, it } from "vitest";
import { isCreditLimitError, isLocalModelRuntimeUnavailableError } from "../../../src/nklein-sdk/nklein-session-state";

describe("isLocalModelRuntimeUnavailableError", () => {
	it("matches a crashed/unloaded local model host", () => {
		for (const message of [
			"The model has crashed without additional information. (Exit code: null)",
			"Model not found: deepseek/deepseek-r1-0528-qwen3-8b",
			"No models loaded",
			"model is not loaded",
			"failed to load model",
		]) {
			expect(isLocalModelRuntimeUnavailableError(message)).toBe(true);
		}
	});

	it("matches a dropped connection to the local server", () => {
		for (const message of [
			"fetch failed",
			"request to http://127.0.0.1:1234 failed, reason: ECONNREFUSED",
			"socket hang up",
			"read ECONNRESET",
			"terminated",
			"Premature close",
		]) {
			expect(isLocalModelRuntimeUnavailableError(message)).toBe(true);
		}
	});

	it("is case-insensitive", () => {
		expect(isLocalModelRuntimeUnavailableError("ECONNREFUSED")).toBe(true);
		expect(isLocalModelRuntimeUnavailableError("Model Not Found")).toBe(true);
	});

	it("does not match unrelated or empty errors", () => {
		expect(isLocalModelRuntimeUnavailableError(null)).toBe(false);
		expect(isLocalModelRuntimeUnavailableError("")).toBe(false);
		expect(isLocalModelRuntimeUnavailableError("decompose_project rejected: dependency-coherence")).toBe(false);
		expect(isLocalModelRuntimeUnavailableError("400 invalid request: bad tool arguments")).toBe(false);
	});

	it("stays distinct from credit-limit errors", () => {
		expect(isCreditLimitError("Insufficient balance")).toBe(true);
		expect(isLocalModelRuntimeUnavailableError("Insufficient balance")).toBe(false);
	});
});
