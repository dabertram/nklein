import { describe, expect, it } from "vitest";
import { buildSandboxMcpSettingsPreview } from "../../../src/core/sandbox-mcp-settings-preview";

describe("buildSandboxMcpSettingsPreview", () => {
	it("projects availability, model fit, memory fit, controls, and final active state from the runtime gates", () => {
		const preview = buildSandboxMcpSettingsPreview({
			modelId: "qwen/qwen3-8b",
			containerMemoryLimitMb: 4096,
			sandboxImageAvailable: true,
			sandboxMcpServersEnabled: true,
			basicMemoryEnabled: true,
			sandboxMcpServerOverrides: { "sequential-thinking": false },
		});
		const sequential = preview.servers.find((server) => server.id === "sequential-thinking");
		const codebase = preview.servers.find((server) => server.id === "codebase-memory");
		const basic = preview.servers.find((server) => server.id === "basic-memory");

		expect(sequential).toMatchObject({ available: true, modelFit: { offer: true }, active: false });
		expect(sequential?.activationReason).toMatch(/per-server switch/i);
		expect(codebase).toMatchObject({ available: true, modelFit: { offer: true }, memoryFit: { offer: false } });
		expect(codebase?.activationReason).toMatch(/memory fit/i);
		expect(basic).toMatchObject({ globalEnabled: true, effectiveEnabled: true, active: true });
	});

	it("reports a missing sandbox image as unavailable even when the shipped catalog includes the binary", () => {
		const preview = buildSandboxMcpSettingsPreview({
			modelId: "qwen/qwen3-8b",
			containerMemoryLimitMb: 8192,
			sandboxImageAvailable: false,
			sandboxMcpServersEnabled: true,
			basicMemoryEnabled: true,
		});

		expect(preview.servers.every((server) => !server.available && !server.active)).toBe(true);
		expect(preview.servers[0]?.availabilityReason).toMatch(/image is unavailable/i);
	});

	it("makes project-master precedence and a missing model explicit", () => {
		const preview = buildSandboxMcpSettingsPreview({
			modelId: null,
			containerMemoryLimitMb: 8192,
			sandboxMcpServersEnabled: true,
			sandboxMcpServersEnabledOverride: false,
			basicMemoryEnabled: false,
		});

		expect(preview.effectiveMasterEnabled).toBe(false);
		expect(preview.servers.every((server) => !server.active)).toBe(true);
		expect(preview.servers.every((server) => server.modelFit.reason.includes("no model selected"))).toBe(true);
		expect(preview.servers[0]?.activationReason).toMatch(/master switch/i);
	});
});
