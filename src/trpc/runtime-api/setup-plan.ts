/**
 * §5.BA guided-setup wizard tRPC handlers.
 *
 * Thin assembly over the PURE detection cores (setup-detection.ts): gather live facts (hardware, loaded models,
 * provider reachability, Docker, review posture, package.json), hand them to `buildGlobalSetupPlan` /
 * `buildProjectSetupPlan`, and return the resolved step list plus the completion stamp so the UI can render the
 * wizard and decide whether to auto-fire on first run. All fact sources are injected so the assembly is unit-
 * testable without a live provider / Docker / filesystem.
 */

import type { RuntimeSetupPlanResponse } from "../../core/config-api-contract.js";
import {
	buildGlobalSetupPlan,
	buildProjectSetupPlan,
	type GlobalSetupFacts,
	type ProjectSetupFacts,
} from "../../core/setup-detection.js";

/** Injected sources for the GLOBAL wizard's facts + completion stamp. */
export interface GlobalSetupPlanFactSources {
	getHardware: () => { totalRamMb: number; cpuCount: number };
	/** Loaded model ids from the local provider probe; a rejection ⇒ provider not reachable. */
	getLoadedModelIds: () => Promise<readonly string[]>;
	providerEndpoint: string;
	/** Docker daemon availability (null = not probed / unknown). */
	getDockerAvailable: () => boolean | null;
	/** Docker VM memory in MB (`docker info` Total Memory), or null when it can't be probed. Sizes the sandbox. */
	getDockerVmMemoryMb: () => Promise<number | null>;
	getSecondOpinionReviewEnabled: () => boolean;
	getCompletedAt: () => number | null;
}

/** Injected sources for the PROJECT wizard's facts + completion stamp. */
export interface ProjectSetupPlanFactSources {
	readPackageJson: () => Promise<{ scripts?: Record<string, string> } | null>;
	getLoadedModelIds: () => Promise<readonly string[]>;
	getHardware: () => { cpuCount: number };
	detectBaseBranch: () => Promise<string | null>;
	getCompletedAt: () => number | null;
}

export async function handleGetGlobalSetupPlan(sources: GlobalSetupPlanFactSources): Promise<RuntimeSetupPlanResponse> {
	const hardware = sources.getHardware();
	let loadedModelIds: readonly string[] = [];
	let providerReachable = false;
	try {
		loadedModelIds = await sources.getLoadedModelIds();
		providerReachable = true;
	} catch {
		providerReachable = false;
	}
	const dockerVmMemoryMb = await sources.getDockerVmMemoryMb().catch(() => null);
	const facts: GlobalSetupFacts = {
		totalRamMb: hardware.totalRamMb,
		cpuCount: hardware.cpuCount,
		loadedModelCount: loadedModelIds.length,
		providerReachable,
		providerEndpoint: sources.providerEndpoint,
		dockerAvailable: sources.getDockerAvailable(),
		dockerVmMemoryMb,
		secondOpinionReviewEnabled: sources.getSecondOpinionReviewEnabled(),
	};
	return { kind: "global", steps: buildGlobalSetupPlan(facts), completedAt: sources.getCompletedAt() };
}

export async function handleGetProjectSetupPlan(
	sources: ProjectSetupPlanFactSources,
): Promise<RuntimeSetupPlanResponse> {
	const [packageJson, loadedModelIds, detectedBaseBranch] = await Promise.all([
		sources.readPackageJson().catch(() => null),
		sources.getLoadedModelIds().catch(() => [] as readonly string[]),
		sources.detectBaseBranch().catch(() => null),
	]);
	const facts: ProjectSetupFacts = {
		packageJson,
		loadedModelCount: loadedModelIds.length,
		cpuCount: sources.getHardware().cpuCount,
		detectedBaseBranch,
	};
	return { kind: "project", steps: buildProjectSetupPlan(facts), completedAt: sources.getCompletedAt() };
}
