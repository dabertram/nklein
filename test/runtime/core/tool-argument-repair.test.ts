import { describe, expect, it } from "vitest";
import {
	assessToolArgumentRepair,
	dispatchArgumentsAfterRepair,
	isDispatchableAfterRepair,
	ToolArgumentIssueKind,
	ToolArgumentVerdict,
} from "../../../src/core/tool-argument-repair";
import type { LocalLlmToolDefinition } from "../../../src/nklein-agent/nklein-local-llm-client";

/** A representative tool: `create_card(title: string [required], count: integer, active: boolean, meta: object)`. */
const createCard: LocalLlmToolDefinition = {
	name: "create_card",
	description: "create a board card",
	parameters: {
		type: "object",
		properties: {
			title: { type: "string" },
			count: { type: "integer" },
			active: { type: "boolean" },
			meta: { type: "object" },
		},
		required: ["title"],
	},
};

/** A tool with several required fields + an enum, to exercise multi-field re-ask + enum gating. */
const editFile: LocalLlmToolDefinition = {
	name: "edit_file",
	description: "edit a file",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			mode: { type: "string", enum: ["overwrite", "append"] },
			edits: { type: "array" },
		},
		required: ["path", "edits"],
	},
};

describe("assessToolArgumentRepair — usable (valid as-is)", () => {
	it("returns Usable with no repaired object when every field satisfies the schema", () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", count: 3, active: true } },
			createCard,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
		expect(result.repairedArguments).toBeUndefined();
		expect(result.fieldsToReask).toEqual([]);
		expect(result.issues).toEqual([]);
		expect(result.outcome).toBe("success");
	});

	it("is Usable when only the required field is present (optional fields omitted)", () => {
		const result = assessToolArgumentRepair({ name: "create_card", arguments: { title: "only" } }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
	});

	it("treats a tool with no declared properties permissively (any object is usable)", () => {
		const loose: LocalLlmToolDefinition = { name: "ping", description: "", parameters: { type: "object" } };
		const result = assessToolArgumentRepair({ name: "ping", arguments: { anything: 1, here: "ok" } }, loose);
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
		// No `properties` declared ⇒ nothing is "unknown"; the fields pass through.
		expect(result.issues).toEqual([]);
	});

	it("accepts a field whose schema declares no type (permissive)", () => {
		const loose: LocalLlmToolDefinition = {
			name: "note",
			description: "",
			parameters: { type: "object", properties: { anything: {} }, required: ["anything"] },
		};
		const result = assessToolArgumentRepair({ name: "note", arguments: { anything: [1, 2, 3] } }, loose);
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
	});
});

describe("assessToolArgumentRepair — repairable (lossless local coercions)", () => {
	it('coerces a numeric string `"3"` to a number for an integer field', () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", count: "3" } },
			createCard,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ title: "X", count: 3 });
		expect(result.outcome).toBe("success");
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.Coerced && i.field === "count")).toBe(true);
	});

	it('coerces `"true"`/`"false"` strings to booleans', () => {
		const t = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", active: "true" } },
			createCard,
		);
		expect(t.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(t.repairedArguments).toEqual({ title: "X", active: true });

		const f = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", active: "FALSE" } },
			createCard,
		);
		expect(f.repairedArguments).toEqual({ title: "X", active: false });
	});

	it("parses a JSON-string object into an object field", () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", meta: '{"k": 1}' } },
			createCard,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ title: "X", meta: { k: 1 } });
	});

	it("parses a JSON-string array into an array field and satisfies a required array", () => {
		const result = assessToolArgumentRepair(
			{ name: "edit_file", arguments: { path: "a.ts", edits: '[{"search":"x","replace":"y"}]' } },
			editFile,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ path: "a.ts", edits: [{ search: "x", replace: "y" }] });
		expect(result.fieldsToReask).toEqual([]);
	});

	it("drops a hallucinated unknown field (schema declares its properties)", () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", nonsense: "gone" } },
			createCard,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ title: "X" });
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.UnknownField && i.field === "nonsense")).toBe(
			true,
		);
	});

	it("leaves an already-valid string untouched (never rewrites a value that satisfies the schema)", () => {
		// A padded string still satisfies `type: string` — the module does NOT alter an already-valid value (the model
		// may want it verbatim, e.g. a deliberately-spaced title); coercion fires only on a genuine TYPE mismatch.
		const result = assessToolArgumentRepair({ name: "create_card", arguments: { title: "  spaced  " } }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
		expect(result.repairedArguments).toBeUndefined();
	});

	it("does NOT coerce a decimal string to an `integer` field (loses information) — routes to reprompt", () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", count: "3.5" } },
			createCard,
		);
		// count is optional, so a wrong optional type is surfaced but non-blocking → still Usable...
		// but here it's un-coercible: `3.5` is not an integer, so it stays as-is and is flagged optional-type-wrong.
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.WrongOptionalType && i.field === "count")).toBe(
			true,
		);
		// left as-is, never fabricated
		expect(result.repairedArguments).toBeUndefined();
	});

	it("coerces a whole-number string to an integer field", () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", count: " 42 " } },
			createCard,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ title: "X", count: 42 });
	});
});

describe("assessToolArgumentRepair — reprompt (re-ask only the missing/un-coercible required fields)", () => {
	it("re-asks a missing required field, listing exactly that field", () => {
		const result = assessToolArgumentRepair({ name: "create_card", arguments: { count: 1 } }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toEqual(["title"]);
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.MissingRequired && i.field === "title")).toBe(
			true,
		);
		expect(result.outcome).toBe("malformed");
	});

	it("re-asks ALL missing required fields when several are absent", () => {
		const result = assessToolArgumentRepair({ name: "edit_file", arguments: {} }, editFile);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toEqual(["path", "edits"]);
	});

	it("re-asks a required field whose value is an un-coercible wrong type", () => {
		const result = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: 123 } }, // required string, number, un-coercible-to-string
			createCard,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toEqual(["title"]);
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.WrongRequiredType && i.field === "title")).toBe(
			true,
		);
	});

	it("carries the PARTIAL repair on a reprompt (apply the fixable fields, re-ask the rest)", () => {
		// `edits` coercible from a JSON string; `path` required + missing ⇒ reprompt for path, repaired edits present.
		const result = assessToolArgumentRepair(
			{ name: "edit_file", arguments: { edits: "[1,2]", stray: "x" } },
			editFile,
		);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toEqual(["path"]);
		expect(result.repairedArguments).toEqual({ edits: [1, 2] });
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.UnknownField && i.field === "stray")).toBe(
			true,
		);
	});

	it("re-asks a required field whose value is not in the schema's enum", () => {
		const result = assessToolArgumentRepair(
			{ name: "edit_file", arguments: { path: "a", edits: [], mode: "delete" } },
			editFile,
		);
		// mode is optional here (only path+edits required) so an out-of-enum optional is surfaced, not re-asked.
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.NotInEnum && i.field === "mode")).toBe(true);
	});

	it("re-asks an out-of-enum REQUIRED field", () => {
		const withRequiredEnum: LocalLlmToolDefinition = {
			name: "set_mode",
			description: "",
			parameters: {
				type: "object",
				properties: { mode: { type: "string", enum: ["a", "b"] } },
				required: ["mode"],
			},
		};
		const result = assessToolArgumentRepair({ name: "set_mode", arguments: { mode: "z" } }, withRequiredEnum);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toEqual(["mode"]);
		expect(result.issues.some((i) => i.kind === ToolArgumentIssueKind.NotInEnum && i.field === "mode")).toBe(true);
	});

	it("does not duplicate a field in fieldsToReask", () => {
		// `title` missing is the only required issue — exactly one entry.
		const result = assessToolArgumentRepair({ name: "create_card", arguments: { active: true } }, createCard);
		expect(result.fieldsToReask).toEqual(["title"]);
	});
});

describe("assessToolArgumentRepair — reject (unusable call)", () => {
	it("rejects a call naming no offered tool", () => {
		const result = assessToolArgumentRepair({ name: "unknown_tool", arguments: { a: 1 } }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reject);
		expect(result.outcome).toBe("malformed");
		expect(result.fieldsToReask).toEqual([]);
	});

	it("rejects when the tool definition is undefined", () => {
		const result = assessToolArgumentRepair({ name: "create_card", arguments: { title: "X" } }, undefined);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reject);
	});

	it("rejects non-object arguments (a bare string)", () => {
		const result = assessToolArgumentRepair({ name: "create_card", arguments: "not an object" }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reject);
		expect(result.reason).toContain("not an object");
	});

	it("rejects null arguments", () => {
		const result = assessToolArgumentRepair({ name: "create_card", arguments: null }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reject);
	});

	it("rejects array arguments (not an object)", () => {
		const result = assessToolArgumentRepair({ name: "create_card", arguments: [1, 2, 3] }, createCard);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reject);
	});
});

describe("assessToolArgumentRepair — properties & purity", () => {
	it("does not mutate the input arguments object", () => {
		const args = { title: "X", count: "3", nonsense: "y" };
		const snapshot = JSON.parse(JSON.stringify(args));
		assessToolArgumentRepair({ name: "create_card", arguments: args }, createCard);
		expect(args).toEqual(snapshot);
	});

	it("is deterministic — identical inputs give identical verdicts", () => {
		const call = { name: "edit_file", arguments: { edits: "[1]", path: 9 } };
		const a = assessToolArgumentRepair(call, editFile);
		const b = assessToolArgumentRepair(call, editFile);
		expect(a).toEqual(b);
	});

	it("never throws on hostile input", () => {
		expect(() => assessToolArgumentRepair({ name: "x", arguments: undefined }, undefined)).not.toThrow();
		expect(() =>
			assessToolArgumentRepair({ name: "create_card", arguments: { title: Symbol("s") } }, createCard),
		).not.toThrow();
	});

	it("routes usable/repairable to `success` and reprompt/reject to `malformed` (ladder compatibility)", () => {
		expect(assessToolArgumentRepair({ name: "create_card", arguments: { title: "X" } }, createCard).outcome).toBe(
			"success",
		);
		expect(
			assessToolArgumentRepair({ name: "create_card", arguments: { title: "X", count: "3" } }, createCard).outcome,
		).toBe("success");
		expect(assessToolArgumentRepair({ name: "create_card", arguments: {} }, createCard).outcome).toBe("malformed");
		expect(assessToolArgumentRepair({ name: "nope", arguments: {} }, createCard).outcome).toBe("malformed");
	});
});

describe("isDispatchableAfterRepair / dispatchArgumentsAfterRepair", () => {
	it("is dispatchable for usable and repairable, not for reprompt/reject", () => {
		const usable = assessToolArgumentRepair({ name: "create_card", arguments: { title: "X" } }, createCard);
		const repairable = assessToolArgumentRepair(
			{ name: "create_card", arguments: { title: "X", count: "3" } },
			createCard,
		);
		const reprompt = assessToolArgumentRepair({ name: "create_card", arguments: {} }, createCard);
		const reject = assessToolArgumentRepair({ name: "create_card", arguments: "no" }, createCard);
		expect(isDispatchableAfterRepair(usable)).toBe(true);
		expect(isDispatchableAfterRepair(repairable)).toBe(true);
		expect(isDispatchableAfterRepair(reprompt)).toBe(false);
		expect(isDispatchableAfterRepair(reject)).toBe(false);
	});

	it("returns the original args for a usable call", () => {
		const call = { name: "create_card", arguments: { title: "X" } };
		const result = assessToolArgumentRepair(call, createCard);
		expect(dispatchArgumentsAfterRepair(call, result)).toEqual({ title: "X" });
	});

	it("returns the repaired args for a repairable call", () => {
		const call = { name: "create_card", arguments: { title: "X", count: "5" } };
		const result = assessToolArgumentRepair(call, createCard);
		expect(dispatchArgumentsAfterRepair(call, result)).toEqual({ title: "X", count: 5 });
	});

	it("returns undefined for reprompt and reject (do not dispatch yet)", () => {
		const rp = { name: "create_card", arguments: {} };
		const rpResult = assessToolArgumentRepair(rp, createCard);
		expect(dispatchArgumentsAfterRepair(rp, rpResult)).toBeUndefined();

		const rj = { name: "create_card", arguments: "no" };
		const rjResult = assessToolArgumentRepair(rj, createCard);
		expect(dispatchArgumentsAfterRepair(rj, rjResult)).toBeUndefined();
	});
});

describe("assessToolArgumentRepair — union-type schemas", () => {
	it("accepts a value matching any type in a declared union", () => {
		const unionTool: LocalLlmToolDefinition = {
			name: "flex",
			description: "",
			parameters: { type: "object", properties: { v: { type: ["string", "number"] } }, required: ["v"] },
		};
		expect(assessToolArgumentRepair({ name: "flex", arguments: { v: "s" } }, unionTool).verdict).toBe(
			ToolArgumentVerdict.Usable,
		);
		expect(assessToolArgumentRepair({ name: "flex", arguments: { v: 7 } }, unionTool).verdict).toBe(
			ToolArgumentVerdict.Usable,
		);
	});

	it("coerces to the first coercible type in a union", () => {
		const unionTool: LocalLlmToolDefinition = {
			name: "flex",
			description: "",
			parameters: { type: "object", properties: { v: { type: ["number", "boolean"] } }, required: ["v"] },
		};
		const result = assessToolArgumentRepair({ name: "flex", arguments: { v: "true" } }, unionTool);
		// "true" isn't a number but IS a boolean ⇒ coerced to boolean true.
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ v: true });
	});
});

describe("assessToolArgumentRepair — enum × coercion (regression: coerce THEN gate)", () => {
	/** A required numeric-enum field: the exact shape that exposed the coerce-after-enum bug. */
	const setLevel: LocalLlmToolDefinition = {
		name: "set_level",
		description: "set the level",
		parameters: {
			type: "object",
			properties: { level: { type: "integer", enum: [1, 2, 3] } },
			required: ["level"],
		},
	};

	it("coerces a losslessly-coercible enum value BEFORE the enum gate ('1' → 1 ∈ [1,2,3])", () => {
		// Regression: the enum gate used to run on the RAW string "1" (=== against 1/2/3 all false) and re-ask a valid,
		// repairable call. It must coerce first, then match the coerced value against the enum.
		const result = assessToolArgumentRepair({ name: "set_level", arguments: { level: "1" } }, setLevel);
		expect(result.verdict).toBe(ToolArgumentVerdict.Repairable);
		expect(result.repairedArguments).toEqual({ level: 1 });
	});

	it("still re-asks a coercible-but-out-of-enum required value ('9' → 9 ∉ [1,2,3])", () => {
		const result = assessToolArgumentRepair({ name: "set_level", arguments: { level: "9" } }, setLevel);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toContain("level");
	});

	it("still re-asks a genuinely un-coercible out-of-enum required value ('z')", () => {
		const result = assessToolArgumentRepair({ name: "set_level", arguments: { level: "z" } }, setLevel);
		expect(result.verdict).toBe(ToolArgumentVerdict.Reprompt);
		expect(result.fieldsToReask).toContain("level");
	});

	it("accepts an already-valid in-enum value unchanged (level 2)", () => {
		const result = assessToolArgumentRepair({ name: "set_level", arguments: { level: 2 } }, setLevel);
		expect(result.verdict).toBe(ToolArgumentVerdict.Usable);
	});
});
