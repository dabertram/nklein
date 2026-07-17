import { describe, expect, it } from "vitest";
import { buildFrameworkPreamble, detectFrontendFramework } from "../../../src/core/frontend-framework-preamble";

describe("detectFrontendFramework", () => {
	it("detects react + major from a caret range", () => {
		expect(detectFrontendFramework({ react: "^19.0.1", "react-dom": "^19.0.1" })).toEqual({
			framework: "react",
			major: 19,
		});
	});

	it("prioritizes react over a stray svelte devtool", () => {
		expect(detectFrontendFramework({ svelte: "^5.0.0", react: "~18.3.1" })?.framework).toBe("react");
	});

	it("detects angular via @angular/core and vue via vue", () => {
		expect(detectFrontendFramework({ "@angular/core": "17.1.0" })).toEqual({ framework: "angular", major: 17 });
		expect(detectFrontendFramework({ vue: "^3.4.0" })).toEqual({ framework: "vue", major: 3 });
	});

	it("returns null for backend-only deps and null major for unparseable ranges", () => {
		expect(detectFrontendFramework({ express: "^4.18.0", zod: "^3.0.0" })).toBeNull();
		expect(detectFrontendFramework({ react: "workspace:*" })?.major).toBeNull();
	});
});

describe("buildFrameworkPreamble", () => {
	it("returns [] for non-frontend workspaces (spreadable unconditionally)", () => {
		expect(buildFrameworkPreamble(null)).toEqual([]);
	});

	it("emits the component rule + import-verification rule + version block for React 19", () => {
		const lines = buildFrameworkPreamble({ framework: "react", major: 19 });
		expect(lines[0]).toContain("react 19");
		expect(lines.join("\n")).toContain("COMPONENTS with props");
		expect(lines.join("\n")).toContain("INSTALLED version");
		expect(lines.join("\n")).toContain("forwardRef` is unnecessary");
	});

	it("scopes React ≤18 rules to the old major (no use()/Actions)", () => {
		const lines = buildFrameworkPreamble({ framework: "react", major: 18 });
		expect(lines.join("\n")).toContain("NOT available");
	});

	it("stays terse (instruction budget) — at most 5 lines", () => {
		for (const detection of [
			{ framework: "react" as const, major: 19 },
			{ framework: "vue" as const, major: 3 },
			{ framework: "angular" as const, major: 17 },
			{ framework: "svelte" as const, major: 5 },
		]) {
			expect(buildFrameworkPreamble(detection).length).toBeLessThanOrEqual(5);
		}
	});
});
