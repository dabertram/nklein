import { describe, expect, it } from "vitest";
import { evaluateTrustedAutoMerge } from "../../../src/cline-sdk/cline-trusted-auto-merge";

describe("trusted auto merge", () => {
	it("stays disabled unless explicitly requested and enabled", () => {
		expect(
			evaluateTrustedAutoMerge({
				requested: false,
				evalPassed: true,
				testsPassed: true,
				changedFiles: ["src/components/app.tsx"],
				regressionDelta: 0,
				env: { KANBAN_ENABLE_TRUSTED_AUTO_MERGE: "1" },
			}),
		).toMatchObject({
			allowed: false,
		});

		expect(
			evaluateTrustedAutoMerge({
				requested: true,
				evalPassed: true,
				testsPassed: true,
				changedFiles: ["src/components/app.tsx"],
				regressionDelta: 0,
				env: {},
			}),
		).toMatchObject({
			allowed: false,
		});
	});

	it("blocks protected paths even when all gates are green", () => {
		const decision = evaluateTrustedAutoMerge({
			requested: true,
			evalPassed: true,
			testsPassed: true,
			changedFiles: ["src/security/passcode-manager.ts"],
			regressionDelta: 0,
			env: { KANBAN_ENABLE_TRUSTED_AUTO_MERGE: "1" },
		});

		expect(decision.allowed).toBe(false);
		expect(decision.protectedPaths).toEqual(["src/security/passcode-manager.ts"]);
	});

	it("allows trusted auto-merge only after explicit green gates", () => {
		expect(
			evaluateTrustedAutoMerge({
				requested: true,
				evalPassed: true,
				testsPassed: true,
				changedFiles: ["src/components/app.tsx"],
				regressionDelta: 0,
				env: { KANBAN_ENABLE_TRUSTED_AUTO_MERGE: "1" },
			}),
		).toMatchObject({
			allowed: true,
		});
	});

	it("blocks trusted auto-merge when the regression delta is unknown", () => {
		const decision = evaluateTrustedAutoMerge({
			requested: true,
			evalPassed: true,
			testsPassed: true,
			changedFiles: ["src/components/app.tsx"],
			regressionDelta: null,
			env: { KANBAN_ENABLE_TRUSTED_AUTO_MERGE: "1" },
		});

		expect(decision).toMatchObject({
			allowed: false,
			reason: "trusted auto-merge blocked because the regression delta is unknown.",
		});
	});
});
