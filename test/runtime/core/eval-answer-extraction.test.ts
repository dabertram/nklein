import { describe, expect, it } from "vitest";
import {
	extractDecomposeEvalAnswer,
	extractDecomposeGraph,
	extractJsonFromModelText,
	extractReviewCaught,
	extractReviewEvalAnswer,
} from "../../../src/core/eval-answer-extraction";
import { scoreEvalAnswer } from "../../../src/core/eval-prompt-corpus";

describe("extractJsonFromModelText", () => {
	it("parses raw JSON directly", () => {
		expect(extractJsonFromModelText('{"a":1}')).toEqual({ a: 1 });
	});

	it("strips a ```json code fence", () => {
		expect(extractJsonFromModelText('Here you go:\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
	});

	it("lifts the first balanced object out of surrounding prose", () => {
		expect(extractJsonFromModelText('Sure! {"a":1,"b":[2,3]} hope that helps')).toEqual({ a: 1, b: [2, 3] });
	});

	it("is string-literal aware (braces inside strings don't unbalance)", () => {
		expect(extractJsonFromModelText('{"text":"a } b { c"}')).toEqual({ text: "a } b { c" });
	});

	it("returns null on unparseable / empty input", () => {
		expect(extractJsonFromModelText("no json here")).toBeNull();
		expect(extractJsonFromModelText("")).toBeNull();
		expect(extractJsonFromModelText("{ not valid")).toBeNull();
	});
});

describe("extractDecomposeGraph", () => {
	it("builds nodes + dependency edges from a {tasks:[...]} object", () => {
		const graph = extractDecomposeGraph(
			'{"tasks":[{"id":"a"},{"id":"b","dependsOn":["a"]},{"id":"c","dependsOn":["a","b"]}]}',
		);
		expect(graph?.nodes).toEqual(["a", "b", "c"]);
		expect(graph?.edges).toContainEqual({ from: "a", to: "b" });
		expect(graph?.edges).toContainEqual({ from: "b", to: "c" });
		expect(graph?.edges).toHaveLength(3);
	});

	it("accepts the {steps:[...]} shape and `deps` alias", () => {
		const graph = extractDecomposeGraph('{"steps":[{"id":"x"},{"id":"y","deps":["x"]}]}');
		expect(graph?.nodes).toEqual(["x", "y"]);
		expect(graph?.edges).toEqual([{ from: "x", to: "y" }]);
	});

	it("accepts a bare array and synthesizes ids when missing", () => {
		const graph = extractDecomposeGraph('[{"title":"first"},{"title":"second"}]');
		expect(graph?.nodes).toEqual(["first", "second"]);
	});

	it("drops an edge to an UNKNOWN dependency id (under-specified ≠ invalid DAG)", () => {
		const graph = extractDecomposeGraph('{"tasks":[{"id":"a","dependsOn":["ghost"]},{"id":"b"}]}');
		expect(graph?.nodes).toEqual(["a", "b"]);
		expect(graph?.edges).toEqual([]); // "ghost" isn't a node → dropped, not a dangling edge
	});

	it("returns null when there is no task list", () => {
		expect(extractDecomposeGraph('{"summary":"no tasks here"}')).toBeNull();
		expect(extractDecomposeGraph("garbage")).toBeNull();
	});

	it("end-to-end: an extracted VALID DAG scores 1 via scoreEvalAnswer", () => {
		const answer = extractDecomposeEvalAnswer(
			'```json\n{"tasks":[{"id":"schema"},{"id":"api","dependsOn":["schema"]},{"id":"ui","dependsOn":["api"]}]}\n```',
		);
		expect(answer).not.toBeNull();
		if (answer) {
			// Any decompose prompt works — scoreValidDag grades the graph, not the prompt text.
			const prompt = { id: "p", role: "architect", family: "decompose", difficulty: "easy", prompt: "x" } as never;
			expect(scoreEvalAnswer(prompt, answer)).toBe(1);
		}
	});

	it("end-to-end: an extracted CYCLIC graph scores 0", () => {
		const answer = extractDecomposeEvalAnswer(
			'{"tasks":[{"id":"a","dependsOn":["b"]},{"id":"b","dependsOn":["a"]}]}',
		);
		expect(answer).not.toBeNull();
		if (answer) {
			const prompt = { id: "p", role: "architect", family: "decompose", difficulty: "easy", prompt: "x" } as never;
			expect(scoreEvalAnswer(prompt, answer)).toBe(0);
		}
	});
});

describe("extractReviewCaught (free-text review → canonical defect ids)", () => {
	it("credits an off-by-one finding phrased naturally", () => {
		expect(extractReviewCaught("The loop reads one past the end of the array.", ["off-by-one"])).toEqual([
			"off-by-one",
		]);
		expect(extractReviewCaught("`i <= rows.length` is an off-by-one error.", ["off-by-one"])).toEqual(["off-by-one"]);
	});

	it("credits null-deref and unhandled-rejection from a two-defect review", () => {
		const review =
			"1. `user.profile.email` can be null — profile may be null, so this dereferences null. " +
			"2. The fetch() promise is never awaited, so a network error is an unhandled rejection.";
		expect(new Set(extractReviewCaught(review, ["null-deref", "unhandled-rejection"]))).toEqual(
			new Set(["null-deref", "unhandled-rejection"]),
		);
	});

	it("credits the security trio (toctou race, resource leak, sql injection)", () => {
		const review =
			"There is a check-then-act race condition between exists and insert. The file handle is never closed (a " +
			"resource leak). And `name` is concatenated straight into the query — a classic SQL injection.";
		expect(new Set(extractReviewCaught(review, ["toctou-race", "resource-leak", "sql-injection"]))).toEqual(
			new Set(["toctou-race", "resource-leak", "sql-injection"]),
		);
	});

	it("only credits a defect the review actually surfaced (partial recall)", () => {
		const review = "The only issue I see is the SQL injection via string concatenation.";
		expect(extractReviewCaught(review, ["toctou-race", "resource-leak", "sql-injection"])).toEqual(["sql-injection"]);
	});

	it("returns [] for empty/blank review text", () => {
		expect(extractReviewCaught("", ["off-by-one"])).toEqual([]);
		expect(extractReviewCaught("   ", ["off-by-one"])).toEqual([]);
	});

	it("falls back to token matching for an unknown defect id", () => {
		expect(extractReviewCaught("This is a double free of the buffer.", ["double-free"])).toEqual(["double-free"]);
		expect(extractReviewCaught("Looks fine to me.", ["double-free"])).toEqual([]);
	});

	it("end-to-end: a full review scores 1.0 recall via scoreEvalAnswer", () => {
		const answer = extractReviewEvalAnswer("The loop bound `<=` is off by one, reading one past the end.", [
			"off-by-one",
		]);
		const prompt = {
			id: "review-off-by-one",
			role: "reviewer",
			family: "review",
			difficulty: "easy",
			prompt: "x",
			code: "…",
			seededDefects: ["off-by-one"],
		} as never;
		expect(scoreEvalAnswer(prompt, answer)).toBe(1);
	});

	it("end-to-end: catching 1 of 2 seeded defects scores 0.5", () => {
		const answer = extractReviewEvalAnswer("Only the null dereference stands out to me.", [
			"null-deref",
			"unhandled-rejection",
		]);
		const prompt = {
			id: "r",
			role: "reviewer",
			family: "review",
			difficulty: "medium",
			prompt: "x",
			code: "…",
			seededDefects: ["null-deref", "unhandled-rejection"],
		} as never;
		expect(scoreEvalAnswer(prompt, answer)).toBe(0.5);
	});
});
