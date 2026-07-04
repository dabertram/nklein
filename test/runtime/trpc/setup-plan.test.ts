import { describe, expect, it, vi } from "vitest";
import { handleGetGlobalSetupPlan, handleGetProjectSetupPlan } from "../../../src/trpc/runtime-api/setup-plan";

describe("handleGetGlobalSetupPlan (§5.BA)", () => {
	const baseSources = {
		getHardware: () => ({ totalRamMb: 32_768, cpuCount: 10 }),
		getLoadedModelIds: async () => ["a", "b"],
		providerEndpoint: "http://localhost:1234/v1",
		getDockerAvailable: () => true,
		getDockerVmMemoryMb: async () => 16_384,
		getSecondOpinionReviewEnabled: () => true,
		getCompletedAt: () => null,
	};

	it("assembles the six-step global plan with the completion stamp", async () => {
		const plan = await handleGetGlobalSetupPlan(baseSources);
		expect(plan.kind).toBe("global");
		expect(plan.completedAt).toBeNull();
		expect(plan.steps.map((s) => s.stepId)).toEqual([
			"provider",
			"sandbox",
			"concurrency",
			"review",
			"guardrails",
			"features",
		]);
		// Provider reachable → the provider step reports the loaded models.
		expect(plan.steps[0]?.recommendation).toContain("2 models loaded");
	});

	it("reports provider-unreachable when the model probe rejects (fail-soft)", async () => {
		const plan = await handleGetGlobalSetupPlan({
			...baseSources,
			getLoadedModelIds: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		expect(plan.steps[0]?.recommendation).toContain("No local provider reached");
	});

	it("surfaces the completion stamp when set", async () => {
		const plan = await handleGetGlobalSetupPlan({ ...baseSources, getCompletedAt: () => 1_700_000 });
		expect(plan.completedAt).toBe(1_700_000);
	});

	it("warns in the sandbox step when the probed Docker VM is too small for the target concurrency", async () => {
		// Big host (128 GB / 18 CPU) but a default ~8 GB Docker VM → the recommender warns to raise the VM.
		const plan = await handleGetGlobalSetupPlan({
			...baseSources,
			getHardware: () => ({ totalRamMb: 131_072, cpuCount: 18 }),
			getDockerVmMemoryMb: async () => 8_192,
		});
		const sandbox = plan.steps.find((s) => s.stepId === "sandbox");
		expect(sandbox?.detail).toMatch(/Docker.*VM is only|Raise it to/i);
	});

	it("fails soft to the unknown-VM warning when the docker-info probe rejects", async () => {
		const plan = await handleGetGlobalSetupPlan({
			...baseSources,
			getDockerVmMemoryMb: async () => {
				throw new Error("docker not running");
			},
		});
		const sandbox = plan.steps.find((s) => s.stepId === "sandbox");
		expect(sandbox?.detail).toMatch(/Could not detect the Docker VM/i);
	});
});

describe("handleGetProjectSetupPlan (§5.BA)", () => {
	it("detects the acceptance command from a package.json test script", async () => {
		const readPackageJson = vi.fn(async () => ({ scripts: { test: "vitest run" } }));
		const plan = await handleGetProjectSetupPlan({
			readPackageJson,
			getLoadedModelIds: async () => ["a"],
			getHardware: () => ({ cpuCount: 8 }),
			detectBaseBranch: async () => "main",
			getCompletedAt: () => null,
		});
		expect(plan.kind).toBe("project");
		const acceptance = plan.steps.find((s) => s.stepId === "acceptance");
		expect(acceptance?.recommendation).toContain("npm test");
		expect(readPackageJson).toHaveBeenCalledOnce();
	});

	it("survives a missing package.json / undetectable base branch (fail-soft to null)", async () => {
		const plan = await handleGetProjectSetupPlan({
			readPackageJson: async () => {
				throw new Error("ENOENT");
			},
			getLoadedModelIds: async () => {
				throw new Error("ECONNREFUSED");
			},
			getHardware: () => ({ cpuCount: 8 }),
			detectBaseBranch: async () => {
				throw new Error("not a git repo");
			},
			getCompletedAt: () => null,
		});
		expect(plan.kind).toBe("project");
		const acceptance = plan.steps.find((s) => s.stepId === "acceptance");
		expect(acceptance?.recommendation).toContain("No test/build script detected");
	});
});
