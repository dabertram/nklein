import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseTaskAgentModelPickerResult } from "@/components/task-agent-model-picker";
import type {
	RuntimeAgentId,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeTaskNKleinSettings,
} from "@/runtime/types";

const fetchNKleinProviderCatalogMock = vi.hoisted(() => vi.fn());
const fetchNKleinProviderModelsMock = vi.hoisted(() => vi.fn());

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "nklein", label: "!Klein", binary: "nklein" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
	]),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchNKleinProviderCatalog: fetchNKleinProviderCatalogMock,
	fetchNKleinProviderModels: fetchNKleinProviderModelsMock,
}));

function createProvider(
	id: string,
	name: string,
	enabled: boolean,
	defaultModelId: string | null = null,
	baseUrl: string | null = null,
): RuntimeNKleinProviderCatalogItem {
	return { id, name, oauthSupported: false, enabled, defaultModelId, baseUrl, supportsBaseUrl: baseUrl !== null };
}

function createTaskNKleinSettings(settings?: RuntimeTaskNKleinSettings): RuntimeTaskNKleinSettings | undefined {
	return settings;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.clearAllMocks();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("useTaskAgentModelPicker – nkleinProviderOptions", () => {
	it("shows local providers except the default, regardless of enabled flag", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("lmstudio", "LM Studio", true),
			createProvider("ollama", "Ollama", false),
			createProvider("custom-local", "Custom Local", false, null, "http://127.0.0.1:4000/v1"),
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "lmstudio",
				defaultModelId: null,
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const options = snapshot!.nkleinProviderOptions;
		expect(options[0]).toEqual({ value: "", label: "LM Studio" });
		const nonDefault = options.slice(1);
		expect(nonDefault).toEqual([
			{ value: "ollama", label: "Ollama" },
			{ value: "custom-local", label: "Custom Local" },
		]);
	});
	it("excludes the default provider from the explicit list", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("ollama", "Ollama", true),
			createProvider("lmstudio", "LM Studio", true),
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "ollama",
				defaultModelId: null,
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const options = snapshot!.nkleinProviderOptions;
		expect(options[0]).toEqual({ value: "", label: "Ollama" });
		const values = options.slice(1).map((o) => o.value);
		expect(values).toContain("lmstudio");
		expect(values).not.toContain("ollama");
	});

	it("returns only the default option when catalog is empty", async () => {
		fetchNKleinProviderCatalogMock.mockResolvedValue([]);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "nklein",
				defaultModelId: null,
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.nkleinProviderOptions).toEqual([{ value: "", label: "Default" }]);
	});

	it("does not surface a legacy cloud provider label as the default option when only local providers are available", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("ollama", "Ollama", true),
			createProvider("lmstudio", "LM Studio", true),
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "openrouter",
				defaultModelId: null,
				cloudProviderSupportEnabled: false,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.nkleinProviderOptions[0]).toEqual({ value: "", label: "Default" });
	});

	it("filters cloud providers out of the explicit provider list in local-only mode", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("openrouter", "OpenRouter", true),
			createProvider("anthropic", "Anthropic", true),
			createProvider("groq", "Groq", true),
			createProvider("custom-cloud", "Custom Cloud", true, null, "https://models.example.com/v1"),
			createProvider("custom-local", "Custom Local", true, null, "http://localhost:4000/v1"),
			createProvider("ollama", "Ollama", true),
			createProvider("lmstudio", "LM Studio", true),
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "openrouter",
				defaultModelId: null,
				cloudProviderSupportEnabled: false,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.nkleinProviderOptions).toEqual([
			{ value: "", label: "Default" },
			{ value: "custom-local", label: "Custom Local" },
			{ value: "ollama", label: "Ollama" },
			{ value: "lmstudio", label: "LM Studio" },
		]);
	});
});

describe("useTaskAgentModelPicker – providerDefaultModels", () => {
	it("returns a map of provider ID → default model ID", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("ollama", "Ollama", true, "qwen3.5-9b"),
			createProvider("custom-local", "Custom Local", true, "local-model", "http://127.0.0.1:4000/v1"),
			createProvider("lmstudio", "LM Studio", true), // no default model
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "ollama",
				defaultModelId: "qwen3.5-9b",
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.providerDefaultModels).toEqual({
			ollama: "qwen3.5-9b",
			"custom-local": "local-model",
		});
	});
});

describe("useTaskAgentModelPicker – provider-aware model default label", () => {
	it("does not load inherited cloud provider models even when stale config enables cloud support", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("nklein", "NKlein", true, "nklein-sonnet"),
			createProvider("anthropic", "Anthropic", true, "claude-opus-4-20250514"),
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{ id: "nklein-sonnet", name: "NKlein Sonnet" },
			{ id: "nklein-opus", name: "NKlein Opus" },
		]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined,
				defaultAgentId: "nklein",
				defaultProviderId: "nklein",
				defaultModelId: null,
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(fetchNKleinProviderModelsMock).not.toHaveBeenCalled();
		expect(snapshot).not.toBeNull();
		expect(snapshot!.providerModels).toEqual([]);
		expect(snapshot!.effectiveDefaultModelId).toBeNull();
	});

	it("does not borrow the global default model for an overridden provider without a catalog default", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("ollama", "Ollama", true, "qwen3.5-9b"),
			createProvider("custom", "Custom Provider", true, null, "http://127.0.0.1:4000/v1"),
		];
		const customModels = [{ id: "custom/model-a", name: "Model A" }];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue(customModels);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: createTaskNKleinSettings({ providerId: "custom" }),
				defaultAgentId: "nklein",
				defaultProviderId: "ollama",
				defaultModelId: "qwen3.5-9b",
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.effectiveDefaultModelId).toBeNull();
		expect(snapshot!.nkleinModelOptions[0]).toEqual({ value: "", label: "Default" });
	});

	it("shows the selected provider's default model name when provider is overridden", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("ollama", "Ollama", true, "qwen3.5-9b"),
			createProvider("custom-local", "Custom Local", true, "local-default", "http://127.0.0.1:4000/v1"),
		];
		const localModels = [
			{ id: "local-default", name: "Local Default" },
			{ id: "local-alt", name: "Local Alt" },
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue(localModels);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: createTaskNKleinSettings({ providerId: "custom-local" }),
				defaultAgentId: "nklein",
				defaultProviderId: "ollama",
				defaultModelId: "qwen3.5-9b",
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const defaultOption = snapshot!.nkleinModelOptions[0]!;
		expect(defaultOption.value).toBe("");
		expect(defaultOption.label).toBe("Local Default");
	});

	it("shows the global default model when no provider override is set", async () => {
		const catalog: RuntimeNKleinProviderCatalogItem[] = [
			createProvider("ollama", "Ollama", true, "qwen3.5-9b"),
			createProvider("custom-local", "Custom Local", true, "local-default", "http://127.0.0.1:4000/v1"),
		];
		const ollamaModels = [
			{ id: "qwen3.5-9b", name: "Qwen 3.5 9B" },
			{ id: "qwen3.5-32b", name: "Qwen 3.5 32B" },
		];
		fetchNKleinProviderCatalogMock.mockResolvedValue(catalog);
		fetchNKleinProviderModelsMock.mockResolvedValue(ollamaModels);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "nklein",
				nkleinSettings: undefined, // no provider override
				defaultAgentId: "nklein",
				defaultProviderId: "ollama",
				defaultModelId: "qwen3.5-9b",
				cloudProviderSupportEnabled: true,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const defaultOption = snapshot!.nkleinModelOptions[0]!;
		expect(defaultOption.value).toBe("");
		expect(defaultOption.label).toBe("Qwen 3.5 9B");
	});
});

describe("TaskAgentModelPicker – auto-reset invalid model selection", () => {
	it("resets nkleinModelId to the first real model when the selected model is not in the options list", async () => {
		const onNKleinSettingsChange = vi.fn();
		const modelOptions = [
			{ value: "", label: "Llama 3.3 70B" },
			{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
			{ value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
		];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={createTaskNKleinSettings({
						providerId: "groq",
						modelId: "claude-opus-4-20250514",
					})}
					onNKleinSettingsChange={onNKleinSettingsChange}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "Anthropic" }]}
					nkleinModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		// The effect should have fired and selected the first real model
		expect(onNKleinSettingsChange).toHaveBeenCalledWith({
			providerId: "groq",
			modelId: "llama-3.3-70b-versatile",
		});
	});

	it("does not reset when the selected model exists in the options list", async () => {
		const onNKleinSettingsChange = vi.fn();
		const modelOptions = [
			{ value: "", label: "Llama 3.3 70B" },
			{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
			{ value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
		];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={createTaskNKleinSettings({
						providerId: "groq",
						modelId: "llama-3.3-70b-versatile",
					})}
					onNKleinSettingsChange={onNKleinSettingsChange}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "Groq" }]}
					nkleinModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		expect(onNKleinSettingsChange).not.toHaveBeenCalled();
	});

	it("does not reset while models are still loading", async () => {
		const onNKleinSettingsChange = vi.fn();
		const modelOptions = [{ value: "", label: "Default" }];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={createTaskNKleinSettings({
						providerId: "groq",
						modelId: "claude-opus-4-20250514",
					})}
					onNKleinSettingsChange={onNKleinSettingsChange}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "Anthropic" }]}
					nkleinModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={true} // <-- still loading
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		expect(onNKleinSettingsChange).not.toHaveBeenCalled();
	});

	it("does not reset when model options only contain the default placeholder (race condition guard)", async () => {
		const onNKleinSettingsChange = vi.fn();
		// Only the "Default" placeholder — real models haven't loaded yet
		const modelOptions = [{ value: "", label: "Default" }];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={createTaskNKleinSettings({
						providerId: "groq",
						modelId: "mixtral-8x7b-32768",
					})}
					onNKleinSettingsChange={onNKleinSettingsChange}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "Groq" }]}
					nkleinModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={false} // <-- false (initial state before fetch sets it to true)
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		// Should NOT clear the model — the stale/empty options list should not trigger auto-correct
		expect(onNKleinSettingsChange).not.toHaveBeenCalled();
	});
});

describe("TaskAgentModelPicker – inherited default reasoning effort", () => {
	it("shows reasoning metadata for an inherited default model and opens reasoning choices immediately", async () => {
		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={undefined}
					onNKleinSettingsChange={() => {}}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "!Klein" }]}
					nkleinModelOptions={[
						{ value: "", label: "GPT-5.4" },
						{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
					]}
					effectiveDefaultModelId="openai/gpt-5.4"
					providerModels={[
						{ id: "openai/gpt-5.4", name: "GPT-5.4", supportsReasoningEffort: true },
						{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex", supportsReasoningEffort: true },
					]}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="nklein"
					defaultReasoningEffort="high"
				/>,
			),
		);

		const settingsTrigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Override Agent Settings"),
		);
		expect(settingsTrigger).not.toBeUndefined();
		await act(async () => {
			(settingsTrigger as HTMLButtonElement).click();
		});

		expect(container.textContent).toContain("GPT-5.4 (High)");

		const trigger = document.getElementById("nklein-chat-model-picker");
		expect(trigger).not.toBeNull();
		await act(async () => {
			(trigger as HTMLElement).click();
		});

		expect(document.body.textContent).toContain("Reasoning effort");
	});

	it("retains inherited reasoning effort until model capability data is available", async () => {
		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		const renderPicker = async (providerModels: RuntimeNKleinProviderModel[]) => {
			await act(async () =>
				root.render(
					<TaskAgentModelPicker
						agentId={"nklein" as RuntimeAgentId}
						onAgentIdChange={() => {}}
						nkleinSettings={undefined}
						onNKleinSettingsChange={() => {}}
						agentOptions={[{ value: "", label: "!Klein" }]}
						nkleinProviderOptions={[{ value: "", label: "!Klein" }]}
						nkleinModelOptions={[
							{ value: "", label: "GPT-5.4" },
							{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
						]}
						effectiveDefaultModelId="openai/gpt-5.4"
						providerModels={providerModels}
						isLoadingProviders={false}
						isLoadingModels={false}
						defaultAgentId={"nklein" as RuntimeAgentId}
						defaultProviderId="nklein"
						defaultReasoningEffort="high"
					/>,
				),
			);
		};

		await renderPicker([]);

		const settingsTrigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Override Agent Settings"),
		);
		expect(settingsTrigger).not.toBeUndefined();
		await act(async () => {
			(settingsTrigger as HTMLButtonElement).click();
		});

		await renderPicker([
			{ id: "openai/gpt-5.4", name: "GPT-5.4", supportsReasoningEffort: true },
			{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex", supportsReasoningEffort: true },
		]);

		expect(container.textContent).toContain("GPT-5.4 (High)");
	});

	it("persists a reasoning-only override when model stays on default", async () => {
		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");
		const onNKleinSettingsChange = vi.fn();

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={undefined}
					onNKleinSettingsChange={onNKleinSettingsChange}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "!Klein" }]}
					nkleinModelOptions={[
						{ value: "", label: "GPT-5.4" },
						{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
					]}
					effectiveDefaultModelId="openai/gpt-5.4"
					providerModels={[
						{ id: "openai/gpt-5.4", name: "GPT-5.4", supportsReasoningEffort: true },
						{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex", supportsReasoningEffort: true },
					]}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="nklein"
					defaultReasoningEffort="high"
				/>,
			),
		);

		const settingsTrigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Override Agent Settings"),
		);
		expect(settingsTrigger).not.toBeUndefined();
		await act(async () => {
			(settingsTrigger as HTMLButtonElement).click();
		});

		const modelTrigger = document.getElementById("nklein-chat-model-picker");
		expect(modelTrigger).not.toBeNull();
		await act(async () => {
			(modelTrigger as HTMLElement).click();
		});

		const lowReasoningButton = Array.from(document.querySelectorAll("button")).find((button) =>
			button.textContent?.trim().toLowerCase().startsWith("low"),
		);
		expect(lowReasoningButton).not.toBeUndefined();
		await act(async () => {
			(lowReasoningButton as HTMLButtonElement).click();
		});

		expect(onNKleinSettingsChange).toHaveBeenLastCalledWith({
			reasoningEffort: "low",
		});
	});

	it("persists an explicit default reasoning override when the task inherits a global reasoning effort", async () => {
		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");
		const onNKleinSettingsChange = vi.fn();

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={undefined}
					onNKleinSettingsChange={onNKleinSettingsChange}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "!Klein" }]}
					nkleinModelOptions={[{ value: "", label: "GPT-5.4" }]}
					effectiveDefaultModelId="openai/gpt-5.4"
					providerModels={[{ id: "openai/gpt-5.4", name: "GPT-5.4", supportsReasoningEffort: true }]}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="nklein"
					defaultReasoningEffort="high"
				/>,
			),
		);

		const settingsTrigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Override Agent Settings"),
		);
		expect(settingsTrigger).not.toBeUndefined();
		await act(async () => {
			(settingsTrigger as HTMLButtonElement).click();
		});

		const modelTrigger = document.getElementById("nklein-chat-model-picker");
		expect(modelTrigger).not.toBeNull();
		await act(async () => {
			(modelTrigger as HTMLElement).click();
		});

		const defaultReasoningButton = Array.from(document.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Default",
		);
		expect(defaultReasoningButton).not.toBeUndefined();
		await act(async () => {
			(defaultReasoningButton as HTMLButtonElement).click();
		});

		expect(onNKleinSettingsChange).toHaveBeenLastCalledWith({});
	});

	it("does not inherit the global reasoning effort for explicit task model overrides", async () => {
		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"nklein" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					nkleinSettings={createTaskNKleinSettings({
						modelId: "openai/gpt-5.3-codex",
					})}
					onNKleinSettingsChange={() => {}}
					agentOptions={[{ value: "", label: "!Klein" }]}
					nkleinProviderOptions={[{ value: "", label: "!Klein" }]}
					nkleinModelOptions={[
						{ value: "", label: "GPT-5.4" },
						{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
					]}
					effectiveDefaultModelId="openai/gpt-5.4"
					providerModels={[
						{ id: "openai/gpt-5.4", name: "GPT-5.4", supportsReasoningEffort: true },
						{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex", supportsReasoningEffort: true },
					]}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"nklein" as RuntimeAgentId}
					defaultProviderId="nklein"
					defaultReasoningEffort="high"
				/>,
			),
		);

		const settingsTrigger = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Override Agent Settings"),
		);
		expect(settingsTrigger).not.toBeUndefined();
		await act(async () => {
			(settingsTrigger as HTMLButtonElement).click();
		});

		expect(container.textContent).toContain("GPT-5.3 Codex");
		expect(container.textContent).not.toContain("GPT-5.3 Codex (High)");
	});
});
