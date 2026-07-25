/**
 * Classification truths derived from a LIVE !Klein request journal (2026-07-10, simulated fast path bring-up).
 * These encode the wire-level facts that make ordering matter; if !Klein's shells change, update BOTH the
 * DEFAULT markers and these fixtures.
 */

import { describe, expect, it } from "vitest";
import { classifyRequest } from "../src/aimock/request-classifier.js";

/** The full worker/plan tool registry rides along on EVERY kanban session (~30 tools, incl. decompose_project). */
const REGISTRY_TOOLS = ["read_files", "write_files", "run_commands", "decompose_project", "list_directory"].map(
	(name) => ({ function: { name } }),
);
/** Review sessions get a DIFFERENT, smaller list (17 tools) that includes submit_review but NOT decompose_project. */
const REVIEW_TOOLS = ["read_files", "run_commands", "submit_review", "list_directory"].map((name) => ({
	function: { name },
}));

const GENERIC_SYSTEM =
	"You are NKlein, an AI coding agent. Your primary goal is to assist users with various coding tasks.";

describe("classifyRequest against live !Klein wire shapes", () => {
	it("classifies a worker card as worker even though decompose_project is offered (text beats tools)", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{
						role: "user",
						content: [{ type: "text", text: "Create greet.ts exporting greet(name). Leaf scope: complete only this card's explicit objective." }],
					},
				],
				tools: REGISTRY_TOOLS,
			}),
		).toBe("worker");
	});

	it("classifies a review request as review even when the diff context mentions Leaf scope (marker order)", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{
						role: "user",
						content: [
							{
								type: "text",
								text: 'You are the second-opinion reviewer for the card "Greeting module" (review round 1). The card prompt was: "… Leaf scope: complete only this card\'s explicit objective."',
							},
						],
					},
				],
				tools: REVIEW_TOOLS,
			}),
		).toBe("review");
	});

	it("classifies a nudged review continuation via the submit_review tool marker alone", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{ role: "user", content: "You ended your turn without calling `submit_review`, so no review was recorded." },
				],
				tools: REVIEW_TOOLS,
			}),
		).toBe("review");
	});

	it("keeps a bounced worker in the worker class when its feedback quotes the second-opinion reviewer", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{
						role: "user",
						content: "Leaf scope: complete only this card's explicit objective. Acceptance check: npm test",
					},
					{ role: "assistant", content: "Task complete." },
					{
						role: "user",
						content: "The second-opinion reviewer requested changes (review round 1). Fix the missing assertion.",
					},
				],
				tools: REGISTRY_TOOLS,
			}),
		).toBe("worker");
	});

	it("classifies a PLAN seed as worker — decompose is indistinguishable on the wire, so decompose tracks must carry userMessageIncludes", () => {
		// The plan seed carries the same Leaf-scope scaffold + the same tool registry as a worker card. There is
		// NO universal decompose signal; scenario decompose tracks key on their own project's seed prompt.
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Create a dependent implementation-card breakdown for the habit insight summary work in specification.md. Leaf scope: complete only this card's explicit objective.",
							},
						],
					},
				],
				tools: REGISTRY_TOOLS,
			}),
		).toBe("worker");
	});

	it("falls back to decompose via the tool marker when no text scaffold matches", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{ role: "user", content: "Please break this project into cards." },
				],
				tools: REGISTRY_TOOLS,
			}),
		).toBe("decompose");
	});

	it("classifies a RESUME-based review (worker registry, no submit_review, brief as last user message) as review", () => {
		// F1.34c-drift (live-found 2026-07-25): some flows review by resuming the WORKER session — worker tool
		// registry, no submit_review — and the review brief (which quotes the card's Leaf scope / Acceptance check
		// scaffold) arrives as the LAST user message. The whole-text worker markers must not win there.
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{ role: "user", content: "Leaf scope: complete only this card. Acceptance check: `npm test`." },
					{ role: "assistant", content: "Done. Files written." },
					{
						role: "user",
						content:
							'You are the second-opinion reviewer for the card "Scaffold" (review round 1).\n' +
							"Objective (quoted): Leaf scope: complete only this card. Acceptance check: `npm test`.\n" +
							"Inspect the diff and return a single verdict.",
					},
				],
				tools: REGISTRY_TOOLS,
			}),
		).toBe("review");
	});

	it("still classifies a bounced worker re-drive (feedback quoted, re-work prompt last) as worker", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: GENERIC_SYSTEM },
					{ role: "user", content: "Leaf scope: complete only this card. Acceptance check: `npm test`." },
					{ role: "assistant", content: "Done. Files written." },
					{
						role: "user",
						content:
							"You are taking over this task from another model that got stuck in review. " +
							"Reviewer feedback: add a trailing newline check. Address it directly and keep the kanban card scoped.",
					},
				],
				tools: REGISTRY_TOOLS,
			}),
		).toBe("worker");
	});

	it("classifies bare prompts with no tools as chat", () => {
		expect(
			classifyRequest({
				messages: [
					{ role: "system", content: "You are a helpful assistant." },
					{ role: "user", content: "hello there" },
				],
			}),
		).toBe("chat");
	});
});
