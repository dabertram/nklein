import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_CAP, type GateableTool, gateToolCatalog } from "../../src/core/tool-catalog-retrieval-gate";

function tool(name: string, description = "", useWhen = ""): GateableTool {
	return { name, description, useWhen };
}

/** A realistically over-tooled catalog — the 40+ case the research measured. */
const BIG_CATALOG: GateableTool[] = [
	tool("read_files", "Read file contents", "When you need to examine code"),
	tool("write_file", "Write a file", "When creating or replacing a file"),
	tool("apply_patch", "Apply a unified diff patch", "When editing existing code"),
	tool("run_commands", "Run a shell command", "When you need to build or test"),
	tool("submit_review", "Submit a review verdict", "When the review is complete"),
	tool("search_code", "Search the codebase", "When locating a symbol"),
	tool("list_dir", "List a directory", "When exploring structure"),
	tool("git_log", "Show commit history", "When you need history"),
	tool("send_email", "Send an email", "When notifying someone"),
	tool("book_flight", "Book a flight", "When travel is needed"),
	tool("resize_image", "Resize an image", "When editing media"),
	tool("query_database", "Query a SQL database", "When reading rows"),
];

describe("gateToolCatalog", () => {
	it("does not gate a catalog already at or under the cap", () => {
		const small = BIG_CATALOG.slice(0, 5);
		const result = gateToolCatalog({ tools: small, taskText: "anything", cap: DEFAULT_TOOL_CAP });
		expect(result.selected).toEqual(small);
		expect(result.dropped).toEqual([]);
	});

	it("cuts an over-tooled catalog to the cap", () => {
		const result = gateToolCatalog({
			tools: BIG_CATALOG,
			taskText: "Fix the failing test in the login module",
		});
		expect(result.selected).toHaveLength(DEFAULT_TOOL_CAP);
		expect(result.dropped.length).toBe(BIG_CATALOG.length - DEFAULT_TOOL_CAP);
	});

	it("ranks task-relevant tools above irrelevant ones", () => {
		const result = gateToolCatalog({
			tools: BIG_CATALOG,
			taskText: "Read the file and apply a patch to fix the failing test",
		});
		const names = result.selected.map((t) => t.name);
		expect(names).toContain("apply_patch");
		expect(names).toContain("read_files");
		// Travel/media tools share no vocabulary with a code task.
		expect(result.dropped).toContain("book_flight");
		expect(result.dropped).toContain("resize_image");
	});

	it("NEVER drops an always-keep tool — dropping the completion tool deadlocks the turn", () => {
		const result = gateToolCatalog({
			tools: BIG_CATALOG,
			// A task whose vocabulary has nothing to do with reviewing.
			taskText: "resize the image and book a flight",
			alwaysKeep: ["submit_review"],
		});
		expect(result.selected.map((t) => t.name)).toContain("submit_review");
	});

	it("lets the CAP yield when the always-keep set alone exceeds it", () => {
		// An oversized offer is survivable; a missing completion tool is not.
		const result = gateToolCatalog({
			tools: BIG_CATALOG,
			taskText: "unrelated",
			alwaysKeep: ["submit_review", "read_files", "write_file", "run_commands"],
			cap: 2,
		});
		const names = result.selected.map((t) => t.name);
		for (const keeper of ["submit_review", "read_files", "write_file", "run_commands"]) {
			expect(names).toContain(keeper);
		}
		expect(result.selected.length).toBeGreaterThan(2);
	});

	it("applies role affinity", () => {
		const reviewer = gateToolCatalog({
			tools: BIG_CATALOG,
			taskText: "assess this change",
			role: "reviewer",
		});
		expect(reviewer.selected.map((t) => t.name)).toContain("submit_review");
	});

	it("ADMITS when it cannot discriminate rather than faking a ranking", () => {
		const result = gateToolCatalog({ tools: BIG_CATALOG, taskText: "" });
		expect(result.arbitrary).toBe(true);
		expect(result.reason).toContain("DECLARATION ORDER");
		expect(result.reason).toContain("arbitrary");
	});

	it("reports arbitrary=false when relevance actually drove the order", () => {
		const result = gateToolCatalog({ tools: BIG_CATALOG, taskText: "apply a patch to the file" });
		expect(result.arbitrary).toBe(false);
	});

	it("is deterministic — a stable tool list keeps the prompt prefix cacheable (P19.2)", () => {
		const input = { tools: BIG_CATALOG, taskText: "run the tests and read the diff", role: "worker" as const };
		const first = gateToolCatalog(input);
		const second = gateToolCatalog(input);
		expect(first.selected.map((t) => t.name)).toEqual(second.selected.map((t) => t.name));
	});

	it("breaks ties by declaration order, not by sort implementation", () => {
		// All three share exactly the same vocabulary, so only declaration order can separate them.
		const tied = [
			tool("alpha", "same words here"),
			tool("beta", "same words here"),
			tool("gamma", "same words here"),
		];
		const result = gateToolCatalog({ tools: [...tied, ...BIG_CATALOG], taskText: "same words here", cap: 3 });
		expect(result.selected.map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
	});

	it("never throws on an empty catalog", () => {
		expect(() => gateToolCatalog({ tools: [], taskText: "x" })).not.toThrow();
		expect(gateToolCatalog({ tools: [], taskText: "x" }).selected).toEqual([]);
	});
});
