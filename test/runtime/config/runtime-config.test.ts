import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	loadGlobalRuntimeConfig,
	loadRuntimeConfig,
	pickBestInstalledAgentIdFromDetected,
	RUNTIME_CONFIG_DERIVED_FIELD_KEYS,
	RUNTIME_PROJECT_CONFIG_CHANGE_FIELD_KEYS,
	type RuntimeConfigUpdateInput,
	saveRuntimeConfig,
	updateRuntimeConfig,
} from "../../../src/config/runtime-config";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "../../../src/core/api-contract";
import { createTempDir } from "../../utilities/temp-dir";

function withTemporaryEnv<T>(
	input: {
		home: string;
		pathPrefix?: string;
		replacePath?: boolean;
	},
	run: () => Promise<T>,
): Promise<T> {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousPath = process.env.PATH;
	process.env.HOME = input.home;
	process.env.USERPROFILE = input.home;
	if (input.pathPrefix) {
		process.env.PATH = input.replacePath
			? input.pathPrefix
			: previousPath
				? `${input.pathPrefix}${delimiter}${previousPath}`
				: input.pathPrefix;
	}
	return run().finally(() => {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		if (input.pathPrefix) {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	});
}

async function withTemporaryDebugEnv<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
	const previousNkleinDebug = process.env.NKLEIN_DEBUG;
	const previousKanbanDebug = process.env.KANBAN_DEBUG;
	const previousKanbanDebugMode = process.env.KANBAN_DEBUG_MODE;
	const previousDebugMode = process.env.DEBUG_MODE;
	const previousLowerDebugMode = process.env.debug_mode;
	if (value === undefined) {
		delete process.env.NKLEIN_DEBUG;
	} else {
		process.env.NKLEIN_DEBUG = value;
	}
	delete process.env.KANBAN_DEBUG;
	delete process.env.KANBAN_DEBUG_MODE;
	delete process.env.DEBUG_MODE;
	delete process.env.debug_mode;
	return run().finally(() => {
		if (previousNkleinDebug === undefined) {
			delete process.env.NKLEIN_DEBUG;
		} else {
			process.env.NKLEIN_DEBUG = previousNkleinDebug;
		}
		if (previousKanbanDebug === undefined) {
			delete process.env.KANBAN_DEBUG;
		} else {
			process.env.KANBAN_DEBUG = previousKanbanDebug;
		}
		if (previousKanbanDebugMode === undefined) {
			delete process.env.KANBAN_DEBUG_MODE;
		} else {
			process.env.KANBAN_DEBUG_MODE = previousKanbanDebugMode;
		}
		if (previousDebugMode === undefined) {
			delete process.env.DEBUG_MODE;
		} else {
			process.env.DEBUG_MODE = previousDebugMode;
		}
		if (previousLowerDebugMode === undefined) {
			delete process.env.debug_mode;
		} else {
			process.env.debug_mode = previousLowerDebugMode;
		}
	});
}

function writeFakeCommand(binDir: string, command: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		const scriptPath = join(binDir, `${command}.cmd`);
		writeFileSync(scriptPath, "@echo off\r\nexit /b 0\r\n", "utf8");
		return;
	}
	const scriptPath = join(binDir, command);
	writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(scriptPath, 0o755);
}

describe.sequential("runtime-config auto agent selection", () => {
	it("does not auto-select external CLI agents in local-only mode", () => {
		expect(pickBestInstalledAgentIdFromDetected(["codex", "opencode", "gemini"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["opencode", "droid", "gemini"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["kiro-cli", "gemini"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["droid", "gemini", "nklein"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["gemini", "nklein"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["claude", "codex", "nklein"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["claude", "droid"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["nklein"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected([])).toBeNull();
	});

	it("registers every comparable config field for change detection (drift guard, §5.U)", async () => {
		const { path: tempHome, cleanup } = createTempDir("kanban-home-runtime-config-change-fields-");
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadRuntimeConfig(tempHome);
				const derived = new Set<string>(RUNTIME_CONFIG_DERIVED_FIELD_KEYS);
				const comparableKeys = Object.keys(state).filter((key) => !derived.has(key));
				// Every non-derived RuntimeConfigState field must be registered so a save's change detection can't
				// silently miss it — and the registry must not reference a stale field. Adding a config field now
				// fails here until it is registered (or marked derived), making the registry the single source of truth.
				expect(new Set(RUNTIME_PROJECT_CONFIG_CHANGE_FIELD_KEYS)).toEqual(new Set(comparableKeys));
			});
		} finally {
			cleanup();
		}
	});

	it("round-trips each simple scalar config field through update + reload (§5.U save coverage)", async () => {
		const cases: Array<{ key: keyof RuntimeConfigUpdateInput; value: unknown }> = [
			{ key: "selectedShortcutLabel", value: "label-x" },
			{ key: "developerModeEnabled", value: true },
			{ key: "replayCardsEnabled", value: true },
			{ key: "setupWizardCompletedAt", value: 1_700_000_000_000 },
			{ key: "agentAutonomousModeEnabled", value: false },
			{ key: "agentTimeoutMode", value: "long" },
			{ key: "agentTimeoutProfile", value: "custom" },
			{ key: "requestTimeoutMs", value: 11111 },
			{ key: "streamTimeoutMs", value: 22222 },
			{ key: "toolTimeoutMs", value: 33333 },
			{ key: "agentTimeoutMs", value: 44444 },
			{ key: "conversationTimeoutMs", value: 55555 },
			{ key: "maxAgentWritableFileLines", value: 1500 },
			{ key: "maxConcurrentTasks", value: 6 },
			{ key: "sandboxMaxContainers", value: 4 },
			{ key: "sandboxAgentsPerContainer", value: 2 },
			{ key: "sandboxMemoryPerContainerMb", value: 3072 },
			{ key: "sandboxCpusPerContainer", value: 1.5 },
			{ key: "sandboxIdleTimeoutMinutes", value: 20 },
			{ key: "retrievalEgressEnabled", value: true },
			{ key: "retrievalSearchBackendUrl", value: "http://localhost:8888" },
			{ key: "fileOverlapParallelism", value: "allow" },
			{ key: "lostHeartbeatPolicy", value: "keep_running" },
			{ key: "decompositionAutoApplyEnabled", value: false },
			{ key: "secondOpinionReviewEnabled", value: false },
			{ key: "reviewMaxRounds", value: 8 },
			{ key: "readyForReviewNotificationsEnabled", value: false },
			{ key: "commitPromptTemplate", value: "Custom commit template" },
			{ key: "openPrPromptTemplate", value: "Custom PR template" },
		];
		for (const testCase of cases) {
			const { path: tempHome, cleanup } = createTempDir("kanban-home-runtime-config-field-roundtrip-");
			try {
				await withTemporaryEnv({ home: tempHome }, async () => {
					const updated = await updateRuntimeConfig(tempHome, { [testCase.key]: testCase.value });
					expect({ key: testCase.key, value: updated[testCase.key as keyof typeof updated] }).toEqual({
						key: testCase.key,
						value: testCase.value,
					});
					const reloaded = await loadRuntimeConfig(tempHome);
					expect({ key: testCase.key, value: reloaded[testCase.key as keyof typeof reloaded] }).toEqual({
						key: testCase.key,
						value: testCase.value,
					});
				});
			} finally {
				cleanup();
			}
		}
	});

	it("keeps fresh config on local NKlein even when external CLIs are installed", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-");

		try {
			writeFakeCommand(tempBin, "opencode");
			writeFakeCommand(tempBin, "codex");
			writeFakeCommand(tempBin, "gemini");

			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				const isolatedPath = `${tempBin}${delimiter}/usr/bin${delimiter}/bin`;
				await withTemporaryEnv({ home: tempHome, pathPrefix: isolatedPath, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("nklein");
					expect(existsSync(join(tempHome, ".nklein", "nklein", "config.json"))).toBe(false);

					const reloadedState = await loadRuntimeConfig(tempProject);
					expect(reloadedState.selectedAgentId).toBe("nklein");
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not write config when no supported CLI is detected", async () => {
		if (process.platform === "win32") {
			return;
		}
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-default-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-default-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-default-");

		try {
			const previousShell = process.env.SHELL;
			try {
				process.env.SHELL = "/definitely-not-a-shell";
				await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.selectedAgentId).toBe("nklein");
					expect(existsSync(join(tempHome, ".nklein", "nklein", "config.json"))).toBe(false);
				});
			} finally {
				if (previousShell === undefined) {
					delete process.env.SHELL;
				} else {
					process.env.SHELL = previousShell;
				}
			}
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("treats the home directory as global-only config scope", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-home-scope-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadRuntimeConfig(tempHome);
				expect(state.globalConfigPath).toBe(join(tempHome, ".nklein", "nklein", "config.json"));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);

				const updated = await updateRuntimeConfig(tempHome, {
					agentAutonomousModeEnabled: false,
				});
				expect(updated.agentAutonomousModeEnabled).toBe(false);
				expect(updated.projectConfigPath).toBeNull();

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					agentAutonomousModeEnabled?: boolean;
					shortcuts?: unknown;
				};
				expect(globalPayload.agentAutonomousModeEnabled).toBe(false);
				expect(globalPayload.shortcuts).toBeUndefined();
			});
		} finally {
			cleanupHome();
		}
	});

	it("loads global runtime config without a project scope", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-global-only-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadGlobalRuntimeConfig();
				expect(state.globalConfigPath).toBe(join(tempHome, ".nklein", "nklein", "config.json"));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);
			});
		} finally {
			cleanupHome();
		}
	});

	it("defaults second-opinion review on (max 20 rounds) and round-trips overrides (§5.K)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-review-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-review-");
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const defaults = await loadRuntimeConfig(tempProject);
				expect(defaults.secondOpinionReviewEnabled).toBe(true);
				expect(defaults.reviewMaxRounds).toBe(20);

				await updateRuntimeConfig(tempProject, { secondOpinionReviewEnabled: false, reviewMaxRounds: 5 });
				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.secondOpinionReviewEnabled).toBe(false);
				expect(reloaded.reviewMaxRounds).toBe(5);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults empty concurrency config and round-trips the global default + per-project override (§5.W)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-concurrency-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-concurrency-",
		);
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const defaults = await loadRuntimeConfig(tempProject);
				expect(defaults.concurrencyDefaults).toEqual({ perProvider: {}, perModel: {} });
				expect(defaults.concurrencyOverride).toBeNull();

				// Global default persists across reload.
				await updateRuntimeConfig(tempProject, {
					concurrencyDefaults: { perProvider: { lmstudio: 2 }, perModel: { "lmstudio:qwen3-8b:default": 1 } },
				});
				const withGlobal = await loadRuntimeConfig(tempProject);
				expect(withGlobal.concurrencyDefaults.perProvider.lmstudio).toBe(2);
				expect(withGlobal.concurrencyDefaults.perModel["lmstudio:qwen3-8b:default"]).toBe(1);

				// Per-project override persists too, and the global default is preserved on the override save.
				await updateRuntimeConfig(tempProject, { concurrencyOverride: { perProvider: { lmstudio: 5 } } });
				const withOverride = await loadRuntimeConfig(tempProject);
				expect(withOverride.concurrencyOverride?.perProvider?.lmstudio).toBe(5);
				expect(withOverride.concurrencyDefaults.perProvider.lmstudio).toBe(2);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults the model-suitability gate policy and round-trips the global default + per-project override (§5.AL)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-modelgate-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-modelgate-");
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const defaults = await loadRuntimeConfig(tempProject);
				expect(defaults.modelSuitabilityPolicyDefaults).toEqual({ onUnsuitable: "reject", onUnknown: "warn" });
				expect(defaults.modelSuitabilityPolicyOverride).toBeNull();
				expect(defaults.effectiveModelSuitabilityPolicy).toEqual({ onUnsuitable: "reject", onUnknown: "warn" });

				// Global default persists across reload (regression: the global save must write the field to disk).
				await updateRuntimeConfig(tempProject, {
					modelSuitabilityPolicyDefaults: { onUnsuitable: "warn", onUnknown: "allow" },
				});
				const withGlobal = await loadRuntimeConfig(tempProject);
				expect(withGlobal.modelSuitabilityPolicyDefaults).toEqual({ onUnsuitable: "warn", onUnknown: "allow" });

				// Per-project override persists too (regression: the project save must NOT drop it / delete the file as empty),
				// and the global default is preserved on the override save. Effective = override.
				await updateRuntimeConfig(tempProject, {
					modelSuitabilityPolicyOverride: { onUnsuitable: "reject", onUnknown: "reject" },
				});
				const withOverride = await loadRuntimeConfig(tempProject);
				expect(withOverride.modelSuitabilityPolicyOverride).toEqual({
					onUnsuitable: "reject",
					onUnknown: "reject",
				});
				expect(withOverride.modelSuitabilityPolicyDefaults).toEqual({ onUnsuitable: "warn", onUnknown: "allow" });
				expect(withOverride.effectiveModelSuitabilityPolicy).toEqual({
					onUnsuitable: "reject",
					onUnknown: "reject",
				});
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults the skill-dynamics level and round-trips the global default + per-project override (§5.AE)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-skilldyn-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-skilldyn-");
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const defaults = await loadRuntimeConfig(tempProject);
				expect(defaults.skillDynamicsLevelDefault).toBe("fully_dynamic");
				expect(defaults.skillDynamicsLevelOverride).toBeNull();
				expect(defaults.effectiveSkillDynamicsLevel).toBe("fully_dynamic");

				// Global default persists across reload (regression: the global save must write the field to disk).
				await updateRuntimeConfig(tempProject, { skillDynamicsLevelDefault: "static_skills_auto_model" });
				const withGlobal = await loadRuntimeConfig(tempProject);
				expect(withGlobal.skillDynamicsLevelDefault).toBe("static_skills_auto_model");

				// Per-project override persists, the global default is preserved, and effective = override.
				await updateRuntimeConfig(tempProject, { skillDynamicsLevelOverride: "fully_static" });
				const withOverride = await loadRuntimeConfig(tempProject);
				expect(withOverride.skillDynamicsLevelOverride).toBe("fully_static");
				expect(withOverride.skillDynamicsLevelDefault).toBe("static_skills_auto_model");
				expect(withOverride.effectiveSkillDynamicsLevel).toBe("fully_static");
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults both setup-wizard stamps to null and round-trips the global stamp + per-project stamp (§5.BA)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-setupwizard-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-setupwizard-",
		);
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				// Fresh install: never run → both wizards auto-fire.
				const defaults = await loadRuntimeConfig(tempProject);
				expect(defaults.setupWizardCompletedAt).toBeNull();
				expect(defaults.projectSetupWizardCompletedAt).toBeNull();

				// Global stamp persists across reload (regression: the global save must write it to disk).
				await updateRuntimeConfig(tempProject, { setupWizardCompletedAt: 1_700_000_000_000 });
				const withGlobal = await loadRuntimeConfig(tempProject);
				expect(withGlobal.setupWizardCompletedAt).toBe(1_700_000_000_000);
				expect(withGlobal.projectSetupWizardCompletedAt).toBeNull();

				// Per-project stamp persists independently and the global stamp is preserved.
				await updateRuntimeConfig(tempProject, { projectSetupWizardCompletedAt: 1_800_000_000_000 });
				const withProject = await loadRuntimeConfig(tempProject);
				expect(withProject.projectSetupWizardCompletedAt).toBe(1_800_000_000_000);
				expect(withProject.setupWizardCompletedAt).toBe(1_700_000_000_000);

				// A garbage/zero stamp normalizes back to null (auto-fire).
				await updateRuntimeConfig(tempProject, {
					setupWizardCompletedAt: 0 as unknown as number,
					projectSetupWizardCompletedAt: -1 as unknown as number,
				});
				const reset = await loadRuntimeConfig(tempProject);
				expect(reset.setupWizardCompletedAt).toBeNull();
				expect(reset.projectSetupWizardCompletedAt).toBeNull();
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults swarm guardrails, round-trips overrides, clamps bad values, and preserves on unrelated saves (§5.T)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-guardrails-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-guardrails-");
		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const defaults = await loadRuntimeConfig(tempProject);
				expect(defaults.swarmGuardrails).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);

				await updateRuntimeConfig(tempProject, {
					swarmGuardrails: {
						maxAutonomousTurnsPerTask: 24,
						maxAutonomousWallTimeMs: 30 * 60 * 1000,
						maxRepeatedNoDiffCheckpoints: 6,
						maxRepeatedToolCallsPerTask: 5,
					},
				});
				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.swarmGuardrails).toEqual({
					maxAutonomousTurnsPerTask: 24,
					maxAutonomousWallTimeMs: 30 * 60 * 1000,
					maxRepeatedNoDiffCheckpoints: 6,
					maxRepeatedToolCallsPerTask: 5,
				});

				// Out-of-bounds values are clamped to the sane range (turns max 1000, tool-call floor 2).
				await updateRuntimeConfig(tempProject, {
					swarmGuardrails: {
						maxAutonomousTurnsPerTask: 999_999,
						maxAutonomousWallTimeMs: 30 * 60 * 1000,
						maxRepeatedNoDiffCheckpoints: 6,
						maxRepeatedToolCallsPerTask: 1,
					},
				});
				const clamped = await loadRuntimeConfig(tempProject);
				expect(clamped.swarmGuardrails.maxAutonomousTurnsPerTask).toBe(1000);
				expect(clamped.swarmGuardrails.maxRepeatedToolCallsPerTask).toBe(2);

				// An unrelated update preserves the saved guardrails.
				await updateRuntimeConfig(tempProject, { maxConcurrentTasks: 4 });
				const after = await loadRuntimeConfig(tempProject);
				expect(after.swarmGuardrails.maxRepeatedNoDiffCheckpoints).toBe(6);
				expect(after.swarmGuardrails.maxAutonomousTurnsPerTask).toBe(1000);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("preserves a role's additionalModels pool across load/save (#4 model pools)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-pool-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-pool-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
				mkdirSync(runtimeConfigDir, { recursive: true });
				writeFileSync(
					join(runtimeConfigDir, "config.json"),
					JSON.stringify({
						modelRoles: {
							worker: {
								providerId: "lmstudio",
								modelId: "qwen3.5-9b",
								additionalModels: [
									{ providerId: "lmstudio", modelId: "qwen3.6-35b" },
									{ providerId: "lmstudio", modelId: "gemma-4-26b" },
								],
							},
						},
					}),
					"utf8",
				);
				const loaded = await loadRuntimeConfig(tempProject);
				expect(loaded.modelRoles.worker?.modelId).toBe("qwen3.5-9b");
				expect(loaded.modelRoles.worker?.additionalModels?.map((entry) => entry.modelId)).toEqual([
					"qwen3.6-35b",
					"gemma-4-26b",
				]);

				// Updating an unrelated field preserves the pool.
				await updateRuntimeConfig(tempProject, { maxConcurrentTasks: 4 });
				const after = await loadRuntimeConfig(tempProject);
				expect(after.modelRoles.worker?.additionalModels).toHaveLength(2);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("defaults agentRulesets to fully_open and preserves a persisted ruleset across config updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-rulesets-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-rulesets-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const fresh = await loadRuntimeConfig(tempProject);
				expect(fresh.agentRulesets?.capability.globalPreset).toBe("fully_open");
				expect(fresh.agentRulesets?.delivery.globalPreset).toBe("fully_open");

				const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
				mkdirSync(runtimeConfigDir, { recursive: true });
				writeFileSync(
					join(runtimeConfigDir, "config.json"),
					JSON.stringify(
						{
							agentRulesets: {
								capability: { globalPreset: "strict", roleOverrides: { worker: "medium" } },
								delivery: { globalPreset: "more_open" },
							},
						},
						null,
						2,
					),
					"utf8",
				);
				const loaded = await loadRuntimeConfig(tempProject);
				expect(loaded.agentRulesets?.capability.globalPreset).toBe("strict");
				expect(loaded.agentRulesets?.capability.roleOverrides?.worker).toBe("medium");
				expect(loaded.agentRulesets?.delivery.globalPreset).toBe("more_open");

				// Updating an unrelated field must not drop the persisted ruleset.
				await updateRuntimeConfig(tempProject, { maxConcurrentTasks: 5 });
				const after = await loadRuntimeConfig(tempProject);
				expect(after.agentRulesets?.capability.globalPreset).toBe("strict");
				expect(after.maxConcurrentTasks).toBe(5);

				// The write path: updating agentRulesets persists and reloads.
				await updateRuntimeConfig(tempProject, {
					agentRulesets: { capability: { globalPreset: "more_open" }, delivery: { globalPreset: "medium" } },
				});
				const tuned = await loadRuntimeConfig(tempProject);
				expect(tuned.agentRulesets?.capability.globalPreset).toBe("more_open");
				expect(tuned.agentRulesets?.delivery.globalPreset).toBe("medium");
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("uses the debug env override only when developer mode is unset", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-debug-env-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-debug-env-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await withTemporaryDebugEnv("true", async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.developerModeEnabled).toBe(true);

					const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
					mkdirSync(runtimeConfigDir, { recursive: true });
					writeFileSync(
						join(runtimeConfigDir, "config.json"),
						JSON.stringify({ developerModeEnabled: false }, null, 2),
						"utf8",
					);

					const persistedFalseState = await loadRuntimeConfig(tempProject);
					expect(persistedFalseState.developerModeEnabled).toBe(false);
				});
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("loads the legacy debugModeEnabled setting as developer mode", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-legacy-debug-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-legacy-debug-",
		);

		try {
			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify({ debugModeEnabled: true }, null, 2),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.developerModeEnabled).toBe(true);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("uses the debug env override only when developer mode is not stored", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-debug-env-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-debug-env-");

		try {
			await withTemporaryDebugEnv("true", async () => {
				await withTemporaryEnv({ home: tempHome }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.developerModeEnabled).toBe(true);
				});
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("lets stored developer mode false override the debug env", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-debug-stored-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-debug-stored-",
		);

		try {
			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify({ developerModeEnabled: false }, null, 2),
				"utf8",
			);

			await withTemporaryDebugEnv("true", async () => {
				await withTemporaryEnv({ home: tempHome }, async () => {
					const state = await loadRuntimeConfig(tempProject);
					expect(state.developerModeEnabled).toBe(false);
				});
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("normalizes cloud configured agents to the default local launch agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-set-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-set-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-set-");

		try {
			writeFakeCommand(tempBin, "claude");
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						selectedAgentId: "claude",
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("nklein");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("does not auto-select when global config file already exists without selected agent", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-existing-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-existing-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-bin-runtime-config-existing-");

		try {
			writeFakeCommand(tempBin, "codex");

			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						readyForReviewNotificationsEnabled: true,
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome, pathPrefix: tempBin }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("nklein");
			});
		} finally {
			cleanupBin();
			cleanupProject();
			cleanupHome();
		}
	});

	it("loads and normalizes model role settings from global config", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-roles-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-roles-");

		try {
			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(
				join(runtimeConfigDir, "config.json"),
				JSON.stringify(
					{
						modelRoles: {
							" worker ": {
								providerId: " ollama ",
								modelId: " qwen3.5-9b ",
								reasoningEffort: "medium",
								contextScope: "minimal",
							},
							broken: {
								reasoningEffort: "ultra",
							},
						},
					},
					null,
					2,
				),
				"utf8",
			);

			await withTemporaryEnv({ home: tempHome }, async () => {
				const state = await loadRuntimeConfig(tempProject);
				expect(state.modelRoles).toEqual({
					worker: {
						providerId: "ollama",
						modelId: "qwen3.5-9b",
						reasoningEffort: "medium",
						contextScope: "minimal",
					},
				});
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("updates and persists model role settings", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-update-roles-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-update-roles-",
		);

		try {
			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(join(runtimeConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const updated = await updateRuntimeConfig(tempProject, {
					modelRoles: {
						architect: {
							providerId: "anthropic",
							modelId: "claude-sonnet",
							reasoningEffort: "high",
						},
						worker: {
							providerId: "ollama",
							modelId: "qwen3.5-9b",
						},
					},
				});

				expect(updated.modelRoles.worker?.modelId).toBe("qwen3.5-9b");
				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					modelRoles?: Record<string, unknown>;
				};
				expect(globalPayload.modelRoles).toMatchObject({
					architect: {
						providerId: "anthropic",
						modelId: "claude-sonnet",
						reasoningEffort: "high",
					},
					worker: {
						providerId: "ollama",
						modelId: "qwen3.5-9b",
					},
				});
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("save omits default keys when they were not previously set", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-omit-defaults-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-omit-defaults-",
		);

		try {
			const runtimeConfigDir = join(tempHome, ".nklein", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(join(runtimeConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "nklein",
					selectedShortcutLabel: null,
					workspaceBaseDir: null,
					agentAutonomousModeEnabled: true,
					agentTimeoutMode: "normal",
					agentTimeoutProfile: "local",
					requestTimeoutMs: null,
					streamTimeoutMs: null,
					toolTimeoutMs: null,
					agentTimeoutMs: null,
					conversationTimeoutMs: null,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
				});

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					selectedAgentId?: string;
					agentAutonomousModeEnabled?: boolean;
					lostHeartbeatPolicy?: string;
					readyForReviewNotificationsEnabled?: boolean;
					commitPromptTemplate?: string;
					openPrPromptTemplate?: string;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.agentAutonomousModeEnabled).toBeUndefined();
				expect(globalPayload.lostHeartbeatPolicy).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBeUndefined();
				expect(globalPayload.commitPromptTemplate).toBeUndefined();
				expect(globalPayload.openPrPromptTemplate).toBeUndefined();
				expect(existsSync(join(tempProject, ".nklein", "nklein", "config.json"))).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("uses sandbox-safe git action prompt defaults", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-git-prompts-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-git-prompts-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);

				expect(current.commitPromptTemplateDefault).toContain("isolated task workspace");
				expect(current.commitPromptTemplateDefault).toContain("result branch");
				expect(current.commitPromptTemplateDefault).not.toContain("git worktree list");
				expect(current.commitPromptTemplateDefault).not.toContain("cherry-pick");
				expect(current.openPrPromptTemplateDefault).toContain("isolated task workspace");
				expect(current.openPrPromptTemplateDefault).not.toContain("git worktree list");
				expect(current.openPrPromptTemplateDefault).not.toContain("base workspace");
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("removes an existing empty project config file when no shortcuts are saved", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-cleanup-empty-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-cleanup-empty-",
		);

		try {
			const runtimeProjectConfigDir = join(tempProject, ".nklein", "nklein");
			mkdirSync(runtimeProjectConfigDir, { recursive: true });
			writeFileSync(join(runtimeProjectConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "nklein",
					selectedShortcutLabel: null,
					workspaceBaseDir: null,
					agentAutonomousModeEnabled: true,
					agentTimeoutMode: "normal",
					agentTimeoutProfile: "local",
					requestTimeoutMs: null,
					streamTimeoutMs: null,
					toolTimeoutMs: null,
					agentTimeoutMs: null,
					conversationTimeoutMs: null,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
				});

				expect(existsSync(join(tempProject, ".nklein", "nklein", "config.json"))).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("removes the project config file when the last shortcut is deleted", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-remove-last-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-remove-last-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "nklein",
					selectedShortcutLabel: null,
					workspaceBaseDir: null,
					agentAutonomousModeEnabled: true,
					agentTimeoutMode: "normal",
					agentTimeoutProfile: "local",
					requestTimeoutMs: null,
					streamTimeoutMs: null,
					toolTimeoutMs: null,
					agentTimeoutMs: null,
					conversationTimeoutMs: null,
					readyForReviewNotificationsEnabled: true,
					shortcuts: [{ label: "Ship", command: "npm run ship", icon: "rocket" }],
					commitPromptTemplate: current.commitPromptTemplateDefault,
					openPrPromptTemplate: current.openPrPromptTemplateDefault,
				});
				expect(existsSync(join(tempProject, ".nklein", "nklein", "config.json"))).toBe(true);

				await updateRuntimeConfig(tempProject, {
					shortcuts: [],
				});

				expect(existsSync(join(tempProject, ".nklein", "nklein", "config.json"))).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("updateRuntimeConfig supports partial updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-partial-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-partial-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await loadRuntimeConfig(tempProject);

				const updated = await updateRuntimeConfig(tempProject, {
					readyForReviewNotificationsEnabled: false,
				});
				expect(updated.readyForReviewNotificationsEnabled).toBe(false);

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					selectedAgentId?: string;
					selectedShortcutLabel?: string;
					agentAutonomousModeEnabled?: boolean;
					readyForReviewNotificationsEnabled?: boolean;
				};
				expect(globalPayload.selectedAgentId).toBeUndefined();
				expect(globalPayload.selectedShortcutLabel).toBeUndefined();
				expect(globalPayload.agentAutonomousModeEnabled).toBeUndefined();
				expect(globalPayload.readyForReviewNotificationsEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists replay cards as a disabled-by-default global setting", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-replay-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-replay-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const initial = await loadRuntimeConfig(tempProject);
				expect(initial.replayCardsEnabled).toBe(false);

				const updated = await updateRuntimeConfig(tempProject, {
					replayCardsEnabled: true,
				});
				expect(updated.replayCardsEnabled).toBe(true);

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					replayCardsEnabled?: boolean;
				};
				expect(globalPayload.replayCardsEnabled).toBe(true);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.replayCardsEnabled).toBe(true);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists sandbox pool settings as global runtime settings", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-sandbox-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-sandbox-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const initial = await loadRuntimeConfig(tempProject);
				expect(initial.sandboxMaxContainers).toBe(1);
				expect(initial.sandboxAgentsPerContainer).toBe(0);
				expect(initial.sandboxMemoryPerContainerMb).toBe(2048);
				expect(initial.sandboxCpusPerContainer).toBe(2);
				expect(initial.sandboxIdleTimeoutMinutes).toBe(10);

				const updated = await updateRuntimeConfig(tempProject, {
					sandboxMaxContainers: 2,
					sandboxAgentsPerContainer: 1,
					sandboxMemoryPerContainerMb: 8192,
					sandboxCpusPerContainer: 1.5,
					sandboxIdleTimeoutMinutes: 15,
				});
				expect(updated.sandboxMaxContainers).toBe(2);
				expect(updated.sandboxAgentsPerContainer).toBe(1);
				expect(updated.sandboxMemoryPerContainerMb).toBe(8192);
				expect(updated.sandboxCpusPerContainer).toBe(1.5);
				expect(updated.sandboxIdleTimeoutMinutes).toBe(15);

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					sandboxMaxContainers?: number;
					sandboxAgentsPerContainer?: number;
					sandboxMemoryPerContainerMb?: number;
					sandboxCpusPerContainer?: number;
					sandboxIdleTimeoutMinutes?: number;
				};
				expect(globalPayload).toMatchObject({
					sandboxMaxContainers: 2,
					sandboxAgentsPerContainer: 1,
					sandboxMemoryPerContainerMb: 8192,
					sandboxCpusPerContainer: 1.5,
					sandboxIdleTimeoutMinutes: 15,
				});

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.sandboxMaxContainers).toBe(2);
				expect(reloaded.sandboxAgentsPerContainer).toBe(1);
				expect(reloaded.sandboxMemoryPerContainerMb).toBe(8192);
				expect(reloaded.sandboxCpusPerContainer).toBe(1.5);
				expect(reloaded.sandboxIdleTimeoutMinutes).toBe(15);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists and reloads global code embedding defaults", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-embedding-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-embedding-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const updated = await updateRuntimeConfig(tempProject, {
					codeEmbeddingDefaults: {
						provider: "openai_compatible",
						baseUrl: "http://127.0.0.1:11434/v1/embeddings",
						model: "nomic-embed-text",
					},
				});

				expect(updated.codeEmbeddingDefaults).toEqual({
					provider: "openai_compatible",
					baseUrl: "http://127.0.0.1:11434/v1/embeddings",
					model: "nomic-embed-text",
				});
				expect(updated.effectiveCodeEmbeddingSettings).toEqual(updated.codeEmbeddingDefaults);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.codeEmbeddingDefaults).toEqual(updated.codeEmbeddingDefaults);
				expect(reloaded.effectiveCodeEmbeddingSettings).toEqual(updated.codeEmbeddingDefaults);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists project code embedding override and can reset to inherited defaults", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-embedding-project-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-embedding-project-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await updateRuntimeConfig(tempProject, {
					codeEmbeddingDefaults: {
						provider: "openai_compatible",
						baseUrl: "http://127.0.0.1:11434/v1/embeddings",
						model: "nomic-embed-text",
					},
				});

				const overridden = await updateRuntimeConfig(tempProject, {
					codeEmbeddingOverride: {
						provider: "openai_compatible",
						baseUrl: "http://127.0.0.1:1234/v1/embeddings",
						model: "project-embed",
					},
				});

				expect(overridden.codeEmbeddingOverride).toEqual({
					provider: "openai_compatible",
					baseUrl: "http://127.0.0.1:1234/v1/embeddings",
					model: "project-embed",
				});
				expect(overridden.effectiveCodeEmbeddingSettings).toEqual(overridden.codeEmbeddingOverride);

				const reset = await updateRuntimeConfig(tempProject, {
					codeEmbeddingOverride: null,
				});
				expect(reset.codeEmbeddingOverride).toBeNull();
				expect(reset.effectiveCodeEmbeddingSettings).toEqual(reset.codeEmbeddingDefaults);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists project maxConcurrentTasksOverride and derives effectiveMaxConcurrentTasks (§5.W)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir(
			"kanban-home-runtime-config-max-concurrent-override-",
		);
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-max-concurrent-override-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await updateRuntimeConfig(tempProject, { maxConcurrentTasks: 5 });

				const overridden = await updateRuntimeConfig(tempProject, {
					maxConcurrentTasksOverride: 2,
				});

				expect(overridden.maxConcurrentTasks).toBe(5);
				expect(overridden.maxConcurrentTasksOverride).toBe(2);
				expect(overridden.effectiveMaxConcurrentTasks).toBe(2);

				const reset = await updateRuntimeConfig(tempProject, {
					maxConcurrentTasksOverride: null,
				});
				expect(reset.maxConcurrentTasksOverride).toBeNull();
				expect(reset.effectiveMaxConcurrentTasks).toBe(reset.maxConcurrentTasks);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists project selectedAgentIdOverride and derives effectiveSelectedAgentId (§5.W)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-agent-override-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-agent-override-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await updateRuntimeConfig(tempProject, { selectedAgentId: "nklein" });

				const overridden = await updateRuntimeConfig(tempProject, {
					selectedAgentIdOverride: "claude",
				});

				expect(overridden.selectedAgentId).toBe("nklein");
				expect(overridden.selectedAgentIdOverride).toBe("claude");
				expect(overridden.effectiveSelectedAgentId).toBe("claude");

				const reset = await updateRuntimeConfig(tempProject, {
					selectedAgentIdOverride: null,
				});
				expect(reset.selectedAgentIdOverride).toBeNull();
				expect(reset.effectiveSelectedAgentId).toBe(reset.selectedAgentId);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists project agentRulesetsOverride and derives effectiveAgentRulesets (§5.W Phase 1)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir(
			"kanban-home-runtime-config-agent-rulesets-override-",
		);
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-agent-rulesets-override-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				// Set a non-default global agentRulesets so we can distinguish override from global.
				await updateRuntimeConfig(tempProject, {
					agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "fully_open" } },
				});

				const overridden = await updateRuntimeConfig(tempProject, {
					agentRulesetsOverride: {
						capability: { globalPreset: "more_open" },
						delivery: { globalPreset: "medium" },
					},
				});

				expect(overridden.agentRulesets?.capability.globalPreset).toBe("strict");
				expect(overridden.agentRulesetsOverride?.capability.globalPreset).toBe("more_open");
				expect(overridden.effectiveAgentRulesets?.capability.globalPreset).toBe("more_open");
				expect(overridden.effectiveAgentRulesets?.delivery.globalPreset).toBe("medium");

				// The override is persisted to the project config file.
				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.agentRulesetsOverride?.capability.globalPreset).toBe("more_open");
				expect(reloaded.effectiveAgentRulesets?.capability.globalPreset).toBe("more_open");
				expect(reloaded.agentRulesets?.capability.globalPreset).toBe("strict");

				// Resetting to null falls back to the global value.
				const reset = await updateRuntimeConfig(tempProject, {
					agentRulesetsOverride: null,
				});
				expect(reset.agentRulesetsOverride).toBeNull();
				expect(reset.effectiveAgentRulesets?.capability.globalPreset).toBe(
					reset.agentRulesets?.capability.globalPreset,
				);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists project modelRolesOverride and derives effectiveModelRoles (§5.W Phase 1)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir(
			"kanban-home-runtime-config-model-roles-override-",
		);
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-model-roles-override-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				// Set a non-default global modelRoles so we can distinguish override from global.
				await updateRuntimeConfig(tempProject, {
					modelRoles: {
						worker: { providerId: "ollama", modelId: "qwen2.5-coder" },
						reviewer: { providerId: "lmstudio", modelId: "deepseek-coder" },
					},
				});

				const overridden = await updateRuntimeConfig(tempProject, {
					modelRolesOverride: {
						worker: { providerId: "anthropic", modelId: "claude-sonnet" },
					},
				});

				expect(overridden.modelRoles.worker?.providerId).toBe("ollama");
				expect(overridden.modelRolesOverride?.worker?.providerId).toBe("anthropic");
				expect(overridden.effectiveModelRoles.worker?.providerId).toBe("anthropic");
				// Global reviewer is not present in the override.
				expect(overridden.effectiveModelRoles.reviewer).toBeUndefined();

				// The override is persisted to the project config file.
				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.modelRolesOverride?.worker?.providerId).toBe("anthropic");
				expect(reloaded.effectiveModelRoles.worker?.providerId).toBe("anthropic");
				expect(reloaded.modelRoles.worker?.providerId).toBe("ollama");

				// Resetting to null falls back to the global value.
				const reset = await updateRuntimeConfig(tempProject, {
					modelRolesOverride: null,
				});
				expect(reset.modelRolesOverride).toBeNull();
				expect(reset.effectiveModelRoles.worker?.providerId).toBe(reset.modelRoles.worker?.providerId);
				expect(reset.effectiveModelRoles.reviewer?.providerId).toBe("lmstudio");
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists non-default lost heartbeat policy", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-heartbeat-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-heartbeat-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const initial = await loadRuntimeConfig(tempProject);
				expect(initial.lostHeartbeatPolicy).toBe("park");

				const updated = await updateRuntimeConfig(tempProject, {
					lostHeartbeatPolicy: "keep_running",
				});

				expect(updated.lostHeartbeatPolicy).toBe("keep_running");
				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					lostHeartbeatPolicy?: string;
				};
				expect(globalPayload.lostHeartbeatPolicy).toBe("keep_running");
				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.lostHeartbeatPolicy).toBe("keep_running");
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists disabled decomposition auto-apply", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-auto-apply-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-auto-apply-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const initial = await loadRuntimeConfig(tempProject);
				expect(initial.decompositionAutoApplyEnabled).toBe(true);

				const updated = await updateRuntimeConfig(tempProject, {
					decompositionAutoApplyEnabled: false,
				});

				expect(updated.decompositionAutoApplyEnabled).toBe(false);
				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					decompositionAutoApplyEnabled?: boolean;
				};
				expect(globalPayload.decompositionAutoApplyEnabled).toBe(false);
				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.decompositionAutoApplyEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists autonomous mode when disabled", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-autonomous-disabled-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-autonomous-disabled-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const updated = await updateRuntimeConfig(tempProject, {
					agentAutonomousModeEnabled: false,
				});
				expect(updated.agentAutonomousModeEnabled).toBe(false);

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					agentAutonomousModeEnabled?: boolean;
				};
				expect(globalPayload.agentAutonomousModeEnabled).toBe(false);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("persists the configurable agent writable file line limit", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-write-limit-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir(
			"kanban-project-runtime-config-write-limit-",
		);

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const updated = await updateRuntimeConfig(tempProject, {
					maxAgentWritableFileLines: 2500,
				});
				expect(updated.maxAgentWritableFileLines).toBe(2500);

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".nklein", "nklein", "config.json"), "utf8"),
				) as {
					maxAgentWritableFileLines?: number;
				};
				expect(globalPayload.maxAgentWritableFileLines).toBe(2500);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.maxAgentWritableFileLines).toBe(2500);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("preserves concurrent config updates across processes", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-concurrent-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-concurrent-");

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				await loadRuntimeConfig(tempProject);

				const [selectedAgentState, autonomousModeState] = await Promise.all([
					updateRuntimeConfig(tempProject, {
						lostHeartbeatPolicy: "keep_running",
					}),
					updateRuntimeConfig(tempProject, {
						agentAutonomousModeEnabled: false,
					}),
				]);

				expect(selectedAgentState.lostHeartbeatPolicy).toBe("keep_running");
				expect(autonomousModeState.agentAutonomousModeEnabled).toBe(false);

				const reloaded = await loadRuntimeConfig(tempProject);
				expect(reloaded.lostHeartbeatPolicy).toBe("keep_running");
				expect(reloaded.agentAutonomousModeEnabled).toBe(false);
			});
		} finally {
			cleanupProject();
			cleanupHome();
		}
	});

	it("missing global config file returns null silently (no backup, no stderr)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-missing-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-missing-");

		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		// Type the spy explicitly to satisfy both write() overloads.
		const stderrSpy = (
			chunk: string | Uint8Array,
			encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
			cb?: (err?: Error | null) => void,
		): boolean => {
			stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
			if (typeof encodingOrCb === "function") {
				return originalWrite(chunk as string, encodingOrCb);
			}
			return originalWrite(chunk as string, encodingOrCb, cb);
		};
		process.stderr.write = stderrSpy as typeof process.stderr.write;

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				// No config file written — first-run scenario.
				const state = await loadRuntimeConfig(tempProject);
				// Falls back to defaults without error.
				expect(state.selectedAgentId).toBe("nklein");
				// No backup files created anywhere near the config path.
				const configDir = join(tempHome, ".nklein", "nklein");
				const backupsExist = existsSync(configDir)
					? readdirSync(configDir).some((f) => f.includes(".corrupt-"))
					: false;
				expect(backupsExist).toBe(false);
				// No stderr output for a plain missing file.
				const relevantOutput = stderrChunks.filter((c) => c.includes("[!Klein]"));
				expect(relevantOutput).toHaveLength(0);
			});
		} finally {
			process.stderr.write = originalWrite;
			cleanupProject();
			cleanupHome();
		}
	});

	it("corrupt global config file returns null, creates .bak, and logs a diagnostic", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-corrupt-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-corrupt-");

		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		// Type the spy explicitly to satisfy both write() overloads.
		const stderrSpy = (
			chunk: string | Uint8Array,
			encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
			cb?: (err?: Error | null) => void,
		): boolean => {
			stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
			if (typeof encodingOrCb === "function") {
				return originalWrite(chunk as string, encodingOrCb);
			}
			return originalWrite(chunk as string, encodingOrCb, cb);
		};
		process.stderr.write = stderrSpy as typeof process.stderr.write;

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const configDir = join(tempHome, ".nklein", "nklein");
				mkdirSync(configDir, { recursive: true });
				const configPath = join(configDir, "config.json");
				const corruptContent = "{ this is not valid JSON !!!";
				writeFileSync(configPath, corruptContent, "utf8");

				// loadRuntimeConfig must not throw — it falls back to defaults.
				const state = await loadRuntimeConfig(tempProject);
				expect(state.selectedAgentId).toBe("nklein");

				// A .corrupt-*.bak backup must have been created alongside the original.
				// (loadRuntimeConfig may read the file more than once on first-run, producing
				//  multiple backups — that's fine; what matters is at least one exists with the right bytes.)
				const files = readdirSync(configDir);
				const backups = files.filter((f) => f.startsWith("config.json.corrupt-") && f.endsWith(".bak"));
				expect(backups.length).toBeGreaterThanOrEqual(1);

				// Every backup must contain the original corrupt bytes.
				const backupFile = backups[0];
				expect(backupFile).toBeDefined();
				const backupContent = readFileSync(join(configDir, backupFile ?? ""), "utf8");
				expect(backupContent).toBe(corruptContent);

				// A diagnostic must have been written to stderr naming the config path.
				const diagnostics = stderrChunks.filter((c) => c.includes("[!Klein]") && c.includes("config.json"));
				expect(diagnostics.length).toBeGreaterThanOrEqual(1);
				expect(diagnostics.some((c) => c.includes("corrupt") || c.includes("could not be parsed"))).toBe(true);
			});
		} finally {
			process.stderr.write = originalWrite;
			cleanupProject();
			cleanupHome();
		}
	});

	it("valid global config file loads exactly as before (no backup, no stderr)", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-runtime-config-valid-");
		const { path: tempProject, cleanup: cleanupProject } = createTempDir("kanban-project-runtime-config-valid-");

		const stderrChunks: string[] = [];
		const originalWrite = process.stderr.write.bind(process.stderr);
		// Type the spy explicitly to satisfy both write() overloads.
		const stderrSpy = (
			chunk: string | Uint8Array,
			encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
			cb?: (err?: Error | null) => void,
		): boolean => {
			stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
			if (typeof encodingOrCb === "function") {
				return originalWrite(chunk as string, encodingOrCb);
			}
			return originalWrite(chunk as string, encodingOrCb, cb);
		};
		process.stderr.write = stderrSpy as typeof process.stderr.write;

		try {
			await withTemporaryEnv({ home: tempHome }, async () => {
				const configDir = join(tempHome, ".nklein", "nklein");
				mkdirSync(configDir, { recursive: true });
				writeFileSync(
					join(configDir, "config.json"),
					JSON.stringify({ maxConcurrentTasks: 7, developerModeEnabled: true }, null, 2),
					"utf8",
				);

				const state = await loadRuntimeConfig(tempProject);
				expect(state.maxConcurrentTasks).toBe(7);
				expect(state.developerModeEnabled).toBe(true);

				// No backup files should exist.
				const files = readdirSync(configDir);
				const backups = files.filter((f) => f.includes(".corrupt-"));
				expect(backups).toHaveLength(0);

				// No [!Klein] stderr output for a valid file.
				const relevantOutput = stderrChunks.filter((c) => c.includes("[!Klein]"));
				expect(relevantOutput).toHaveLength(0);
			});
		} finally {
			process.stderr.write = originalWrite;
			cleanupProject();
			cleanupHome();
		}
	});
});
