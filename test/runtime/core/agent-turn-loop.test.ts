import { describe, expect, it } from "vitest";

import {
	type AgentLoopTurn,
	contestedTokens,
	decideTurnLoopResolution,
	detectTurnLoop,
	extractAcceptanceCheckCommand,
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
	it("does not reinterpret a generated test assertion as an operator question", () => {
		expect(
			extractContestedQuestion(
				"I will add this test:\n```ts\nexpect(summary.recommendation).toBe('Maintain your current effort.');\n```",
			),
		).toBeNull();
		expect(
			extractContestedQuestion("expect(summary.recommendation).toBe('Maintain your current effort.');"),
		).toBeNull();
	});
});

describe("extractAcceptanceCheckCommand", () => {
	it.each(["Acceptance check", "Acceptance command"])("accepts the %s prompt label", (label) => {
		expect(extractAcceptanceCheckCommand(`Implement the card.\n${label}: npm test\nKeep the diff focused.`)).toBe(
			"npm test",
		);
	});

	it("does not infer a command from ordinary prose", () => {
		expect(extractAcceptanceCheckCommand("Run npm test before finishing.")).toBeNull();
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

	it("flags a three-step inspect → unchanged rewrite → retry cycle after three full repetitions", () => {
		const inspect: AgentLoopTurn = { text: "The formatter looks correct; I will inspect it again." };
		const rewrite: AgentLoopTurn = { text: "I will write the same test file again." };
		const retry: AgentLoopTurn = { text: "Now I will run npm test again." };
		const verdict = detectTurnLoop([inspect, rewrite, retry, inspect, rewrite, retry, inspect, rewrite, retry]);
		expect(verdict.kind).toBe("cycle");
		expect(verdict.occurrences).toBe(9);
	});

	it("does not flag two ordinary edit/test iterations as a periodic cycle", () => {
		const inspect: AgentLoopTurn = { text: "Inspect the current failure." };
		const edit: AgentLoopTurn = { text: "Apply a correction." };
		const test: AgentLoopTurn = { text: "Run the acceptance command." };
		expect(detectTurnLoop([inspect, edit, test, inspect, edit, test]).kind).toBe("none");
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

	it("grounds a BACKTICK-QUOTED acceptance command despite quoting differences (a-same-question regression)", () => {
		// The model quotes the command it questions; contestedTokens strips the quotes — the grounding haystack
		// must shed quotes too, or a quoted acceptance command can never ground against its own token.
		const quotedQuestion =
			'The acceptance command `node -e "process.exit(0)"` looks trivial; should I instead set up vitest, or keep the acceptance exactly as specified?';
		const quotedVerdict = detectTurnLoop([
			{ text: quotedQuestion },
			{ text: quotedQuestion },
			{ text: quotedQuestion },
		]);
		const resolution = decideTurnLoopResolution({
			verdict: quotedVerdict,
			acceptanceCommand: 'node -e "process.exit(0)"',
			specContext: "Create greet.ts exporting greet(name).",
		});
		expect(resolution.kind).toBe("auto_resolve");
	});

	it("auto-resolves a periodic work cycle by requiring exact failure evidence before another edit", () => {
		const inspect: AgentLoopTurn = { text: "The formatter looks correct; inspect it again." };
		const rewrite: AgentLoopTurn = { text: "Write the same test again." };
		const retry: AgentLoopTurn = { text: "Run npm test again." };
		const cycleVerdict = detectTurnLoop([inspect, rewrite, retry, inspect, rewrite, retry, inspect, rewrite, retry]);
		const resolution = decideTurnLoopResolution({ verdict: cycleVerdict, acceptanceCommand: "npm test" });
		expect(resolution.kind).toBe("auto_resolve");
		if (resolution.kind === "auto_resolve") {
			expect(resolution.guidance).toContain("exact failure output");
			expect(resolution.guidance).toContain("Do not repeat an unchanged write");
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
