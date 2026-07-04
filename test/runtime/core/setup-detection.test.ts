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
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../../../src/nklein-agent/nklein-agent-sandbox-docker";

const GB = 1024;

describe("recommendSandboxPoolSizing", () => {
	it("uses the DEFAULT_AGENT_SANDBOX_* constants as the floor on tiny hardware", () => {
		const result = recommendSandboxPoolSizing({ totalRamMb: 8 * GB, cpuCount: 4 });
		expect(result.maxContainers).toBe(DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS);
		expect(result.agentsPerContainer).toBe(DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER);
		expect(result.memoryPerContainerMb).toBe(DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB);
		expect(result.cpusPerContainer).toBe(DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER);
		expect(result.rationale).toContain("GB RAM");
	});

	it("never drops below the floor even with zero/garbage hardware facts", () => {
		expect(recommendSandboxPoolSizing({ totalRamMb: 0, cpuCount: 0 }).maxContainers).toBe(
			DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
		);
		expect(recommendSandboxPoolSizing({ totalRamMb: Number.NaN, cpuCount: -4 }).maxContainers).toBe(
			DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
		);
	});

	it("scales the container count up with RAM + CPU on a bigger machine", () => {
		// 64 GB / 16 CPU: after reserving 8 GB + 1 CPU → ~28 GB, 15 CPU; RAM-bound at floor(28/2)=14 but CPU caps it.
		const big = recommendSandboxPoolSizing({ totalRamMb: 64 * GB, cpuCount: 16 });
		expect(big.maxContainers).toBeGreaterThan(DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS);
		// Per-container memory/CPU stay at the tuned defaults — we grow the pool, not each container.
		expect(big.memoryPerContainerMb).toBe(DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB);
		expect(big.cpusPerContainer).toBe(DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER);
	});

	it("caps the recommended container count regardless of hardware", () => {
		const huge = recommendSandboxPoolSizing({ totalRamMb: 1024 * GB, cpuCount: 128 });
		expect(huge.maxContainers).toBeLessThanOrEqual(8);
	});

	it("is RAM-bound when RAM is scarce relative to CPUs", () => {
		// 16 GB / 32 CPU: after reserve → 8 GB → floor(8/4)=2 containers (RAM caps below the CPU allowance).
		// (Per-container budget is now 4 GiB — the bumped DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB.)
		const ramBound = recommendSandboxPoolSizing({ totalRamMb: 16 * GB, cpuCount: 32 });
		expect(ramBound.maxContainers).toBe(2);
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
		expect(GLOBAL_SETUP_STEP_IDS).toEqual(["provider", "sandbox", "concurrency", "review", "guardrails", "features"]);
		for (const step of plan) {
			expect(step.title.length).toBeGreaterThan(0);
			expect(step.recommendation.length).toBeGreaterThan(0);
			expect(step.detail.length).toBeGreaterThan(0);
		}
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
