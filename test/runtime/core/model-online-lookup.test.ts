import { describe, expect, it } from "vitest";
import { buildModelInvestigationPrompt, parseModelInvestigationResult } from "../../../src/core/model-online-lookup";

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
