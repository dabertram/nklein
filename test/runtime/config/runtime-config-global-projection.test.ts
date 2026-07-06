import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGlobalRuntimeConfig, toGlobalRuntimeConfigState } from "../../../src/config/runtime-config";
import { createTempDir } from "../../utilities/temp-dir";

// §5.V — toGlobalRuntimeConfigState is the "reduce to a global-only view" projection: it must CLEAR every project-scoped
// field (so project config can't leak into the global view) while preserving the global defaults. Verified against a real
// default state loaded under an isolated temp HOME (mirrors the existing runtime-config test harness).

describe("toGlobalRuntimeConfigState (§5.V coverage)", () => {
	let temp: ReturnType<typeof createTempDir>;
	let savedHome: string | undefined;
	let savedUserProfile: string | undefined;

	beforeEach(() => {
		temp = createTempDir();
		savedHome = process.env.HOME;
		savedUserProfile = process.env.USERPROFILE;
		process.env.HOME = temp.path;
		process.env.USERPROFILE = temp.path;
	});

	afterEach(() => {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		if (savedUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = savedUserProfile;
		temp.cleanup();
	});

	it("clears project-scoped fields and preserves the global ones", async () => {
		const state = await loadGlobalRuntimeConfig();
		const global = toGlobalRuntimeConfigState(state);

		// Project-scoped fields are cleared.
		expect(global.projectConfigPath).toBeNull();
		expect(global.projectSetupWizardCompletedAt).toBeNull();
		expect(global.fileOverlapParallelismOverride).toBeNull();
		expect(global.modelRolesOverride).toBeNull();
		expect(global.agentRulesetsOverride).toBeNull();
		expect(global.skillDynamicsLevelOverride).toBeNull();
		expect(global.concurrencyOverride).toBeNull();
		expect(global.shortcuts).toEqual([]);

		// Global fields are preserved from the source state.
		expect(global.globalConfigPath).toBe(state.globalConfigPath);
		expect(global.selectedAgentId).toBe(state.selectedAgentId);
		expect(global.developerModeEnabled).toBe(state.developerModeEnabled);
		expect(global.modelRoles).toEqual(state.modelRoles); // value-preserved (the factory re-materializes objects)
		expect(global.retrievalEgressEnabled).toBe(state.retrievalEgressEnabled);
	});
});
