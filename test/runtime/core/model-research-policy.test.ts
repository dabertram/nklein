import { describe, expect, it } from "vitest";
import {
	assertModelResearchEgressAllowed,
	buildExactModelMatch,
	isPrimaryModelSourceUrl,
	resolvePrimaryModelSourcePolicy,
	validateModelResearchCitations,
} from "../../../src/core/model-research-policy";

/**
 * Coverage for the LAST of the seven modules the P20.3b ablation sweep found unexercised (2026-08-08).
 *
 * Three separate guards live here, and all three fail in the expensive direction if they are too permissive:
 * an egress gate protecting the local-only prime directive, a primary-SOURCE policy deciding what counts as
 * authoritative, and a citation validator that drops model-generated claims which do not cite admitted
 * evidence. The last is an anti-hallucination guard — its whole job is refusing an assertion nobody supported,
 * which is this session's recurring theme in yet another costume.
 */
describe("assertModelResearchEgressAllowed", () => {
	const open = { egressEnabled: true, searchBackendUrl: "http://localhost:8888", airGapped: false };

	it("passes only when ALL THREE gates are open", () => {
		expect(() => assertModelResearchEgressAllowed(open)).not.toThrow();
	});

	it("blocks on each gate INDEPENDENTLY — no single gate carries the decision", () => {
		// Tested one at a time from an otherwise-open state, so a guard that checks only the first condition
		// cannot pass by accident on a fixture where several are closed at once.
		expect(() => assertModelResearchEgressAllowed({ ...open, airGapped: true })).toThrow(/air-gap/i);
		expect(() => assertModelResearchEgressAllowed({ ...open, egressEnabled: false })).toThrow(/egress is disabled/i);
		expect(() => assertModelResearchEgressAllowed({ ...open, searchBackendUrl: null })).toThrow(/SearXNG/i);
	});

	it("gives AIR-GAP precedence, so the strongest posture names itself", () => {
		// With everything closed, the message must be the air-gap one: an operator who enabled air-gap should be
		// told that, not sent to flip an egress toggle that would still be refused.
		expect(() =>
			assertModelResearchEgressAllowed({ egressEnabled: false, searchBackendUrl: null, airGapped: true }),
		).toThrow(/air-gap/i);
	});

	it("treats a blank or whitespace backend URL as unconfigured", () => {
		// `""` and `"   "` are the shapes a half-filled settings field actually produces; a truthiness check alone
		// lets the whitespace case through to a fetch against nothing.
		expect(() => assertModelResearchEgressAllowed({ ...open, searchBackendUrl: "" })).toThrow(/SearXNG/i);
		expect(() => assertModelResearchEgressAllowed({ ...open, searchBackendUrl: "   " })).toThrow(/SearXNG/i);
	});

	it("requires egress to be exactly true, not merely truthy", () => {
		expect(() =>
			assertModelResearchEgressAllowed({ ...open, egressEnabled: undefined as unknown as boolean }),
		).toThrow(/egress is disabled/i);
	});
});

describe("resolvePrimaryModelSourcePolicy / isPrimaryModelSourceUrl", () => {
	it("derives a publisher policy from an owner-qualified model id", () => {
		const policy = resolvePrimaryModelSourcePolicy("someowner/some-model");
		expect(policy).not.toBeNull();
	});

	it("returns null for ids with no publisher to trust", () => {
		// No owner segment means there is no authoritative source to prefer, and inventing one would let any
		// page pass as primary.
		expect(resolvePrimaryModelSourcePolicy("bare-model-name")).toBeNull();
		expect(resolvePrimaryModelSourcePolicy("")).toBeNull();
	});

	it("never treats an LM Studio republish as the publisher", () => {
		// The re-hoster is not the primary source; accepting it would cite a mirror as authoritative.
		expect(resolvePrimaryModelSourcePolicy("lmstudio-community/some-model")).toBeNull();
		expect(resolvePrimaryModelSourcePolicy("LMStudio/other-model")).toBeNull();
	});

	it("accepts HTTPS only — an http source is not primary", () => {
		const policy = resolvePrimaryModelSourcePolicy("someowner/some-model");
		expect(policy).not.toBeNull();
		if (!policy) return;
		expect(isPrimaryModelSourceUrl("http://huggingface.co/someowner/some-model", policy)).toBe(false);
	});

	it("returns false for a malformed URL instead of throwing", () => {
		const policy = resolvePrimaryModelSourcePolicy("someowner/some-model");
		expect(policy).not.toBeNull();
		if (!policy) return;
		for (const raw of ["", "not a url", "://x"]) {
			expect(isPrimaryModelSourceUrl(raw, policy)).toBe(false);
		}
	});
});

describe("buildExactModelMatch", () => {
	it("anchors the pattern and escapes regex metacharacters in the id", () => {
		// Model ids contain dots and slashes; an unescaped `.` would make `qwen3.5` also match `qwen345`.
		expect(buildExactModelMatch("qwen/qwen3.5-14b")).toBe("^qwen/qwen3\\.5-14b$");
		expect(new RegExp(buildExactModelMatch("a.b")).test("axb")).toBe(false);
		expect(new RegExp(buildExactModelMatch("a.b")).test("a.b")).toBe(true);
	});
});

describe("validateModelResearchCitations", () => {
	const evidence = new Map([
		["e1", { id: "e1", url: "https://example.com/1" }],
		["e2", { id: "e2", url: "https://example.com/2" }],
	]);
	const cited = (value: string, sourceIds: string[]) => ({ value, sourceIds });
	const proposal = (over: Record<string, unknown> = {}) =>
		({
			toolUse: null,
			kind: null,
			chaining: null,
			structuredOutput: null,
			findings: [],
			unknowns: [],
			warnings: [],
			...over,
			// biome-ignore lint/suspicious/noExplicitAny: the raw proposal is model-shaped by construction.
		}) as any;

	it("keeps a field whose citations are all admitted evidence", () => {
		const result = validateModelResearchCitations(proposal({ toolUse: cited("native", ["e1"]) }), evidence, "m");
		expect(result.toolUse?.value).toBe("native");
		expect(result.toolUse?.sourceIds).toEqual(["e1"]);
	});

	it("DROPS a field citing an unknown id, and says why", () => {
		// The anti-hallucination case: a model inventing a source id must not have its claim survive silently.
		const result = validateModelResearchCitations(proposal({ toolUse: cited("native", ["ghost"]) }), evidence, "m");
		expect(result.toolUse).toBeNull();
		expect(result.warnings.join(" ")).toMatch(/toolUse was omitted/i);
	});

	it("DROPS a field entirely if ANY cited id is unknown, even alongside a valid one", () => {
		// The stricter and more interesting rule, and NOT the one I first assumed: a partially-hallucinated
		// citation list is discarded whole rather than salvaged down to its real sources. Keeping the good half
		// would present a claim as corroborated by evidence the model partly invented.
		const result = validateModelResearchCitations(proposal({ kind: cited("chat", ["e1", "ghost"]) }), evidence, "m");
		expect(result.kind).toBeNull();
		expect(result.warnings.join(" ")).toMatch(/kind was omitted/i);
	});

	it("ACCEPTS a repeated valid id — deduping to one real source is honest, not padding", () => {
		// Checked because the opposite seemed plausible: `[e1, e1]` looks like two sources. It dedupes to one
		// admitted source, and the claim genuinely has that one, so dropping it would discard real evidence.
		const result = validateModelResearchCitations(proposal({ kind: cited("chat", ["e1", "e1"]) }), evidence, "m");
		expect(result.kind?.sourceIds).toEqual(["e1"]);
	});

	it("drops a field with NO citations at all", () => {
		const result = validateModelResearchCitations(proposal({ chaining: cited("yes", []) }), evidence, "m");
		expect(result.chaining).toBeNull();
	});

	it("filters findings independently — one bad citation does not discard the good ones", () => {
		const result = validateModelResearchCitations(
			proposal({
				findings: [
					{ area: "tool_use", claim: "keeps", sourceIds: ["e1"] },
					{ area: "context", claim: "dropped", sourceIds: ["ghost"] },
				],
			}),
			evidence,
			"m",
		);
		expect(result.findings.map((finding) => finding.claim)).toEqual(["keeps"]);
		expect(result.warnings.join(" ")).toMatch(/context finding was omitted/i);
	});

	it("preserves warnings the model itself raised, alongside the ones validation adds", () => {
		// The model's own uncertainty is evidence too; dropping it while adding our own would hide a caveat the
		// researcher wrote down deliberately.
		const result = validateModelResearchCitations(
			proposal({ warnings: ["model said it was unsure"], toolUse: cited("native", ["ghost"]) }),
			evidence,
			"m",
		);
		expect(result.warnings.join(" ")).toMatch(/model said it was unsure/);
		expect(result.warnings.join(" ")).toMatch(/omitted/);
	});

	it("yields an all-null proposal when the evidence map is EMPTY — nothing is admitted", () => {
		// The degenerate case that must not turn into "accept everything": with no admitted evidence, every
		// cited claim is uncorroborated.
		const result = validateModelResearchCitations(
			proposal({ toolUse: cited("native", ["e1"]), findings: [{ area: "a", claim: "c", sourceIds: ["e1"] }] }),
			new Map(),
			"m",
		);
		expect(result.toolUse).toBeNull();
		expect(result.findings).toEqual([]);
	});
});
