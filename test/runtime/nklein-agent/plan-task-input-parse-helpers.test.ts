import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	assertUsableDecomposeProjectInput,
	decomposeProjectFieldIsUsable,
	formatCompactSchemaIssues,
	recoverMissingTaskPrompts,
	recoverStringifiedDecomposeArrays,
	slugifyTaskId,
} from "../../../src/nklein-agent/decomposition/plan-task-input-parse";

describe("slugifyTaskId", () => {
	it("slugifies a normal string", () => {
		expect(slugifyTaskId("Build the Widget!")).toBe("build-the-widget");
	});

	it("falls back to 'task' when the input slugifies to empty", () => {
		expect(slugifyTaskId("")).toBe("task");
		expect(slugifyTaskId("   ")).toBe("task");
		expect(slugifyTaskId("!@#$%")).toBe("task");
	});
});

describe("decomposeProjectFieldIsUsable", () => {
	it("a non-blank string is usable; a blank/whitespace string is not", () => {
		expect(decomposeProjectFieldIsUsable("x")).toBe(true);
		expect(decomposeProjectFieldIsUsable("")).toBe(false);
		expect(decomposeProjectFieldIsUsable("   \n\t ")).toBe(false);
	});

	it("null/undefined are not usable; any other non-null value is", () => {
		expect(decomposeProjectFieldIsUsable(null)).toBe(false);
		expect(decomposeProjectFieldIsUsable(undefined)).toBe(false);
		expect(decomposeProjectFieldIsUsable(0)).toBe(true);
		expect(decomposeProjectFieldIsUsable(false)).toBe(true);
		expect(decomposeProjectFieldIsUsable([])).toBe(true);
		expect(decomposeProjectFieldIsUsable({})).toBe(true);
	});
});

describe("assertUsableDecomposeProjectInput", () => {
	const valid = { slug: "s", spec: "sp", plan: "pl", tasks: [{ id: "a", title: "A", prompt: "do a" }] };

	it("does not throw for a well-formed input (tasks as array OR string)", () => {
		expect(() => assertUsableDecomposeProjectInput(valid)).not.toThrow();
		expect(() => assertUsableDecomposeProjectInput({ ...valid, tasks: '[{"id":"a"}]' })).not.toThrow();
	});

	it("reports a NO-arguments call distinctly", () => {
		expect(() => assertUsableDecomposeProjectInput({})).toThrow(/called with no arguments/);
		expect(() => assertUsableDecomposeProjectInput(null)).toThrow(/called with no arguments/);
	});

	it("names the specific missing required fields", () => {
		// spec + plan missing; slug + tasks present.
		try {
			assertUsableDecomposeProjectInput({ slug: "s", tasks: [] });
			throw new Error("expected to throw");
		} catch (error) {
			const message = (error as Error).message;
			// Assert on the "missing required fields: <list>." segment specifically — the recovery hint that follows
			// mentions every field name (incl. slug), so we can't check the whole message.
			const missingList = message.match(/missing required fields: ([^.]+)\./)?.[1] ?? "";
			expect(missingList).toContain("spec");
			expect(missingList).toContain("plan");
			expect(missingList).not.toContain("slug"); // slug WAS present → not in the missing list
		}
	});

	it("treats tasks as missing when it is neither an array nor a string", () => {
		expect(() => assertUsableDecomposeProjectInput({ slug: "s", spec: "sp", plan: "pl", tasks: { a: 1 } })).toThrow(
			/tasks/,
		);
	});

	it("treats a blank-string required field as missing", () => {
		expect(() => assertUsableDecomposeProjectInput({ ...valid, spec: "   " })).toThrow(/spec/);
	});
});

describe("formatCompactSchemaIssues", () => {
	it("renders 'path: message' entries joined by '; ' within the limit", () => {
		const schema = z.object({ a: z.string(), b: z.number() });
		const result = schema.safeParse({ a: 1, b: "x" });
		expect(result.success).toBe(false);
		if (!result.success) {
			const text = formatCompactSchemaIssues(result.error);
			expect(text).toContain("a:");
			expect(text).toContain("b:");
			expect(text).toContain("; ");
			expect(text).not.toContain("more");
		}
	});

	it("caps at the limit and appends a '(+N more)' suffix", () => {
		const schema = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string() });
		const result = schema.safeParse({}); // 4 missing-field issues
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatCompactSchemaIssues(result.error, 2)).toMatch(/\(\+2 more\)$/);
		}
	});

	it("labels a root-level issue as '(root)'", () => {
		const result = z.string().safeParse(123);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(formatCompactSchemaIssues(result.error)).toMatch(/^\(root\):/);
		}
	});
});

describe("recoverMissingTaskPrompts (live-found 2026-07-08: a retry emitted tasks without prompt)", () => {
	it("derives a missing task prompt from description, then details, then title", () => {
		const recovered = recoverMissingTaskPrompts({
			tasks: [
				{ id: "t1", title: "Storage", description: "Build the storage layer." },
				{ id: "t2", title: "UI", details: "Add the habit list UI." },
				{ id: "t3", title: "Weekly summary view" },
			],
		}) as { tasks: Array<Record<string, unknown>> };
		expect(recovered.tasks[0]?.prompt).toBe("Build the storage layer.");
		expect(recovered.tasks[1]?.prompt).toBe("Add the habit list UI.");
		expect(recovered.tasks[2]?.prompt).toBe("Weekly summary view");
	});

	it("never overwrites a usable prompt and leaves non-recoverable/non-object input untouched", () => {
		const withPrompt = { tasks: [{ id: "t1", title: "X", prompt: "Do X.", description: "ignored" }] };
		expect((recoverMissingTaskPrompts(withPrompt) as typeof withPrompt).tasks[0]?.prompt).toBe("Do X.");
		const bare = { tasks: [{ id: "t1" }] };
		expect((recoverMissingTaskPrompts(bare) as typeof bare).tasks[0]).toEqual({ id: "t1" });
		expect(recoverMissingTaskPrompts(null)).toBeNull();
		expect(recoverMissingTaskPrompts({ tasks: "nope" })).toEqual({ tasks: "nope" });
	});
});

describe("§5.AK contract fields flow through the decompose input (schema advertisement + zod pass-through)", () => {
	it("the tool-facing JSON schema advertises every contract field the zod plan-task schema accepts", async () => {
		const { decomposeProjectTaskJsonSchema } = await import(
			"../../../src/nklein-agent/decomposition/plan-task-schemas"
		);
		const advertised = Object.keys(decomposeProjectTaskJsonSchema.properties);
		for (const field of [
			"preconditions",
			"inputs",
			"expectedOutputs",
			"acceptanceChecks",
			"nonGoals",
			"dependencyOutputsConsumed",
			"rollbackOrRepairHints",
			"downstreamInvalidationRules",
		]) {
			expect(advertised, `JSON schema must advertise ${field}`).toContain(field);
		}
	});
});

describe("recoverStringifiedDecomposeArrays (live-found sweep run 8: tasks emitted as a JSON string)", () => {
	it("JSON.parses a stringified tasks array back into a real array", () => {
		const recovered = recoverStringifiedDecomposeArrays({
			slug: "x",
			tasks: '[{"id":"card-1","title":"Cap","prompt":"clamp"}]',
		}) as { tasks: unknown };
		expect(Array.isArray(recovered.tasks)).toBe(true);
		expect(recovered.tasks).toEqual([{ id: "card-1", title: "Cap", prompt: "clamp" }]);
	});

	it("recovers stringified questions + expansions too", () => {
		const recovered = recoverStringifiedDecomposeArrays({
			questions: '[{"id":"q1","question":"?","status":"assumed-default"}]',
			expansions: '{"card-1":["a"]}',
		}) as { questions: unknown; expansions: unknown };
		expect(Array.isArray(recovered.questions)).toBe(true);
		expect(recovered.expansions).toEqual({ "card-1": ["a"] });
	});

	it("leaves a real array / object untouched (no-op)", () => {
		const input = { tasks: [{ id: "a" }], questions: [] };
		expect(recoverStringifiedDecomposeArrays(input)).toBe(input);
	});

	it("leaves an unparseable string untouched so schema validation can guide", () => {
		const input = { tasks: "[not valid json" };
		expect(recoverStringifiedDecomposeArrays(input)).toBe(input);
	});

	it("ignores a non-object input", () => {
		expect(recoverStringifiedDecomposeArrays(null)).toBeNull();
		expect(recoverStringifiedDecomposeArrays("nope")).toBe("nope");
	});
});
