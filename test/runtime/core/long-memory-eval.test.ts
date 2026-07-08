import { describe, expect, it } from "vitest";
import {
	buildInternalLongMemoryEvalFixture,
	decideMemoryScopeBroadening,
	evaluateLongMemoryBenchmark,
	type LongMemoryEvalRanker,
} from "../../../src/core/long-memory-eval";

const fixture = buildInternalLongMemoryEvalFixture();

const exactRanker: LongMemoryEvalRanker = ({ case_, prompt }) => {
	if (prompt.relevantMemoryIds.length === 0) {
		return [];
	}
	return [
		...prompt.relevantMemoryIds,
		...case_.memories.map((memory) => memory.id).filter((id) => !prompt.relevantMemoryIds.includes(id)),
	];
};

const narrowFirstSessionOnlyRanker: LongMemoryEvalRanker = ({ case_, prompt }) => {
	const firstSessionMemories = case_.memories.filter((memory) => memory.sessionId === "alpha-session-1");
	if (prompt.relevantMemoryIds.length === 0) {
		return [];
	}
	return firstSessionMemories.map((memory) => memory.id);
};

const noisyRanker: LongMemoryEvalRanker = ({ case_ }) => case_.memories.map((memory) => memory.id);

describe("internal LongMemEval-style benchmark", () => {
	it("passes when a ranker recalls injected facts across sessions and abstains on missing evidence", () => {
		const report = evaluateLongMemoryBenchmark(fixture, exactRanker, { k: 2 });
		expect(report).toMatchObject({
			k: 2,
			promptCount: 3,
			answerablePromptCount: 2,
			abstainPromptCount: 1,
			recallAtK: 1,
			abstainAccuracy: 1,
			passed: true,
		});
		expect(report.results.every((result) => result.passed)).toBe(true);
	});

	it("fails when recall is too narrow to reach another historical session", () => {
		const report = evaluateLongMemoryBenchmark(fixture, narrowFirstSessionOnlyRanker, { k: 2 });
		expect(report.passed).toBe(false);
		expect(report.recallAtK).toBeLessThan(1);
		expect(report.results.find((result) => result.promptId === "alpha-release-prerequisite")).toMatchObject({
			passed: false,
			failureReason: "missed relevant memory within top-2",
		});
	});

	it("fails when a ranker retrieves irrelevant memory for an unanswerable prompt", () => {
		const report = evaluateLongMemoryBenchmark(fixture, noisyRanker, { k: 2 });
		expect(report.passed).toBe(false);
		expect(report.abstainAccuracy).toBe(0);
		expect(report.results.find((result) => result.promptId === "alpha-payment-provider")).toMatchObject({
			passed: false,
			failureReason: "retrieved memory when the fixture required abstention",
		});
	});
});

describe("decideMemoryScopeBroadening", () => {
	it("allows broadening only when it was requested and the benchmark passed", () => {
		const passed = evaluateLongMemoryBenchmark(fixture, exactRanker);
		const failed = evaluateLongMemoryBenchmark(fixture, narrowFirstSessionOnlyRanker);

		expect(decideMemoryScopeBroadening({ requestedAccessAllOptIn: false, benchmark: passed })).toEqual({
			accessAllOptIn: false,
			reason: "Scope broadening was not requested.",
		});
		expect(decideMemoryScopeBroadening({ requestedAccessAllOptIn: true, benchmark: null })).toEqual({
			accessAllOptIn: false,
			reason: "Scope broadening requires a LongMemEval benchmark result.",
		});
		expect(decideMemoryScopeBroadening({ requestedAccessAllOptIn: true, benchmark: failed })).toEqual({
			accessAllOptIn: false,
			reason: "LongMemEval benchmark did not pass.",
		});
		expect(decideMemoryScopeBroadening({ requestedAccessAllOptIn: true, benchmark: passed })).toEqual({
			accessAllOptIn: true,
			reason: "LongMemEval benchmark passed.",
		});
	});
});
