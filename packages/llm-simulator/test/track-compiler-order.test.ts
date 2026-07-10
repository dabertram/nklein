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
