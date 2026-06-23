import { afterEach, describe, expect, it } from "vitest";
import { configureNKleinAiSdkWarnings } from "../../../src/nklein-sdk/nklein-ai-sdk-warnings";

describe("configureNKleinAiSdkWarnings", () => {
	afterEach(() => {
		delete (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS;
	});

	it("silences the external ai package's per-call warnings and logs the rationale exactly once", () => {
		const lines: string[] = [];
		configureNKleinAiSdkWarnings((message) => lines.push(message));
		// Idempotent: a second call neither re-logs nor changes anything (module-level guard).
		configureNKleinAiSdkWarnings((message) => lines.push(message));

		// The official AI SDK switch is set to false → its per-call warnings are dropped at the source.
		expect((globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS).toBe(false);
		// Exactly one startup line, naming the external package so the behavior is discoverable.
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("ai` package");
	});
});
