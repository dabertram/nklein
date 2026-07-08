import { describe, expect, it } from "vitest";
import { decideCapabilityBrokerGate } from "../../../src/core/capability-broker-gate";
import { swarmToolManifest, swarmToolOutputTaint } from "../../../src/core/swarm-tool-capability";

describe("swarmToolManifest", () => {
	it("resolves the base kanban file tools to their declared manifests", () => {
		expect(swarmToolManifest("read_files")?.mutationLevel).toBe("read");
		expect(swarmToolManifest("write_file")?.mutationLevel).toBe("sandbox_write");
		expect(swarmToolManifest("apply_patch")?.mutationLevel).toBe("sandbox_write");
	});

	it("resolves the egress retrieval extras to the read-only egress manifest", () => {
		for (const name of ["web_search", "browse_url", "fetch_web_content"]) {
			const manifest = swarmToolManifest(name);
			expect(manifest?.networkLevel).toBe("egress_read");
			expect(manifest?.mutationLevel).toBe("read");
		}
	});

	it("resolves swarm SDK aliases without changing the base kanban policy map", () => {
		expect(swarmToolManifest("repo_map")?.mutationLevel).toBe("read");
		expect(swarmToolManifest("search_code")?.mutationLevel).toBe("read");
		expect(swarmToolManifest("search_codebase")?.mutationLevel).toBe("read");
		expect(swarmToolManifest("run_commands")?.mutationLevel).toBe("sandbox_write");
		expect(swarmToolManifest("edit_file")?.mutationLevel).toBe("sandbox_write");
	});

	it("returns null for an unknown tool (broker leaves it ungated)", () => {
		expect(swarmToolManifest("totally_unknown_tool")).toBeNull();
	});

	it("no swarm tool touches a broker-protected sink today (sandboxed + read-only egress ⇒ gate inert)", () => {
		for (const name of ["read_files", "write_file", "apply_patch", "web_search", "browse_url"]) {
			const manifest = swarmToolManifest(name);
			expect(manifest).not.toBeNull();
			// Even with untrusted web taint present, none of these are refused (none is a protected sink).
			expect(decideCapabilityBrokerGate({ manifest: manifest as never, taintLabels: ["web"] }).allow).toBe(true);
		}
	});
});

describe("swarmToolOutputTaint", () => {
	it("taints the turn as web for the retrieval extras", () => {
		expect(swarmToolOutputTaint("web_search")).toEqual(["web"]);
		expect(swarmToolOutputTaint("browse_url")).toEqual(["web"]);
		expect(swarmToolOutputTaint("fetch_web_content")).toEqual(["web"]);
	});

	it("taints repository admit-point outputs as repo instructions", () => {
		expect(swarmToolOutputTaint("repo_map")).toEqual(["repo_instruction"]);
		expect(swarmToolOutputTaint("search_code")).toEqual(["repo_instruction"]);
		expect(swarmToolOutputTaint("search_codebase")).toEqual(["repo_instruction"]);
		expect(swarmToolOutputTaint("read_files")).toEqual(["repo_instruction"]);
	});

	it("adds secret_like when admitted content looks credential-shaped", () => {
		expect(swarmToolOutputTaint("web_search", "token = 'ghp_0123456789abcdefghijABCDEFGHIJ'")).toEqual([
			"web",
			"secret_like",
		]);
		expect(swarmToolOutputTaint("read_files", "api_key=AbCdEf0123456789AbCdEf0123456789")).toEqual([
			"repo_instruction",
			"secret_like",
		]);
	});

	it("labels exact MCP bundle tool names as mcp and scans their output", () => {
		expect(
			swarmToolOutputTaint("codebase_memory__search", "password: hunter2hunter2hunter2hunter2extra", {
				mcpToolNames: new Set(["codebase_memory__search"]),
			}),
		).toEqual(["mcp", "secret_like"]);
	});

	it("does not taint sandbox write/status outputs by default", () => {
		expect(swarmToolOutputTaint("write_file")).toEqual([]);
		expect(swarmToolOutputTaint("run_commands", "test output")).toEqual([]);
	});
});
