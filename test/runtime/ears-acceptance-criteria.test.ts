import { describe, expect, it } from "vitest";
import { nextClarification, renderEarsCriterion, selectClarifications } from "../../src/core/ears-acceptance-criteria";

describe("EARS criteria (F12.8)", () => {
	it("derives the pattern from the fields present, not from a caller label", () => {
		expect(renderEarsCriterion({ behavior: "encrypt data at rest" })).toEqual({
			pattern: "ubiquitous",
			text: "THE SYSTEM SHALL encrypt data at rest.",
		});
		expect(renderEarsCriterion({ trigger: "the user submits an empty form", behavior: "reject it" })).toEqual({
			pattern: "event_driven",
			text: "WHEN the user submits an empty form, THE SYSTEM SHALL reject it.",
		});
		expect(renderEarsCriterion({ state: "offline", behavior: "queue the request" })).toEqual({
			pattern: "state_driven",
			text: "WHILE offline, THE SYSTEM SHALL queue the request.",
		});
	});

	it("uses IF/THEN for unwanted behaviour and WHERE for feature gates", () => {
		expect(
			renderEarsCriterion({ trigger: "the upload exceeds 10MB", behavior: "reject with 413", unwanted: true }),
		).toEqual({
			pattern: "unwanted_behavior",
			text: "IF the upload exceeds 10MB, THEN THE SYSTEM SHALL reject with 413.",
		});
		expect(renderEarsCriterion({ feature: "billing is enabled", behavior: "show the invoice tab" }).pattern).toBe(
			"optional_feature",
		);
	});

	it("combines state and trigger, and normalises whitespace/trailing periods", () => {
		expect(
			renderEarsCriterion({ state: "  the queue is full ", trigger: "a job arrives.", behavior: "drop it..." }).text,
		).toBe("WHILE the queue is full, WHEN a job arrives, THE SYSTEM SHALL drop it.");
	});

	it("asks only the UNANSWERED questions, in priority order, capped", () => {
		expect(selectClarifications({ answered: [] }).map((q) => q.topic)).toEqual([
			"problem",
			"core_actions",
			"out_of_scope",
			"success_criteria",
		]);
		expect(selectClarifications({ answered: ["problem", "core_actions"] }).map((q) => q.topic)).toEqual([
			"out_of_scope",
			"success_criteria",
		]);
		expect(selectClarifications({ answered: [], limit: 2 })).toHaveLength(2);
	});

	it("hands back ONE question at a time and null when the spec is complete", () => {
		expect(nextClarification({ answered: [] })?.topic).toBe("problem");
		expect(nextClarification({ answered: ["problem"] })?.topic).toBe("core_actions");
		expect(
			nextClarification({ answered: ["problem", "core_actions", "out_of_scope", "success_criteria"] }),
		).toBeNull();
	});

	it("asks about what/why, never about how", () => {
		const questions = selectClarifications({ answered: [] }).map((q) => q.question.toLowerCase());
		expect(questions.some((q) => q.includes("what problem"))).toBe(true);
		expect(questions.some((q) => q.includes("not in scope"))).toBe(true);
		// No implementation-steering prompts.
		expect(questions.some((q) => q.includes("which library") || q.includes("what framework"))).toBe(false);
	});
});
