import { expect, test } from "@playwright/test";
import { buildMockRuntimeConfig, installRuntimeMock } from "./harness/runtime-mock";

const step = (stepId: string, title: string, recommendation = `${title} recommendation`) => ({
	stepId,
	title,
	recommendation,
	detail: `${title} detail`,
});

test.describe("guided setup capability coverage", () => {
	test("walks the shared global and project plans across every F5.3 capability group", async ({ page }) => {
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => pageErrors.push(error.message));

		await installRuntimeMock(page, {
			queryStubs: {
				"runtime.getConfig": buildMockRuntimeConfig(),
				"runtime.getGlobalSetupPlan": {
					kind: "global",
					completedAt: null,
					steps: [
						step("provider", "Provider & endpoint"),
						step("models", "Model roles & fleet"),
						step("sandbox", "Docker sandbox"),
						step(
							"resources",
							"Resource policy",
							"Fast-memory budgets: legion5pro 8 GB; m4mini 24 GB; m5max 128 GB.",
						),
						step("concurrency", "Concurrency"),
						step("review", "Review posture"),
						step("guardrails", "Swarm guardrails"),
						step("memory", "Memory & MCP"),
						step("egress", "Egress & retrieval", "Fully local — no data leaves this machine."),
						step("desktop", "Desktop & LAN access", "Loopback-only access (recommended default)."),
						step("features", "Optional features"),
					],
				},
				"runtime.getProjectSetupPlan": {
					kind: "project",
					completedAt: null,
					steps: [
						step("isolation", "Project isolation", "Effective profile: lean shared."),
						step("models", "Model roles (this project)"),
						step("resources", "Resource policy (inherited)"),
						step("memory", "Memory & MCP (this project)"),
						step("egress", "Egress & retrieval (inherited)"),
						step("desktop", "Desktop access (inherited)"),
						step("concurrency", "Concurrency override"),
						step("overlap", "File-overlap parallelism override"),
						step("acceptance", "Acceptance command"),
						step("baseBranch", "Base branch"),
					],
				},
			},
		});

		await page.goto("/");
		await expect(page.getByRole("heading", { name: "Guided setup", exact: true })).toBeVisible();
		await expect(page.getByText("Step 1 of 12", { exact: true })).toBeVisible();
		for (const title of ["Provider & endpoint", "Model roles & fleet", "Docker sandbox"]) {
			await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Next", exact: true }).click();
		}
		await expect(page.getByRole("heading", { name: "Resource policy", exact: true })).toBeVisible();
		await expect(page.getByText(/legion5pro 8 GB.*m4mini 24 GB.*m5max 128 GB/u)).toBeVisible();
		for (let index = 0; index < 6; index += 1) {
			await page.getByRole("button", { name: "Next", exact: true }).click();
		}
		await expect(page.getByRole("heading", { name: "Desktop & LAN access", exact: true })).toBeVisible();
		await expect(page.getByText("Loopback-only access (recommended default).", { exact: true })).toBeVisible();

		await page.getByRole("button", { name: "Skip setup", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Project setup", exact: true })).toBeVisible();
		await expect(page.getByText("Step 1 of 10", { exact: true })).toBeVisible();
		const projectHeadings = [
			"Project isolation",
			"Model roles (this project)",
			"Resource policy (inherited)",
			"Memory & MCP (this project)",
			"Egress & retrieval (inherited)",
			"Desktop access (inherited)",
		];
		for (const [index, title] of projectHeadings.entries()) {
			await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
			if (index < projectHeadings.length - 1) {
				await page.getByRole("button", { name: "Next", exact: true }).click();
			}
		}

		expect(consoleErrors).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
