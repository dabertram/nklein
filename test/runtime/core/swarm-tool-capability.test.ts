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
		for (const name of ["web_search", "browse_url"]) {
			const manifest = swarmToolManifest(name);
			expect(manifest?.networkLevel).toBe("egress_read");
			expect(manifest?.mutationLevel).toBe("read");
		}
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
	it("taints the turn as web for the retrieval extras, nothing for local tools", () => {
		expect(swarmToolOutputTaint("web_search")).toEqual(["web"]);
		expect(swarmToolOutputTaint("browse_url")).toEqual(["web"]);
		expect(swarmToolOutputTaint("read_files")).toEqual([]);
		expect(swarmToolOutputTaint("write_file")).toEqual([]);
	});
});
