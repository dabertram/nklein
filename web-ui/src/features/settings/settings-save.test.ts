import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { describe, expect, it } from "vitest";
import { swarmGuardrailsToInputs } from "@/components/runtime-settings-swarm-guardrails";
import {
	initSettingsDraftFromConfig,
	type SettingsConfigSnapshot,
	type SettingsDraft,
} from "@/features/settings/settings-draft";
import {
	buildRuntimeConfigSaveRequest,
	findFirstModelRoleAvailabilityWarning,
	getModelRoleAvailabilityWarningForSave,
	getModelRoleContextWarningForSave,
	type ModelRoleWarningContext,
	parsePositiveNumberInput,
	parseTimeoutMsInput,
	validateAndParseSettingsNumbers,
	validateCodeEmbeddingDefaultsForSave,
} from "@/features/settings/settings-save";
import type { RuntimeNKleinProviderModel } from "@/runtime/types";

function draftFromSnapshot(snapshot: SettingsConfigSnapshot): SettingsDraft {
	const { swarmGuardrails, ...common } = snapshot;
	return { ...common, swarmGuardrailInputs: swarmGuardrailsToInputs(swarmGuardrails) };
}

/** A valid draft seeded from the no-config defaults. */
function makeDraft(overrides?: Partial<SettingsDraft>): SettingsDraft {
	return {
		...draftFromSnapshot(initSettingsDraftFromConfig(null, { cloudProviderSupportEnabled: false })),
		...overrides,
	};
}

describe("parseTimeoutMsInput", () => {
	it("treats blank input as unset", () => {
		expect(parseTimeoutMsInput("")).toBeNull();
		expect(parseTimeoutMsInput("   ")).toBeNull();
	});

	it("accepts non-negative integers (trimmed)", () => {
		expect(parseTimeoutMsInput("0")).toBe(0);
		expect(parseTimeoutMsInput(" 42 ")).toBe(42);
	});

	it("rejects negatives, fractions, and non-numbers", () => {
		expect(parseTimeoutMsInput("-1")).toBe("invalid");
		expect(parseTimeoutMsInput("1.5")).toBe("invalid");
		expect(parseTimeoutMsInput("abc")).toBe("invalid");
	});
});

describe("parsePositiveNumberInput", () => {
	it("accepts positive numbers including fractions", () => {
		expect(parsePositiveNumberInput("2")).toBe(2);
		expect(parsePositiveNumberInput(" 2.5 ")).toBe(2.5);
	});

	it("rejects zero, negatives, blanks, and non-numbers", () => {
		expect(parsePositiveNumberInput("0")).toBe("invalid");
		expect(parsePositiveNumberInput("-3")).toBe("invalid");
		expect(parsePositiveNumberInput("")).toBe("invalid");
		expect(parsePositiveNumberInput("x")).toBe("invalid");
	});
});

describe("validateAndParseSettingsNumbers", () => {
	it("parses a valid draft, mapping blank timeouts to null", () => {
		const result = validateAndParseSettingsNumbers(makeDraft({ requestTimeoutMs: "120000" }));
		expect(result).toEqual({
			ok: true,
			parsed: {
				requestTimeoutMs: 120_000,
				streamTimeoutMs: null,
				toolTimeoutMs: null,
				agentTimeoutMs: null,
				conversationTimeoutMs: null,
				maxAgentWritableFileLines: 1000,
				maxConcurrentTasks: 3,
				sandboxMaxContainers: 1,
				sandboxAgentsPerContainer: 0,
				sandboxMemoryPerContainerMb: 2048,
				sandboxCpusPerContainer: 2,
				sandboxIdleTimeoutMinutes: 10,
			},
		});
	});

	it("returns the aggregate parse error for malformed or missing required numbers", () => {
		const expected =
			"Timeout values must be integers >= 0; the file-size soft target, concurrency, and sandbox pool settings must be within their allowed ranges.";
		for (const overrides of [
			{ requestTimeoutMs: "-5" },
			{ conversationTimeoutMs: "1.2" },
			{ maxConcurrentTasks: "" },
			{ sandboxMaxContainers: "abc" },
			{ sandboxCpusPerContainer: "0" },
			{ sandboxCpusPerContainer: "" },
			{ sandboxIdleTimeoutMinutes: "" },
		] satisfies Array<Partial<SettingsDraft>>) {
			const result = validateAndParseSettingsNumbers(makeDraft(overrides));
			expect(result).toEqual({ ok: false, error: expected });
		}
	});

	it("returns the per-field range error messages", () => {
		const cases: Array<[Partial<SettingsDraft>, string]> = [
			[{ maxAgentWritableFileLines: "0" }, "The file-size soft target must be an integer >= 1."],
			[{ maxConcurrentTasks: "0" }, "Max concurrent tasks must be an integer >= 1."],
			[{ sandboxMaxContainers: "0" }, "Sandbox max containers must be an integer >= 1."],
			[{ sandboxMemoryPerContainerMb: "0" }, "Sandbox memory per container must be an integer >= 1."],
			[{ sandboxIdleTimeoutMinutes: "0" }, "Sandbox idle timeout must be an integer >= 1 minute."],
		];
		for (const [overrides, message] of cases) {
			expect(validateAndParseSettingsNumbers(makeDraft(overrides))).toEqual({ ok: false, error: message });
		}
	});

	it("allows zero sandbox agents per container (unlimited pool)", () => {
		const result = validateAndParseSettingsNumbers(makeDraft({ sandboxAgentsPerContainer: "0" }));
		expect(result.ok).toBe(true);
	});
});

describe("validateCodeEmbeddingDefaultsForSave", () => {
	it("requires both endpoint URL and model for OpenAI-compatible defaults", () => {
		const message = "Default OpenAI-compatible embeddings need both an endpoint URL and a model id.";
		expect(validateCodeEmbeddingDefaultsForSave({ provider: "openai_compatible", model: "", baseUrl: null })).toBe(
			message,
		);
		expect(
			validateCodeEmbeddingDefaultsForSave({ provider: "openai_compatible", model: "embed-1", baseUrl: null }),
		).toBe(message);
		expect(
			validateCodeEmbeddingDefaultsForSave({
				provider: "openai_compatible",
				model: "embed-1",
				baseUrl: "http://127.0.0.1:1234/v1",
			}),
		).toBeNull();
	});

	it("accepts the local lexical provider without endpoint details", () => {
		expect(
			validateCodeEmbeddingDefaultsForSave({ provider: "local_lexical", model: "anything", baseUrl: null }),
		).toBeNull();
	});
});

describe("model role save warnings", () => {
	const loadedModels: RuntimeNKleinProviderModel[] = [
		{ id: "qwen3-8b", name: "Qwen3 8B", contextWindow: 40_000 },
		{ id: "tiny-4k", name: "Tiny", contextWindow: 4_000 },
	];

	function makeContext(overrides?: Partial<ModelRoleWarningContext>): ModelRoleWarningContext {
		return {
			modelRoles: {},
			nkleinProviderId: "lmstudio",
			providerCatalog: [],
			getModelsForProvider: () => loadedModels,
			...overrides,
		};
	}

	it("passes roles on auto with no pinned model", () => {
		expect(getModelRoleAvailabilityWarningForSave("worker", makeContext())).toBeNull();
		expect(getModelRoleContextWarningForSave("worker", makeContext())).toBeNull();
	});

	it("requires an explicit loaded model when a role pins the LM Studio provider without a model", () => {
		const context = makeContext({ modelRoles: { worker: { providerId: "lmstudio" } } });
		expect(getModelRoleAvailabilityWarningForSave("worker", context)).toBe(
			"Worker role uses LM Studio. Choose a loaded LM Studio model before saving.",
		);
	});

	it("flags a pinned LM Studio model that is not currently loaded", () => {
		const context = makeContext({ modelRoles: { worker: { providerId: "lmstudio", modelId: "gone-model" } } });
		expect(getModelRoleAvailabilityWarningForSave("worker", context)).toBe(
			'Worker model "gone-model" is not loaded in LM Studio. Load it, refresh models, then choose it before saving.',
		);
	});

	it("skips availability checks for non-LM-Studio providers", () => {
		const context = makeContext({
			nkleinProviderId: "openrouter",
			modelRoles: { worker: { providerId: "openrouter", modelId: "whatever" } },
		});
		expect(getModelRoleAvailabilityWarningForSave("worker", context)).toBeNull();
	});

	it("warns when a pinned model is below the minimum context window", () => {
		const context = makeContext({ modelRoles: { reviewer: { modelId: "tiny-4k" } } });
		expect(getModelRoleContextWarningForSave("reviewer", context)).toBe(
			"Reviewer model reports 4,000 context tokens. !Klein requires at least 32,000 before activation.",
		);
		const okContext = makeContext({ modelRoles: { reviewer: { modelId: "qwen3-8b" } } });
		expect(getModelRoleContextWarningForSave("reviewer", okContext)).toBeNull();
	});

	it("finds the first failing role across all roles", () => {
		const context = makeContext({
			modelRoles: {
				architect: { providerId: "lmstudio", modelId: "qwen3-8b" },
				worker: { providerId: "lmstudio" },
			},
		});
		expect(findFirstModelRoleAvailabilityWarning(context)).toBe(
			"Worker role uses LM Studio. Choose a loaded LM Studio model before saving.",
		);
		expect(findFirstModelRoleAvailabilityWarning(makeContext())).toBeNull();
	});
});

describe("buildRuntimeConfigSaveRequest", () => {
	const parsedDefaults = {
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 2048,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
	};

	it("uses parsed numbers and null-or-trimmed sparse fields", () => {
		const payload = buildRuntimeConfigSaveRequest(
			makeDraft({ workspaceBaseDir: "  /workspaces/x  ", retrievalSearchBackendUrl: "   " }),
			{ ...parsedDefaults, requestTimeoutMs: 120_000 },
		);
		expect(payload.requestTimeoutMs).toBe(120_000);
		expect(payload.streamTimeoutMs).toBeNull();
		expect(payload.workspaceBaseDir).toBe("/workspaces/x");
		expect(payload.retrievalSearchBackendUrl).toBeNull();
		expect(payload.maxConcurrentTasks).toBe(3);
		expect(payload.sandboxCpusPerContainer).toBe(2);
	});

	it("converts guardrail inputs back to the structured wire shape", () => {
		const payload = buildRuntimeConfigSaveRequest(makeDraft(), parsedDefaults);
		expect(payload.swarmGuardrails).toEqual(DEFAULT_RUNTIME_SWARM_GUARDRAILS);
	});

	it("passes the egress-proxy flag through and trims / nulls the host allowlist (§6 I3)", () => {
		const setPayload = buildRuntimeConfigSaveRequest(
			makeDraft({ sandboxEgressProxyEnabled: true, sandboxEgressAllowlist: "  api.github.com, pkg.example.org  " }),
			parsedDefaults,
		);
		expect(setPayload.sandboxEgressProxyEnabled).toBe(true);
		expect(setPayload.sandboxEgressAllowlist).toBe("api.github.com, pkg.example.org");

		const blankPayload = buildRuntimeConfigSaveRequest(
			makeDraft({ sandboxEgressProxyEnabled: false, sandboxEgressAllowlist: "   " }),
			parsedDefaults,
		);
		expect(blankPayload.sandboxEgressProxyEnabled).toBe(false);
		expect(blankPayload.sandboxEgressAllowlist).toBeNull();
	});

	it("normalizes model roles and keeps a null override as null", () => {
		const payload = buildRuntimeConfigSaveRequest(
			makeDraft({
				modelRoles: { worker: { providerId: "  ", modelId: "qwen3-8b" }, architect: {} },
				modelRolesOverride: null,
			}),
			parsedDefaults,
		);
		expect(payload.modelRoles).toEqual({ worker: { modelId: "qwen3-8b" } });
		expect(payload.modelRolesOverride).toBeNull();
	});

	it("normalizes a present model-roles override", () => {
		const payload = buildRuntimeConfigSaveRequest(
			makeDraft({ modelRolesOverride: { reviewer: { modelId: " qwen3-14b " }, worker: {} } }),
			parsedDefaults,
		);
		expect(payload.modelRolesOverride).toEqual({ reviewer: { modelId: "qwen3-14b" } });
	});

	it("carries the policy and override field groups through unchanged", () => {
		const draft = makeDraft({
			modelGateUnsuitable: "warn",
			modelGateUnknown: "reject",
			skillDynamicsLevel: "assigned_skills",
			skillDynamicsLevelOverride: "fully_static",
			maxConcurrentTasksOverride: 4,
			selectedAgentIdOverride: "nklein",
			concurrencyDefaults: { perProvider: { lmstudio: 2 }, perModel: {}, perHost: {}, perEndpoint: {} },
			concurrencyOverride: null,
			commitPromptTemplate: "Commit body",
			openPrPromptTemplate: "PR body",
		});
		const payload = buildRuntimeConfigSaveRequest(draft, parsedDefaults);
		expect(payload.modelSuitabilityPolicyDefaults).toEqual({ onUnsuitable: "warn", onUnknown: "reject" });
		expect(payload.skillDynamicsLevelDefault).toBe("assigned_skills");
		expect(payload.skillDynamicsLevelOverride).toBe("fully_static");
		expect(payload.maxConcurrentTasksOverride).toBe(4);
		expect(payload.selectedAgentIdOverride).toBe("nklein");
		expect(payload.concurrencyDefaults).toEqual({
			perProvider: { lmstudio: 2 },
			perModel: {},
			perHost: {},
			perEndpoint: {},
		});
		expect(payload.concurrencyOverride).toBeNull();
		expect(payload.commitPromptTemplate).toBe("Commit body");
		expect(payload.openPrPromptTemplate).toBe("PR body");
		// Request-only fields the dialog never sends stay omitted (sparse semantics).
		expect("setupWizardCompletedAt" in payload).toBe(false);
		expect("selectedShortcutLabel" in payload).toBe(false);
	});
});
