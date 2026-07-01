import { describe, expect, it } from "vitest";
import type { LoadedModelDescriptor } from "../../../src/core/lmstudio-loaded-model-descriptors";
import {
	catalogCapabilityPrior,
	resolveLoadedModelProfile,
} from "../../../src/nklein-agent/nklein-loaded-model-profile";

function descriptor(input: Partial<LoadedModelDescriptor> & { modelKey: string }): LoadedModelDescriptor {
	return { runtimeId: input.modelKey, isEmbedding: false, ...input };
}

describe("resolveLoadedModelProfile", () => {
	it("short-circuits an embedding model (not an agentic candidate)", () => {
		const profile = resolveLoadedModelProfile(descriptor({ modelKey: "nomic-embed", isEmbedding: true }));
		expect(profile).toEqual({ isEmbedding: true });
	});

	// Fabricated, uncatalogued names ⇒ catalog kind is null, so the tags come PURELY from the descriptor facts +
	// name heuristics (deterministic regardless of the live §5.AL catalog contents).
	it("tags an uncatalogued tool-trained coder from its card facts", () => {
		const profile = resolveLoadedModelProfile(descriptor({ modelKey: "zzz-custom-coder-9b", toolUse: true }));
		expect(new Set(profile.affinityTags)).toEqual(new Set(["instruct", "code", "agentic"]));
		expect(profile.capabilityPrior).toBeNull(); // uncatalogued ⇒ no prior
		expect(profile.isEmbedding).toBe(false);
	});

	it("tags an opus-named non-coder as a reasoner even without a reasoning flag (heuristic)", () => {
		const profile = resolveLoadedModelProfile(descriptor({ modelKey: "zzz-qwopus-27b", toolUse: true }));
		expect(new Set(profile.affinityTags)).toEqual(new Set(["instruct", "reasoning", "agentic"]));
	});

	it("does NOT apply the opus reasoner heuristic to an opus CODER (coder wins)", () => {
		const profile = resolveLoadedModelProfile(descriptor({ modelKey: "zzz-qwopus-9b-coder", toolUse: true }));
		expect(profile.affinityTags).not.toContain("reasoning");
		expect(profile.affinityTags).toContain("code");
	});

	it("honors an explicit reasoning capability flag regardless of name", () => {
		const profile = resolveLoadedModelProfile(
			descriptor({ modelKey: "zzz-plain-8b", toolUse: true, reasoning: true }),
		);
		expect(profile.affinityTags).toContain("reasoning");
	});

	it("gives a plain tool-trained general model just the generic + agentic lanes", () => {
		const profile = resolveLoadedModelProfile(descriptor({ modelKey: "zzz-general-8b", toolUse: true }));
		expect(new Set(profile.affinityTags)).toEqual(new Set(["instruct", "agentic"]));
	});

	it("fuses the §5.AL catalog: a KNOWN coder gets code/agentic tags + a numeric prior", () => {
		// qwen2.5-coder is catalogued as kind=code — the catalog reinforces `agentic` even though its card reports
		// trained_for_tool_use:false, and supplies a numeric cold-start prior.
		const profile = resolveLoadedModelProfile(descriptor({ modelKey: "qwen/qwen2.5-coder-14b", toolUse: false }));
		expect(profile.affinityTags).toContain("code");
		expect(profile.affinityTags).toContain("agentic");
		expect(typeof profile.capabilityPrior).toBe("number");
	});
});

describe("catalogCapabilityPrior", () => {
	it("is null for an uncatalogued model and a number for a known one", () => {
		expect(catalogCapabilityPrior("zzz-not-a-real-model-xyz")).toBeNull();
		expect(typeof catalogCapabilityPrior("qwen/qwen2.5-coder-14b")).toBe("number");
	});
});
