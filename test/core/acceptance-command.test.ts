import { describe, expect, it } from "vitest";
import { sanitizeAcceptanceCommand, sanitizeAcceptanceCommandOrNull } from "../../src/core/acceptance-command";

describe("sanitizeAcceptanceCommand (2026-09-07 dschinn acceptance-line bug)", () => {
	it("drops the inlined spec's prose tail — the line that failed every dschinn card", () => {
		// specification.md line 6, verbatim, is what the first-match extractor captured.
		expect(
			sanitizeAcceptanceCommand(
				'npm test — **BUT SEE "`npm test` IS NOT AN INDEPENDENT ORACLE" BELOW. A green run ... is not evidence.**',
			),
		).toBe("npm test");
	});

	it("leaves a plain command and real shell syntax intact", () => {
		expect(sanitizeAcceptanceCommand("npm test")).toBe("npm test");
		expect(sanitizeAcceptanceCommand("  vitest run test/x.test.ts  ")).toBe("vitest run test/x.test.ts");
		// `--` flag separators, pipes and && are NOT prose markers and must survive.
		expect(sanitizeAcceptanceCommand("npm test -- --run")).toBe("npm test -- --run");
		expect(sanitizeAcceptanceCommand("npm run build && npm test")).toBe("npm run build && npm test");
		expect(sanitizeAcceptanceCommand("pytest -q")).toBe("pytest -q");
	});

	it("cuts at an en-dash clause or a backtick aside too", () => {
		expect(sanitizeAcceptanceCommand("cargo test – see notes")).toBe("cargo test");
		expect(sanitizeAcceptanceCommand("go test ./... `(fixtures only)`")).toBe("go test ./...");
	});

	it("sanitizeAcceptanceCommandOrNull returns null for absent or all-prose values", () => {
		expect(sanitizeAcceptanceCommandOrNull(null)).toBeNull();
		expect(sanitizeAcceptanceCommandOrNull("")).toBeNull();
		expect(sanitizeAcceptanceCommandOrNull("   ")).toBeNull();
		expect(sanitizeAcceptanceCommandOrNull("npm test")).toBe("npm test");
		expect(sanitizeAcceptanceCommandOrNull("npm test — but see below")).toBe("npm test");
	});
});
