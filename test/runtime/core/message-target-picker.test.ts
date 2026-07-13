import { describe, expect, it } from "vitest";
import {
	buildTargetPickerPrompt,
	parseTargetPickerChoice,
	type TargetPickerCandidate,
} from "../../../src/core/message-target-picker";

/**
 * F2.16a — the isolated LLM target picker: the prompt names only the candidates + the strict parse that accepts
 * ONLY a valid candidate id and abstains on everything else (never invents a route).
 */

const CANDIDATES: TargetPickerCandidate[] = [
	{ id: "card-auth", kind: "card", label: "Add login form" },
	{ id: "card-db", kind: "card", label: "Set up the database" },
	{ id: "t9:needs_input", kind: "answer", label: "Which port for the API?" },
];
const VALID = CANDIDATES.map((c) => c.id);

describe("buildTargetPickerPrompt", () => {
	it("lists every candidate and forbids inventing an id", () => {
		const { system, user } = buildTargetPickerPrompt({ message: "the login one", candidates: CANDIDATES });
		expect(system).toContain("ABSTAIN");
		expect(system).toContain("Never invent");
		expect(user).toContain("card-auth");
		expect(user).toContain("t9:needs_input");
		expect(user).toContain("the login one");
	});
});

describe("parseTargetPickerChoice", () => {
	it("accepts an exact valid id (with tolerant wrapping)", () => {
		expect(parseTargetPickerChoice("card-auth", VALID)).toEqual({ chosenId: "card-auth" });
		expect(parseTargetPickerChoice("  `card-db` ", VALID)).toEqual({ chosenId: "card-db" });
		expect(parseTargetPickerChoice('id: "t9:needs_input"', VALID)).toEqual({ chosenId: "t9:needs_input" });
		expect(parseTargetPickerChoice("```\ncard-auth\n```", VALID)).toEqual({ chosenId: "card-auth" });
	});

	it("ABSTAINs on the keyword, empty, or an unknown/invented id", () => {
		expect(parseTargetPickerChoice("ABSTAIN", VALID)).toEqual({ abstain: true });
		expect(parseTargetPickerChoice("  abstain  ", VALID)).toEqual({ abstain: true });
		expect(parseTargetPickerChoice("", VALID)).toEqual({ abstain: true });
		expect(parseTargetPickerChoice("card-invented", VALID)).toEqual({ abstain: true }); // never invents
		expect(parseTargetPickerChoice("start a new card please", VALID)).toEqual({ abstain: true });
	});

	it("resolves a reply that embeds exactly one valid id, but abstains on ties", () => {
		expect(parseTargetPickerChoice("I think card-auth is the one.", VALID)).toEqual({ chosenId: "card-auth" });
		// Two valid ids mentioned ⇒ ambiguous ⇒ abstain (never guesses).
		expect(parseTargetPickerChoice("either card-auth or card-db", VALID)).toEqual({ abstain: true });
	});

	it("does not partial-match a longer id (word-boundaried)", () => {
		expect(parseTargetPickerChoice("card-au", VALID)).toEqual({ abstain: true });
		expect(parseTargetPickerChoice("card-auth-2", ["card-auth"])).toEqual({ abstain: true });
	});
});
