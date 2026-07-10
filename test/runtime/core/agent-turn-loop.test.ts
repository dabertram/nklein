import { describe, expect, it } from "vitest";

import {
	type AgentLoopTurn,
	contestedTokens,
	decideTurnLoopResolution,
	detectTurnLoop,
	extractContestedQuestion,
	turnFingerprint,
} from "../../../src/core/agent-turn-loop.js";

const jsQuestion =
	"I need to check the test setup. The acceptance command targets *.js but the sources are *.ts. Is the *.js test command correct?";

describe("turnFingerprint", () => {
	it("collapses near-identical re-raises to one key but distinguishes a different proposal/tool", () => {
		const a: AgentLoopTurn = { text: "Is the *.js test command correct?" };
		const b: AgentLoopTurn = { text: "Is  the  *.js   test command correct?  " };
		const c: AgentLoopTurn = { text: "Let me write the module instead." };
		expect(turnFingerprint(a)).toBe(turnFingerprint(b));
		expect(turnFingerprint(a)).not.toBe(turnFingerprint(c));
	});

	it("folds tool calls into the fingerprint", () => {
		const withTool: AgentLoopTurn = { text: "same", toolCalls: [{ name: "run_commands", argsKey: "npm test" }] };
		const noTool: AgentLoopTurn = { text: "same" };
		expect(turnFingerprint(withTool)).not.toBe(turnFingerprint(noTool));
	});
});

describe("extractContestedQuestion", () => {
	it("prefers the trailing interrogative sentence", () => {
		expect(extractContestedQuestion(jsQuestion)).toBe("Is the *.js test command correct?");
	});
	it("falls back to a conflict-marker sentence when no question mark", () => {
		expect(extractContestedQuestion("The command targets *.js but sources are *.ts.")).toContain("targets *.js");
	});
	it("returns null for progress text", () => {
		expect(extractContestedQuestion("Wrote greet.ts and ran the tests. All pass.")).toBeNull();
	});
});

describe("detectTurnLoop", () => {
	it("flags a repeat when the same question recurs across the minimum turns", () => {
		const turns: AgentLoopTurn[] = [
			{ text: "Let me inspect the repo." },
			{ text: jsQuestion },
			{ text: jsQuestion },
			{ text: jsQuestion },
		];
		const verdict = detectTurnLoop(turns);
		expect(verdict.kind).toBe("repeat");
		expect(verdict.occurrences).toBe(3);
		expect(verdict.contestedQuestion).toBe("Is the *.js test command correct?");
	});

	it("flags an oscillation between two alternating proposals", () => {
		const a: AgentLoopTurn = { text: "Should I rename the tests to *.ts?" };
		const b: AgentLoopTurn = { text: "Or should I change the acceptance command to *.js?" };
		const verdict = detectTurnLoop([a, b, a, b, a, b]);
		expect(verdict.kind).toBe("oscillation");
		expect(verdict.contestedQuestion).not.toBeNull();
	});

	it("returns none for genuine progress", () => {
		const verdict = detectTurnLoop([
			{ text: "Read specification.md." },
			{ text: "Wrote greet.ts." },
			{ text: "Ran npm test — green." },
			{ text: "Task complete." },
		]);
		expect(verdict.kind).toBe("none");
	});

	it("does not flag a short run below the repeat threshold", () => {
		expect(detectTurnLoop([{ text: jsQuestion }, { text: jsQuestion }]).kind).toBe("none");
	});
});

describe("contestedTokens", () => {
	it("pulls glob/extension + command tokens", () => {
		const tokens = contestedTokens(jsQuestion);
		expect(tokens).toContain("*.js");
	});
});

describe("decideTurnLoopResolution", () => {
	const verdict = detectTurnLoop([{ text: "x" }, { text: jsQuestion }, { text: jsQuestion }, { text: jsQuestion }]);

	it("auto-resolves when the acceptance command settles the contested token", () => {
		const resolution = decideTurnLoopResolution({ verdict, acceptanceCommand: "npm test -- *.js" });
		expect(resolution.kind).toBe("auto_resolve");
		if (resolution.kind === "auto_resolve") {
			expect(resolution.guidance).toContain("acceptance command is authoritative");
			expect(resolution.guidance).toContain("*.js");
		}
	});

	it("escalates to an untried model when not auto-resolvable", () => {
		const resolution = decideTurnLoopResolution({
			verdict,
			acceptanceCommand: "make build",
			triedModelIds: ["qwen"],
			availableModelIds: ["qwen", "devstral"],
		});
		expect(resolution.kind).toBe("escalate_model");
		if (resolution.kind === "escalate_model") {
			expect(resolution.modelId).toBe("devstral");
			expect(resolution.boundary).toBe("Is the *.js test command correct?");
		}
	});

	it("parks with the specific question when nothing else remains", () => {
		const resolution = decideTurnLoopResolution({
			verdict,
			acceptanceCommand: "make build",
			triedModelIds: ["qwen"],
			availableModelIds: ["qwen"],
		});
		expect(resolution.kind).toBe("park_needs_you");
		if (resolution.kind === "park_needs_you") {
			expect(resolution.question).toBe("Is the *.js test command correct?");
		}
	});

	it("continues when there is no loop", () => {
		expect(
			decideTurnLoopResolution({
				verdict: { kind: "none", occurrences: 0, fingerprint: null, contestedQuestion: null },
			}).kind,
		).toBe("continue");
	});
});
