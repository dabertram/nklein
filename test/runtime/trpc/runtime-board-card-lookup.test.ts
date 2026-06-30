import { describe, expect, it } from "vitest";

import type { RuntimeBoardCard } from "../../../src/core/api-contract";
import { findBoardCardById, findSourceCardBaseRef } from "../../../src/trpc/runtime-board-card-lookup";

/** Minimal card stub — the lookups only read `id` and `baseRef`. */
function card(id: string, baseRef: string | null = null): RuntimeBoardCard {
	return { id, baseRef } as unknown as RuntimeBoardCard;
}

const CARDS = [card("a", "main"), card("b", "feat/x"), card("c")];

describe("findBoardCardById", () => {
	it("returns the matching card", () => {
		expect(findBoardCardById(CARDS, "b")?.id).toBe("b");
	});

	it("returns null when no card matches", () => {
		expect(findBoardCardById(CARDS, "missing")).toBeNull();
	});

	it("returns null for an empty board", () => {
		expect(findBoardCardById([], "a")).toBeNull();
	});
});

describe("findSourceCardBaseRef", () => {
	it("returns null for a null source id without scanning", () => {
		expect(findSourceCardBaseRef(CARDS, null)).toBeNull();
	});

	it("returns the matched card's baseRef", () => {
		expect(findSourceCardBaseRef(CARDS, "b")).toBe("feat/x");
	});

	it("returns null when the matched card has a null baseRef", () => {
		expect(findSourceCardBaseRef(CARDS, "c")).toBeNull();
	});

	it("returns null when no card matches the source id", () => {
		expect(findSourceCardBaseRef(CARDS, "missing")).toBeNull();
	});
});
