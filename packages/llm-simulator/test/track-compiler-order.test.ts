import { describe, expect, it } from "vitest";
import { compileScenarioScript } from "../src/aimock/track-compiler.js";
import type { ScenarioScript } from "../src/scenario/track-types.js";

/**
 * Specificity-ordered compilation — the merged-multi-scenario regression (live-found 2026-07-10): the dev
 * stack merges several project sets into ONE script, and aimock answers with the FIRST matching fixture, so
 * an earlier catch-all (`any`, no needle) from project A silently swallowed project B's needle-keyed
 * decompose request. Compilation must order needle-keyed tracks before class-scoped ones before catch-alls,
 * regardless of authoring order.
 */

function request(userText: string): { messages: Array<{ role: string; content: string }> } {
	return { messages: [{ role: "user", content: userText }] };
}

function firstMatch(
	fixtures: ReturnType<typeof compileScenarioScript>,
	req: { messages: Array<{ role: string; content: string }> },
): number {
	return fixtures.findIndex((fixture) => {
		const predicate = (fixture.match as { predicate?: (r: unknown) => boolean }).predicate;
		return predicate ? predicate(req) : false;
	});
}

describe("compileScenarioScript specificity ordering", () => {
	const merged: ScenarioScript = {
		name: "merged",
		seed: 1,
		tracks: [
			// Project A's catch-all is authored FIRST — the exact shadowing shape the dev stack produces.
			{
				id: "a:any-fallback",
				requestClass: "any",
				turns: [{ behavior: { kind: "text", content: "A fallback." } }],
				repeatLastTurn: true,
			},
			{
				id: "b:decompose",
				requestClass: "any",
				userMessageIncludes: "breakdown for project B",
				turns: [{ behavior: { kind: "text", content: "B decompose." } }],
				repeatLastTurn: true,
			},
		],
	};

	it("lets a needle-keyed track win over an earlier catch-all", () => {
		const fixtures = compileScenarioScript(merged);
		const matched = firstMatch(fixtures, request("Create the implementation-card breakdown for project B now."));
		expect(matched).toBeGreaterThanOrEqual(0);
		const response = JSON.stringify(fixtures[matched]?.response ?? "");
		expect(response).toContain("B decompose.");
	});

	it("still routes unmatched requests to the catch-all", () => {
		const fixtures = compileScenarioScript(merged);
		const matched = firstMatch(fixtures, request("Something entirely different."));
		expect(matched).toBeGreaterThanOrEqual(0);
		const response = JSON.stringify(fixtures[matched]?.response ?? "");
		expect(response).toContain("A fallback.");
	});

	it("cycleTurns re-emits the tool turn on resumed sessions (review rounds)", () => {
		const script: ScenarioScript = {
			name: "cycle",
			seed: 1,
			tracks: [
				{
					id: "review-cycle",
					requestClass: "any",
					userMessageIncludes: "reviewer for",
					turns: [
						{ behavior: { kind: "text", content: "VERDICT-TURN" } },
						{ behavior: { kind: "text", content: "CLOSING-TEXT" } },
					],
					cycleTurns: true,
				},
			],
		};
		const fixtures = compileScenarioScript(script);
		const withAssistants = (count: number) => ({
			messages: [
				{ role: "user", content: "You are the reviewer for this card." },
				...Array.from({ length: count }, () => ({ role: "assistant", content: "prior turn" })),
			],
		});
		const responseAt = (count: number) => {
			const index = firstMatch(fixtures, withAssistants(count) as never);
			return JSON.stringify(fixtures[index]?.response ?? "");
		};
		expect(responseAt(0)).toContain("VERDICT-TURN");
		expect(responseAt(1)).toContain("CLOSING-TEXT");
		expect(responseAt(2)).toContain("VERDICT-TURN");
		expect(responseAt(5)).toContain("CLOSING-TEXT");
	});

	it("uses a round-1-specific bounce track before the generic approval fallback", () => {
		const verdictTurn = (verdict: "approve" | "request_changes") => ({
			behavior: {
				kind: "tool_calls" as const,
				calls: [
					{
						name: "submit_review",
						arguments: {
							verdict,
							summary: verdict,
							...(verdict === "request_changes" ? { feedback: "fix it" } : {}),
						},
					},
				],
			},
		});
		const closing = { behavior: { kind: "text" as const, content: "REVIEW-CLOSED" } };
		const script: ScenarioScript = {
			name: "round-keyed-review-bounce",
			seed: 1,
			tracks: [
				{
					id: "round-1-changes",
					requestClass: "any",
					userMessageIncludes: 'the card "Alpha" (review round 1)',
					turns: [verdictTurn("request_changes"), closing],
					cycleTurns: true,
				},
				{
					id: "later-round-approval",
					requestClass: "any",
					userMessageIncludes: 'the card "Alpha"',
					turns: [verdictTurn("approve"), closing],
					cycleTurns: true,
				},
			],
		};
		const fixtures = compileScenarioScript(script);
		const responseAt = (round: number, assistantCount: number) => {
			const requestForRound = {
				messages: [
					{ role: "user", content: `You are the reviewer for the card "Alpha" (review round ${round}).` },
					...Array.from({ length: assistantCount }, () => ({ role: "assistant", content: "prior turn" })),
				],
			};
			const index = firstMatch(fixtures, requestForRound as never);
			return JSON.stringify(fixtures[index]?.response ?? "");
		};

		expect(responseAt(1, 0)).toContain("request_changes");
		expect(responseAt(1, 1)).toContain("REVIEW-CLOSED");
		expect(responseAt(2, 0)).toContain("approve");
		expect(responseAt(2, 1)).toContain("REVIEW-CLOSED");
		expect(responseAt(2, 2)).toContain("approve");
	});

	it("keeps authoring order within the same specificity tier", () => {
		const sameTier: ScenarioScript = {
			name: "tier",
			seed: 1,
			tracks: [
				{
					id: "first",
					requestClass: "any",
					userMessageIncludes: "shared needle",
					turns: [{ behavior: { kind: "text", content: "first wins" } }],
					repeatLastTurn: true,
				},
				{
					id: "second",
					requestClass: "any",
					userMessageIncludes: "shared needle",
					turns: [{ behavior: { kind: "text", content: "second" } }],
					repeatLastTurn: true,
				},
			],
		};
		const fixtures = compileScenarioScript(sameTier);
		const matched = firstMatch(fixtures, request("a request with the shared needle inside"));
		expect(JSON.stringify(fixtures[matched]?.response ?? "")).toContain("first wins");
	});
});

describe("modelIncludes conditioning (N2 model-failover / N3 matrix primitive)", () => {
	const script: ScenarioScript = {
		name: "per-model",
		seed: 1,
		tracks: [
			{
				id: "primary-fails",
				requestClass: "any",
				modelIncludes: "sim/primary",
				turns: [{ behavior: { kind: "http_error", status: 500, message: "engine crash" } }],
				repeatLastTurn: true,
			},
			{
				id: "fallback-succeeds",
				requestClass: "any",
				modelIncludes: "sim/fallback",
				turns: [{ behavior: { kind: "text", content: "recovered on the fallback model" } }],
				repeatLastTurn: true,
			},
			{
				id: "catch-all",
				requestClass: "any",
				turns: [{ behavior: { kind: "text", content: "any model" } }],
				repeatLastTurn: true,
			},
		],
	};

	function modelRequest(model: string): { model: string; messages: Array<{ role: string; content: string }> } {
		return { model, messages: [{ role: "user", content: "do the work" }] };
	}

	it("routes each model to its own track, case-insensitively, before the catch-all", () => {
		const fixtures = compileScenarioScript(script);
		const idx = (model: string) =>
			fixtures.findIndex((fixture) => {
				const predicate = (fixture.match as { predicate?: (r: unknown) => boolean }).predicate;
				return predicate ? predicate(modelRequest(model)) : false;
			});
		// Model-keyed tracks compile in tier 0 (before the catch-all), so each model hits ITS track first.
		expect(idx("sim/PRIMARY-coder")).toBeLessThan(2);
		expect(idx("sim/fallback-coder")).toBeLessThan(2);
		expect(idx("sim/primary-coder")).not.toBe(idx("sim/fallback-coder"));
		// A third model matches only the catch-all (the last-compiled tier).
		expect(idx("sim/other")).toBe(2);
	});
});

describe("N3 quirk matchers (tri-state request-shape predicates)", () => {
	const firstMatch = (script: ScenarioScript, request: unknown): string | null => {
		for (const fixture of compileScenarioScript(script)) {
			const predicate = (fixture.match as { predicate?: (r: unknown) => boolean }).predicate;
			if (predicate?.(request)) {
				return (fixture.response as { content?: string }).content ?? "non-text";
			}
		}
		return null;
	};

	it("requiresJsonSchema: true fires ONLY on json_schema requests; false only on their absence", () => {
		const script: ScenarioScript = {
			name: "json-schema-quirk",
			seed: 1,
			tracks: [
				{
					id: "c-empty-on-schema",
					requestClass: "any",
					requiresJsonSchema: true,
					turns: [{ behavior: { kind: "text", content: "QUIRK" } }],
					repeatLastTurn: true,
				},
				{
					id: "perfect",
					requestClass: "any",
					requiresJsonSchema: false,
					turns: [{ behavior: { kind: "text", content: "HEALTHY" } }],
					repeatLastTurn: true,
				},
			],
		};
		const base = { model: "sim/gemma", messages: [{ role: "user", content: "go" }] };
		expect(firstMatch(script, { ...base, response_format: { type: "json_schema" } })).toBe("QUIRK");
		expect(firstMatch(script, base)).toBe("HEALTHY");
		expect(firstMatch(script, { ...base, response_format: { type: "json_object" } })).toBe("HEALTHY");
	});

	it("messagesNonAlternating: true fires only when consecutive non-system roles repeat (the Jinja 500 shape)", () => {
		const script: ScenarioScript = {
			name: "alternation-quirk",
			seed: 1,
			tracks: [
				{
					id: "t-jinja-500",
					requestClass: "any",
					messagesNonAlternating: true,
					turns: [
						{ behavior: { kind: "http_error", status: 500, message: "Conversation roles must alternate" } },
					],
					repeatLastTurn: true,
				},
				{
					id: "perfect",
					requestClass: "any",
					turns: [{ behavior: { kind: "text", content: "HEALTHY" } }],
					repeatLastTurn: true,
				},
			],
		};
		// The live-found shape: focus-brief parts split into [system, user, user] — non-alternating.
		const nonAlternating = {
			model: "sim/ministral",
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "brief" },
				{ role: "user", content: "task" },
			],
		};
		// System messages are excluded from the alternation check (they legitimately lead the conversation).
		const alternating = {
			model: "sim/ministral",
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "brief" },
				{ role: "assistant", content: "ok" },
				{ role: "user", content: "next" },
			],
		};
		expect(firstMatch(script, nonAlternating)).toBe("non-text");
		expect(firstMatch(script, alternating)).toBe("HEALTHY");
	});
});

describe("class-scoped needle beats any-class needle (2026-08-13 — needle leakage across classes)", () => {
	// The live shape: the decompose track is `any` + a needle quoting the PROJECT SEED — and once the
	// board-context fix embedded the plan objective (the seed text) into REVIEWER seeds, that any-class track
	// shadowed the review track on authoring order. A needle can leak into another class's prompt; the request
	// class cannot — class-scoped needle tracks must outrank any-class needle tracks.
	const scenario: ScenarioScript = {
		name: "leak",
		seed: 1,
		tracks: [
			{
				id: "decompose-any",
				requestClass: "any",
				userMessageIncludes: "the great seed phrase",
				turns: [{ behavior: { kind: "text", content: "DECOMPOSE TRACK." } }],
				repeatLastTurn: true,
			},
			{
				id: "review-scoped",
				requestClass: "review",
				userMessageIncludes: 'the card "build it"',
				turns: [{ behavior: { kind: "text", content: "REVIEW TRACK." } }],
				repeatLastTurn: true,
			},
		],
	};

	it("routes a reviewer request whose seed CONTAINS the leaked phrase to the review track", () => {
		const fixtures = compileScenarioScript(scenario);
		// A review-classed request (offers submit_review) whose user text contains BOTH needles.
		const reviewerRequest = {
			messages: [
				{
					role: "user",
					content:
						'You are the second-opinion reviewer for the card "build it". Plan objective: the great seed phrase.',
				},
			],
			tools: [{ type: "function", function: { name: "submit_review" } }],
		};
		const matched = firstMatch(fixtures, reviewerRequest as never);
		expect(matched).toBeGreaterThanOrEqual(0);
		expect(JSON.stringify(fixtures[matched]?.response ?? "")).toContain("REVIEW TRACK.");
	});

	it("still routes the real decompose request (no review class) to the any-class needle track", () => {
		const fixtures = compileScenarioScript(scenario);
		const decomposeRequest = {
			messages: [{ role: "user", content: "Build the plan: the great seed phrase." }],
			tools: [{ type: "function", function: { name: "decompose_project" } }],
		};
		const matched = firstMatch(fixtures, decomposeRequest as never);
		expect(matched).toBeGreaterThanOrEqual(0);
		expect(JSON.stringify(fixtures[matched]?.response ?? "")).toContain("DECOMPOSE TRACK.");
	});
});
