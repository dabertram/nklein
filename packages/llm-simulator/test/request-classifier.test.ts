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
