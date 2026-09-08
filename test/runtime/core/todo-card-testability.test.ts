import { describe, expect, it } from "vitest";
import { deriveTodoCardTestability } from "../../../src/core/todo-card-testability";

/**
 * F2.36 (c). The board mirrors todo.md, and !Klein's test-driven gate demands a test change for testable work.
 * That default is right for most of the backlog and wrong for entries that record a decision, write
 * documentation, or wait on something only a human can do — those have nothing to assert, so a worker either
 * invents a meaningless test or loops until it parks.
 *
 * The asymmetry is the whole design: a wrong `not_testable` silently exempts real work from the one gate that
 * proves it works, and nothing downstream questions it. A wrong `testable` costs one conversation.
 */
describe("deriveTodoCardTestability", () => {
	it("defaults to testable — an exemption must be earned", () => {
		for (const text of [
			"P0.HEAP — the server's heap grows unbounded and dies at the 4GB limit",
			"add a ratchet for the flag registry",
			"",
			"refactor the reviewer ranking",
		]) {
			expect(deriveTodoCardTestability(text), text).toEqual({ testability: "testable", reason: "" });
		}
	});

	it("exempts entries with nothing to assert, and says which phrase it matched", () => {
		const cases: [string, string][] = [
			["F5.7 signing activation — needs Apple credentials, David-deferred", "deferred to the operator"],
			[
				"P1.IMGREBUILD — blocked on network consent for the image pull",
				"blocked on something only the operator can do",
			],
			["write up the fleet research — research-only note", "research writeup"],
			["documentation-only pass over the runbook", "documentation-only work"],
		];
		for (const [text, expected] of cases) {
			const verdict = deriveTodoCardTestability(text);
			expect(verdict.testability, text).toBe("not_testable");
			expect(verdict.reason, text).toContain(expected);
		}
	});

	it("does not exempt work that merely MENTIONS docs or a decision", () => {
		// These are the near-misses that a broader pattern would swallow, and each is real product work.
		for (const text of [
			"update the docs and the code that generates them",
			"the decision table drives routing; add the missing branch",
			"research spike is done; now implement the router",
			"unblock the network path in the egress proxy",
		]) {
			expect(deriveTodoCardTestability(text).testability, text).toBe("testable");
		}
	});
});

describe("the explicit declaration", () => {
	/**
	 * The first version of this module matched phrases that appear nowhere in the real backlog: it read well and
	 * fired on zero of fifteen open items. Guessing at an author's intent from keywords is guesswork dressed as a
	 * rule, so an entry says it outright, the same way a card declares its own testability upfront (F1.34b).
	 */
	it("takes the entry at its word, and keeps the stated reason", () => {
		const verdict = deriveTodoCardTestability(
			"P1.IMGREBUILD — rebuild the sandbox image *(not testable: an operational rebuild on a real connection)*",
		);
		expect(verdict.testability).toBe("not_testable");
		expect(verdict.reason).toBe("an operational rebuild on a real connection");
	});

	it("beats the keyword signals, so an author can be explicit about a near-miss", () => {
		expect(
			deriveTodoCardTestability("update the docs and the code *(not testable: it is a wording pass)*").reason,
		).toBe("it is a wording pass");
	});

	it("ignores prose that merely says the words", () => {
		expect(deriveTodoCardTestability("explain why this is not testable in the note").testability).toBe("testable");
	});
});
