import { describe, expect, it } from "vitest";
import {
	buildModelInvestigationPrompt,
	buildProvisionalCatalogEntry,
	deriveModelFamily,
	parseModelInvestigationResult,
} from "../../../src/core/model-online-lookup";

describe("model-online-lookup: prompt", () => {
	it("names the model + asks for the JSON verdict shape with every bucket", () => {
		const prompt = buildModelInvestigationPrompt("google/gemma-4-e2b");
		expect(prompt).toContain("google/gemma-4-e2b");
		expect(prompt).toMatch(/"toolUse"/);
		for (const bucket of ["TOOL_NATIVE", "TOOL_CAPABLE", "TOOL_WEAK", "TOOL_UNSUITABLE", "UNKNOWN"]) {
			expect(prompt).toContain(bucket);
		}
		expect(prompt).toMatch(/do not invent sources/i);
	});
});

describe("model-online-lookup: parse", () => {
	it("parses a clean JSON verdict (toolUse + summary + sources)", () => {
		const res = parseModelInvestigationResult(
			'{"toolUse":"TOOL_NATIVE","summary":"Trained for function calling.","sources":["https://hf.co/x"]}',
		);
		expect(res.succeeded).toBe(true);
		expect(res.toolUse).toBe("TOOL_NATIVE");
		expect(res.summary).toBe("Trained for function calling.");
		expect(res.sources).toEqual(["https://hf.co/x"]);
	});

	it("tolerates surrounding prose / markdown fences and picks the LAST verdict object", () => {
		const reply = [
			"Let me look this up.",
			'Here is my draft: {"toolUse":"UNKNOWN"}',
			"```json",
			'{"toolUse":"tool_weak","summary":"Leaks calls into text.","sources":["http://a","http://a","not-a-url"]}',
			"```",
			"Done.",
		].join("\n");
		const res = parseModelInvestigationResult(reply);
		expect(res.toolUse).toBe("TOOL_WEAK"); // case-insensitive, last object wins
		expect(res.sources).toEqual(["http://a"]); // deduped + non-url dropped
	});

	it("fails (succeeded=false, UNKNOWN) on empty output — itself a signal", () => {
		const res = parseModelInvestigationResult("   ");
		expect(res.succeeded).toBe(false);
		expect(res.toolUse).toBe("UNKNOWN");
		expect(res.summary).toMatch(/no output/i);
	});

	it("fails when no parseable verdict is present (pure prose, or a bad bucket)", () => {
		expect(parseModelInvestigationResult("I think it's pretty good at tools!").succeeded).toBe(false);
		expect(parseModelInvestigationResult('{"toolUse":"DEFINITELY_GREAT"}').succeeded).toBe(false);
	});

	it("drops fabricated/relative sources and missing summary", () => {
		const res = parseModelInvestigationResult(
			'{"toolUse":"TOOL_CAPABLE","sources":["/local","ftp://x","https://ok.co/a"]}',
		);
		expect(res.succeeded).toBe(true);
		expect(res.summary).toBe("");
		expect(res.sources).toEqual(["https://ok.co/a"]);
	});
});

describe("model-online-lookup: deriveModelFamily", () => {
	it("strips the provider prefix and GENERIC quant/format suffixes", () => {
		expect(deriveModelFamily("qwen/qwen3-8b@4bit")).toBe("qwen3-8b");
		expect(deriveModelFamily("phi-4-mini-instruct@8bit")).toBe("phi-4-mini-instruct");
		expect(deriveModelFamily("SomeVendor/Cool-Model-Q8")).toBe("cool-model");
		// The STABLE publisher key is already clean, so it survives intact as the family.
		expect(deriveModelFamily("qwen3.5-9b-mtp")).toBe("qwen3.5-9b-mtp");
	});

	it("does NOT hardcode unstable LM Studio machine/instance suffixes (David 2026-07-06)", () => {
		// A user-chosen machine suffix on the RUNTIME id is left alone — we can't know it's a machine name, and it can
		// change any time. The correct input is the stable publisher key (which never carries such a suffix).
		expect(deriveModelFamily("google/gemma-4-e2b-m5max")).toBe("gemma-4-e2b-m5max");
	});
});

describe("model-online-lookup: buildProvisionalCatalogEntry", () => {
	it("builds a verified:false, basis:research provisional entry from a successful lookup", () => {
		const entry = buildProvisionalCatalogEntry("acme/new-coder-7b@4bit", {
			succeeded: true,
			toolUse: "TOOL_CAPABLE",
			summary: "Trained for function calling per its card.",
			sources: ["https://hf.co/acme/new-coder-7b"],
		});
		expect(entry).not.toBeNull();
		expect(entry?.family).toBe("new-coder-7b");
		expect(entry?.matchSource).toBe("new-coder-7b"); // hyphens need no escaping outside a char-class
		expect(entry?.toolUse).toBe("TOOL_CAPABLE");
		expect(entry?.basis).toBe("research");
		expect(entry?.verified).toBe(false);
		expect(entry?.note).toMatch(/PROVISIONAL/);
		expect(entry?.note).toMatch(/confirm against a live sweep/i);
		expect(entry?.sources).toEqual(["https://hf.co/acme/new-coder-7b"]);
	});

	it("derives the family from the STABLE model key when given one (a machine-suffixed runtime id still yields the right family)", () => {
		const entry = buildProvisionalCatalogEntry(
			"acme/new-coder-7b-gpu-rig", // the unstable runtime id (user-chosen machine suffix)
			{ succeeded: true, toolUse: "TOOL_CAPABLE", summary: "ok", sources: [] },
			{ modelKey: "acme/new-coder-7b" }, // the stable publisher key
		);
		expect(entry?.family).toBe("new-coder-7b"); // from the stable key, NOT the "-gpu-rig" runtime suffix
		expect(entry?.note).toContain("new-coder-7b");
		expect(entry?.note).not.toContain("gpu-rig"); // the note references the stable name, not the runtime id
	});

	it("returns null for a failed lookup or an UNKNOWN verdict (nothing trustworthy to propose)", () => {
		expect(
			buildProvisionalCatalogEntry("x/y", { succeeded: false, toolUse: "UNKNOWN", summary: "", sources: [] }),
		).toBeNull();
		expect(
			buildProvisionalCatalogEntry("x/y", {
				succeeded: true,
				toolUse: "UNKNOWN",
				summary: "no evidence",
				sources: [],
			}),
		).toBeNull();
	});
});
