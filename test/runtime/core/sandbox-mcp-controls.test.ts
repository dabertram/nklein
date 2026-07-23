import { describe, expect, it } from "vitest";
import {
	filterSandboxMcpServersByControl,
	normalizeSandboxMcpServerOverrides,
	resolveSandboxMcpControls,
} from "../../../src/core/sandbox-mcp-controls";

describe("sandbox MCP controls", () => {
	it("resolves explicit project false/true over the global master without changing server inheritance", () => {
		expect(
			resolveSandboxMcpControls({
				sandboxMcpServersEnabled: true,
				sandboxMcpServersEnabledOverride: false,
				basicMemoryEnabled: false,
			}),
		).toMatchObject({
			sandboxMcpServersEnabledOverride: false,
			effectiveSandboxMcpServersEnabled: false,
			effectiveSandboxMcpServerControls: {
				"sequential-thinking": true,
				"codebase-memory": true,
				"lsp-symbols": true,
				"basic-memory": false,
			},
		});
		expect(
			resolveSandboxMcpControls({
				sandboxMcpServersEnabled: false,
				sandboxMcpServersEnabledOverride: true,
				basicMemoryEnabled: false,
			}).effectiveSandboxMcpServersEnabled,
		).toBe(true);
	});

	it("merges sparse per-server overrides over global server defaults", () => {
		const resolved = resolveSandboxMcpControls({
			sandboxMcpServersEnabled: true,
			basicMemoryEnabled: true,
			sandboxMcpServerOverrides: { "codebase-memory": false, "basic-memory": false },
		});
		expect(resolved.effectiveSandboxMcpServerControls).toEqual({
			"sequential-thinking": true,
			"codebase-memory": false,
			"lsp-symbols": true,
			"basic-memory": false,
		});
	});

	it("rejects unknown/malformed override keys and withholds unknown catalog ids fail-closed", () => {
		expect(normalizeSandboxMcpServerOverrides({ unknown: true })).toBeNull();
		expect(normalizeSandboxMcpServerOverrides({ "codebase-memory": "yes" })).toBeNull();
		expect(
			filterSandboxMcpServersByControl([{ id: "sequential-thinking" }, { id: "unknown" }], {
				"sequential-thinking": true,
				"codebase-memory": true,
				"lsp-symbols": true,
				"basic-memory": false,
			}),
		).toEqual([{ id: "sequential-thinking" }]);
	});
});
