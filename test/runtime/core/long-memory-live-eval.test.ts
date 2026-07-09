import { describe, expect, it } from "vitest";
import { buildInternalLongMemoryEvalFixture } from "../../../src/core/long-memory-eval";
import {
	parseLongMemoryAnswer,
	parseLongMemorySelection,
	scoreLongMemoryModelAnswer,
} from "../../../src/core/long-memory-live-eval";

const fixture = buildInternalLongMemoryEvalFixture();
const case_ = fixture[0];

function promptById(id: string) {
	const prompt = case_.prompts.find((entry) => entry.id === id);
	if (!prompt) {
		throw new Error(`Missing fixture prompt ${id}`);
	}
	return prompt;
}

describe("LongMemEval live response parsing", () => {
	it("parses and filters model-selected memory ids", () => {
		expect(
			parseLongMemorySelection(
				'{"memoryIds":["alpha-api-base-url","unknown","alpha-api-base-url","alpha-release-dry-run"]}',
				case_.memories.map((memory) => memory.id),
			),
		).toEqual(["alpha-api-base-url", "alpha-release-dry-run"]);
	});

	it("parses answer JSON booleans and answer text", () => {
		expect(parseLongMemoryAnswer('{"answerable":true,"answer":"Use http://localhost:4317/v2."}')).toEqual({
			answerable: true,
			answer: "Use http://localhost:4317/v2.",
		});
		expect(parseLongMemoryAnswer('{"answerable":"false","answer":""}')).toEqual({
			answerable: false,
			answer: "",
		});
	});
});

describe("LongMemEval live answer scoring", () => {
	it("passes when an answerable prompt includes the expected evidence", () => {
		expect(
			scoreLongMemoryModelAnswer(
				case_,
				promptById("alpha-base-url"),
				'{"answerable":true,"answer":"Project Alpha should use http://localhost:4317/v2."}',
			),
		).toMatchObject({
			passed: true,
			reason: "answer included all expected evidence",
		});
	});

	it("fails when an answerable prompt misses the expected evidence", () => {
		expect(
			scoreLongMemoryModelAnswer(
				case_,
				promptById("alpha-release-prerequisite"),
				'{"answerable":true,"answer":"Run the release checklist."}',
			),
		).toMatchObject({
			passed: false,
			missingNeedles: ["migration dry-run"],
		});
	});

	it("passes abstention only for unanswerable prompts", () => {
		const prompt = promptById("alpha-payment-provider");
		expect(scoreLongMemoryModelAnswer(case_, prompt, '{"answerable":false,"answer":""}')).toMatchObject({
			passed: true,
			reason: "model abstained",
		});
		expect(scoreLongMemoryModelAnswer(case_, prompt, '{"answerable":true,"answer":"Stripe"}')).toMatchObject({
			passed: false,
			reason: "model claimed an answer for an unanswerable prompt",
		});
	});
});
