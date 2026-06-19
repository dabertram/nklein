import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	loadGlobalRuntimeConfig,
	loadRuntimeConfig,
	pickBestInstalledAgentIdFromDetected,
	saveRuntimeConfig,
	updateRuntimeConfig,
} from "../../../src/config/runtime-config";
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
		expect(pickBestInstalledAgentIdFromDetected(["droid", "gemini", "cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["gemini", "cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["claude", "codex", "cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["claude", "droid"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected(["cline"])).toBeNull();
		expect(pickBestInstalledAgentIdFromDetected([])).toBeNull();
	});

	it("keeps fresh config on local Cline even when external CLIs are installed", async () => {
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
					expect(state.selectedAgentId).toBe("cline");
					expect(existsSync(join(tempHome, ".cline", "nklein", "config.json"))).toBe(false);

					const reloadedState = await loadRuntimeConfig(tempProject);
					expect(reloadedState.selectedAgentId).toBe("cline");
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
					expect(state.selectedAgentId).toBe("cline");
					expect(existsSync(join(tempHome, ".cline", "nklein", "config.json"))).toBe(false);
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
				expect(state.globalConfigPath).toBe(join(tempHome, ".cline", "nklein", "config.json"));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);

				const updated = await updateRuntimeConfig(tempHome, {
					agentAutonomousModeEnabled: false,
				});
				expect(updated.agentAutonomousModeEnabled).toBe(false);
				expect(updated.projectConfigPath).toBeNull();

				const globalPayload = JSON.parse(
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
				expect(state.globalConfigPath).toBe(join(tempHome, ".cline", "nklein", "config.json"));
				expect(state.projectConfigPath).toBeNull();
				expect(state.shortcuts).toEqual([]);
			});
		} finally {
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

					const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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
			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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
			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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

			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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
				expect(state.selectedAgentId).toBe("cline");
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

			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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
				expect(state.selectedAgentId).toBe("cline");
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
			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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
			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
			const runtimeConfigDir = join(tempHome, ".cline", "nklein");
			mkdirSync(runtimeConfigDir, { recursive: true });
			writeFileSync(join(runtimeConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
				expect(existsSync(join(tempProject, ".cline", "nklein", "config.json"))).toBe(false);
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
			const runtimeProjectConfigDir = join(tempProject, ".cline", "nklein");
			mkdirSync(runtimeProjectConfigDir, { recursive: true });
			writeFileSync(join(runtimeProjectConfigDir, "config.json"), "{}", "utf8");

			await withTemporaryEnv({ home: tempHome }, async () => {
				const current = await loadRuntimeConfig(tempProject);
				await saveRuntimeConfig(tempProject, {
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
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

				expect(existsSync(join(tempProject, ".cline", "nklein", "config.json"))).toBe(false);
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
					selectedAgentId: "cline",
					selectedShortcutLabel: null,
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
				expect(existsSync(join(tempProject, ".cline", "nklein", "config.json"))).toBe(true);

				await updateRuntimeConfig(tempProject, {
					shortcuts: [],
				});

				expect(existsSync(join(tempProject, ".cline", "nklein", "config.json"))).toBe(false);
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
					readFileSync(join(tempHome, ".cline", "nklein", "config.json"), "utf8"),
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
});
