import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_CONCURRENT_TASKS } from "../../../src/config/runtime-config-defaults";
import {
	buildGlobalSetupPlan,
	buildProjectSetupPlan,
	detectProjectAcceptanceCommand,
	GLOBAL_SETUP_STEP_IDS,
	type GlobalSetupFacts,
	PROJECT_SETUP_STEP_IDS,
	type ProjectSetupFacts,
	recommendConcurrency,
	recommendSandboxPoolSizing,
	summarizeReviewPostureChoice,
} from "../../../src/core/setup-detection";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../../../src/nklein-agent/nklein-agent-sandbox-docker";

const GB = 1024;

describe("recommendSandboxPoolSizing (one shared container + exec spike guard)", () => {
	it("always recommends the one-shared-container model (maxContainers 1, unlimited co-occupancy)", () => {
		const r = recommendSandboxPoolSizing({ totalRamMb: 32 * GB, cpuCount: 8, dockerVmMemoryMb: 16 * GB });
		expect(r.maxContainers).toBe(1);
		expect(r.agentsPerContainer).toBe(DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER); // 0
		expect(r.maxConcurrentExec).toBeGreaterThanOrEqual(1);
		expect(r.rationale).toContain("shared container");
	});

	it("sizes the container + exec cap against the DOCKER VM, not host RAM", () => {
		// Huge host RAM but a SMALL Docker VM → the container is capped by the VM (minus Docker overhead), not the host.
		const r = recommendSandboxPoolSizing({ totalRamMb: 128 * GB, cpuCount: 18, dockerVmMemoryMb: 8 * GB });
		expect(r.dockerVmMemoryMb).toBe(8 * GB);
		expect(r.memoryPerContainerMb).toBeLessThan(8 * GB); // strictly inside the VM
		expect(r.memoryPerContainerMb).toBeGreaterThanOrEqual(DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB);
	});

	it("scales the container memory + exec cap up on a bigger Docker VM (not more containers)", () => {
		const small = recommendSandboxPoolSizing({ totalRamMb: 128 * GB, cpuCount: 18, dockerVmMemoryMb: 8 * GB });
		const big = recommendSandboxPoolSizing({ totalRamMb: 128 * GB, cpuCount: 18, dockerVmMemoryMb: 24 * GB });
		expect(big.memoryPerContainerMb).toBeGreaterThan(small.memoryPerContainerMb);
		expect(big.maxConcurrentExec).toBeGreaterThanOrEqual(small.maxConcurrentExec);
		expect(big.maxContainers).toBe(1);
	});

	it("clamps a tiny-but-valid Docker VM (≤ Docker overhead) to the floor — monotonic, never bigger than a larger VM", () => {
		// Regression: when the VM (2 GiB) is at/below Docker's overhead, the container ceiling is ≤ 0; a bug let the
		// UNCLAMPED target through, so the SMALLEST VM got the LARGEST recommendation. It must clamp to the shipped floor.
		const tiny = recommendSandboxPoolSizing({ totalRamMb: 32 * GB, cpuCount: 8, dockerVmMemoryMb: 2 * GB });
		expect(tiny.memoryPerContainerMb).toBe(DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB);
		expect(tiny.warnings.length).toBeGreaterThan(0); // and it warns the VM is too small
		// Monotonic: a slightly-bigger VM never yields a SMALLER container memory than the tiny one.
		const bigger = recommendSandboxPoolSizing({ totalRamMb: 32 * GB, cpuCount: 8, dockerVmMemoryMb: 6 * GB });
		expect(bigger.memoryPerContainerMb).toBeGreaterThanOrEqual(tiny.memoryPerContainerMb);
	});

	it("caps the concurrent-exec recommendation regardless of hardware", () => {
		const huge = recommendSandboxPoolSizing({ totalRamMb: 1024 * GB, cpuCount: 128, dockerVmMemoryMb: 256 * GB });
		expect(huge.maxConcurrentExec).toBeLessThanOrEqual(6);
	});

	it("WARNS when the Docker VM is too small for the target concurrency", () => {
		const r = recommendSandboxPoolSizing({ totalRamMb: 128 * GB, cpuCount: 18, dockerVmMemoryMb: 8 * GB });
		expect(r.warnings.length).toBeGreaterThan(0);
		expect(r.warnings.join(" ")).toMatch(/Docker.*VM is only|Raise it to/i);
	});

	it("warns to verify the Docker VM when its size is unknown (no docker info)", () => {
		const r = recommendSandboxPoolSizing({ totalRamMb: 32 * GB, cpuCount: 8 });
		expect(r.dockerVmMemoryMb).toBeNull();
		expect(r.warnings.join(" ")).toMatch(/Could not detect the Docker VM/i);
	});

	it("never drops below a usable floor on garbage inputs (never throws)", () => {
		const r = recommendSandboxPoolSizing({ totalRamMb: Number.NaN, cpuCount: -4, dockerVmMemoryMb: 0 });
		expect(r.maxContainers).toBe(1);
		expect(r.memoryPerContainerMb).toBeGreaterThanOrEqual(DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB);
		expect(r.maxConcurrentExec).toBeGreaterThanOrEqual(1);
	});
});

describe("recommendConcurrency", () => {
	it("returns the default floor for a single loaded model on a modest machine", () => {
		const result = recommendConcurrency({ loadedModelCount: 1, cpuCount: 4 });
		expect(result.maxConcurrentTasks).toBe(DEFAULT_MAX_CONCURRENT_TASKS);
		expect(result.rationale).toContain("1 loaded model");
	});

	it("holds the floor when no models are loaded", () => {
		const result = recommendConcurrency({ loadedModelCount: 0, cpuCount: 8 });
		expect(result.maxConcurrentTasks).toBe(DEFAULT_MAX_CONCURRENT_TASKS);
		expect(result.rationale).toContain("no loaded models");
	});

	it("scales up with more loaded models on a capable machine but caps the value", () => {
		const scaled = recommendConcurrency({ loadedModelCount: 5, cpuCount: 16 });
		expect(scaled.maxConcurrentTasks).toBeGreaterThan(DEFAULT_MAX_CONCURRENT_TASKS);
		expect(recommendConcurrency({ loadedModelCount: 100, cpuCount: 128 }).maxConcurrentTasks).toBeLessThanOrEqual(8);
	});

	it("never schedules more tasks than there are loaded endpoints", () => {
		// 2 loaded models, plenty of CPU → capped at the model count (still ≥ floor).
		const result = recommendConcurrency({ loadedModelCount: 2, cpuCount: 32 });
		expect(result.maxConcurrentTasks).toBe(DEFAULT_MAX_CONCURRENT_TASKS);
	});
});

describe("detectProjectAcceptanceCommand", () => {
	it("returns none for an empty / null package.json", () => {
		expect(detectProjectAcceptanceCommand({ packageJson: null })).toEqual({ command: null, source: "none" });
		expect(detectProjectAcceptanceCommand({ packageJson: {} })).toEqual({ command: null, source: "none" });
		expect(detectProjectAcceptanceCommand({ packageJson: { scripts: {} } })).toEqual({
			command: null,
			source: "none",
		});
	});

	it("prefers a test script and returns the canonical `npm test` form", () => {
		expect(
			detectProjectAcceptanceCommand({ packageJson: { scripts: { test: "vitest run", build: "tsc" } } }),
		).toEqual({ command: "npm test", source: "test-script" });
	});

	it("falls back to build when there is no test script", () => {
		expect(detectProjectAcceptanceCommand({ packageJson: { scripts: { build: "tsc -p ." } } })).toEqual({
			command: "npm run build",
			source: "build-script",
		});
	});

	it("treats an empty/whitespace script body as absent (placeholder is not a real command)", () => {
		expect(detectProjectAcceptanceCommand({ packageJson: { scripts: { test: "   ", build: "tsc" } } })).toEqual({
			command: "npm run build",
			source: "build-script",
		});
	});
});

describe("summarizeReviewPostureChoice", () => {
	it("explains the ON posture as reviewer-approval", () => {
		const text = summarizeReviewPostureChoice(true);
		expect(text.toLowerCase()).toContain("review");
		expect(text.toLowerCase()).toContain("approve");
	});

	it("explains the OFF posture as manual-merge under the fail-closed gate", () => {
		const text = summarizeReviewPostureChoice(false);
		expect(text.toLowerCase()).toContain("manual-merge");
		expect(text.toLowerCase()).toContain("fail-closed");
	});
});

const globalFacts = (overrides: Partial<GlobalSetupFacts> = {}): GlobalSetupFacts => ({
	totalRamMb: 32 * GB,
	cpuCount: 8,
	loadedModelCount: 2,
	providerReachable: true,
	providerEndpoint: "http://localhost:1234",
	dockerAvailable: true,
	secondOpinionReviewEnabled: true,
	assignedModelRoleCount: 3,
	totalModelRoleCount: 3,
	deviceRamGb: 32,
	basicMemoryEnabled: true,
	sandboxMcpServersEnabled: false,
	memoryFreshnessAuditEnabled: true,
	egressProxyEnabled: false,
	egressAllowlistCount: 0,
	retrievalEgressEnabled: false,
	...overrides,
});

const projectFacts = (overrides: Partial<ProjectSetupFacts> = {}): ProjectSetupFacts => ({
	packageJson: { scripts: { test: "vitest run" } },
	loadedModelCount: 2,
	cpuCount: 8,
	detectedBaseBranch: "main",
	...overrides,
});

describe("buildGlobalSetupPlan", () => {
	it("produces the steps in the stable global order with stable ids", () => {
		const plan = buildGlobalSetupPlan(globalFacts());
		expect(plan.map((s) => s.stepId)).toEqual([...GLOBAL_SETUP_STEP_IDS]);
		expect(GLOBAL_SETUP_STEP_IDS).toEqual([
			"provider",
			"models",
			"sandbox",
			"resources",
			"concurrency",
			"review",
			"guardrails",
			"memory",
			"egress",
			"features",
		]);
		for (const step of plan) {
			expect(step.title.length).toBeGreaterThan(0);
			expect(step.recommendation.length).toBeGreaterThan(0);
			expect(step.detail.length).toBeGreaterThan(0);
		}
	});

	it("F5.3 capability-group steps reflect their facts", () => {
		// Fully-local privacy default + all roles assigned + fleet routing on.
		const local = buildGlobalSetupPlan(globalFacts());
		expect(local.find((s) => s.stepId === "models")?.recommendation).toContain("All 3 roles assigned");
		expect(local.find((s) => s.stepId === "resources")?.recommendation).toContain("32 GB");
		expect(local.find((s) => s.stepId === "egress")?.recommendation.toLowerCase()).toContain("fully local");
		expect(local.find((s) => s.stepId === "memory")?.recommendation).toContain("Basic Memory");

		// Opted into egress + partial roles + no fleet budget.
		const opened = buildGlobalSetupPlan(
			globalFacts({
				assignedModelRoleCount: 1,
				deviceRamGb: null,
				retrievalEgressEnabled: true,
				egressProxyEnabled: true,
				egressAllowlistCount: 2,
			}),
		);
		expect(opened.find((s) => s.stepId === "models")?.recommendation).toContain("1/3 roles assigned");
		expect(opened.find((s) => s.stepId === "resources")?.recommendation.toLowerCase()).toContain("no device ram");
		const egress = opened.find((s) => s.stepId === "egress")?.recommendation ?? "";
		expect(egress).toContain("2 allowlisted hosts");
		expect(egress.toLowerCase()).toContain("online retrieval");
	});

	it("reflects an unreachable provider and a fail-closed Docker state in the step text", () => {
		const plan = buildGlobalSetupPlan(globalFacts({ providerReachable: false, dockerAvailable: false }));
		const provider = plan.find((s) => s.stepId === "provider");
		const sandbox = plan.find((s) => s.stepId === "sandbox");
		expect(provider?.recommendation).toContain("No local provider");
		expect(sandbox?.detail.toLowerCase()).toContain("fails closed");
	});

	it("reflects the review posture choice in the review step", () => {
		const off = buildGlobalSetupPlan(globalFacts({ secondOpinionReviewEnabled: false }));
		const review = off.find((s) => s.stepId === "review");
		expect(review?.detail.toLowerCase()).toContain("manual-merge");
	});
});

describe("buildProjectSetupPlan", () => {
	it("produces the steps in the stable project order with stable ids", () => {
		const plan = buildProjectSetupPlan(projectFacts());
		expect(plan.map((s) => s.stepId)).toEqual([...PROJECT_SETUP_STEP_IDS]);
		expect(PROJECT_SETUP_STEP_IDS).toEqual([
			"overrides",
			"concurrency",
			"overlap",
			"egress",
			"acceptance",
			"baseBranch",
		]);
		for (const step of plan) {
			expect(step.title.length).toBeGreaterThan(0);
			expect(step.recommendation.length).toBeGreaterThan(0);
			expect(step.detail.length).toBeGreaterThan(0);
		}
	});

	it("surfaces the detected acceptance command and base branch", () => {
		const plan = buildProjectSetupPlan(projectFacts());
		const acceptance = plan.find((s) => s.stepId === "acceptance");
		const baseBranch = plan.find((s) => s.stepId === "baseBranch");
		expect(acceptance?.recommendation).toContain("npm test");
		expect(baseBranch?.recommendation).toContain("main");
	});

	it("handles a repo with no scripts and no detected base branch", () => {
		const plan = buildProjectSetupPlan(projectFacts({ packageJson: null, detectedBaseBranch: null }));
		const acceptance = plan.find((s) => s.stepId === "acceptance");
		const baseBranch = plan.find((s) => s.stepId === "baseBranch");
		expect(acceptance?.recommendation.toLowerCase()).toContain("no test/build script");
		expect(baseBranch?.recommendation.toLowerCase()).toContain("not detected");
	});
});
