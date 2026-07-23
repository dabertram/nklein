import { describe, expect, it } from "vitest";
import {
	deriveFrontendPreviewPlan,
	deriveFrontendRouteFromChangedPaths,
} from "../../../src/core/frontend-preview-plan";

describe("deriveFrontendPreviewPlan", () => {
	it("derives Vite from a declared script and pins loopback + strict task-local port", () => {
		expect(
			deriveFrontendPreviewPlan({
				packageJson: { scripts: { dev: "vite" }, devDependencies: { vite: "1" } },
				packageManager: "pnpm",
				port: 23111,
				route: "board",
			}),
		).toEqual({
			argv: ["pnpm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "23111", "--strictPort"],
			env: { HOST: "127.0.0.1", PORT: "23111", BROWSER: "none", CI: "1" },
			route: "/board",
			framework: "vite",
		});
	});

	it("uses framework-specific Next flags and never invents an undeclared start command", () => {
		expect(
			deriveFrontendPreviewPlan({
				packageJson: { scripts: { start: "next start" }, dependencies: { next: "16" } },
				packageManager: "npm",
				port: 24000,
			}),
		).toMatchObject({ argv: ["npm", "run", "start", "--", "-H", "127.0.0.1", "-p", "24000"], framework: "next" });
		expect(
			deriveFrontendPreviewPlan({ packageJson: { dependencies: { vite: "1" } }, packageManager: "npm", port: 1 }),
		).toBeNull();
	});
});

describe("deriveFrontendRouteFromChangedPaths", () => {
	it("maps file-system routers without guessing dynamic parameters", () => {
		expect(deriveFrontendRouteFromChangedPaths(["web/app/settings/profile/page.tsx"])).toBe("/settings/profile");
		expect(deriveFrontendRouteFromChangedPaths(["src/routes/admin/+page.svelte"])).toBe("/admin");
		expect(deriveFrontendRouteFromChangedPaths(["pages/account/index.tsx"])).toBe("/account");
		expect(deriveFrontendRouteFromChangedPaths(["app/users/[id]/page.tsx"])).toBe("/");
	});
});
