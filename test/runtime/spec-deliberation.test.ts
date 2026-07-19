import { describe, expect, it } from "vitest";
import {
	buildDeliberationPrompt,
	combineDeliberation,
	DELIBERATION_STANCES,
	decideDeliberationStaffing,
	parseDeliberationReply,
} from "../../src/core/spec-deliberation";

const staffed = { anyModelLoaded: true, distinctFamilies: 3 };

describe("decideDeliberationStaffing", () => {
	it("SKIPS a well-specified card — needless debate injects errors", () => {
		const decision = decideDeliberationStaffing({ ...staffed, ambiguity: 0.1, difficulty: 0.3 });
		expect(decision.mode).toBe("skipped");
	});

	it("deliberates when the spec is ambiguous", () => {
		expect(decideDeliberationStaffing({ ...staffed, ambiguity: 0.7, difficulty: 0.3 }).mode).toBe("cross_family");
	});

	it("deliberates a HARD card at lower ambiguity", () => {
		expect(decideDeliberationStaffing({ ...staffed, ambiguity: 0.2, difficulty: 0.9 }).mode).toBe("cross_family");
	});

	it("falls back to single-model stances with one family, and says the agreement means less", () => {
		const decision = decideDeliberationStaffing({ ...staffed, distinctFamilies: 1, ambiguity: 0.8, difficulty: 0.5 });
		expect(decision.mode).toBe("single_model_stances");
		expect(decision.reason).toContain("same blind spots");
	});

	it("skips entirely with no model loaded", () => {
		const decision = decideDeliberationStaffing({
			anyModelLoaded: false,
			distinctFamilies: 0,
			ambiguity: 0.9,
			difficulty: 0.9,
		});
		expect(decision.mode).toBe("skipped");
	});
});

describe("buildDeliberationPrompt", () => {
	it("asks for ambiguities, never a rewrite", () => {
		const prompt = buildDeliberationPrompt({ specText: "Build a login page.", stance: DELIBERATION_STANCES[0] });
		expect(prompt).toContain("will not rewrite the specification");
		expect(prompt).toContain("Naming the ambiguity is the entire job");
	});

	it("requires both readings to be plausible, excluding mere preferences", () => {
		const prompt = buildDeliberationPrompt({ specText: "x", stance: DELIBERATION_STANCES[1] });
		expect(prompt).toContain("Both readings must be PLAUSIBLE");
		expect(prompt).toContain("Do not list preferences");
	});
});

describe("parseDeliberationReply", () => {
	it("parses a two-reading ambiguity", () => {
		const parsed = parseDeliberationReply(
			"AMBIGUITY: what counts as a failed login | READINGS: any 4xx // only a wrong password",
			"pessimist",
		);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.readings).toHaveLength(2);
	});

	it("DROPS a single-reading claim — that is an opinion wearing an ambiguity's format", () => {
		expect(parseDeliberationReply("AMBIGUITY: the timeout is unclear | READINGS: should be 30s", "x")).toHaveLength(
			0,
		);
	});

	it("yields nothing for NO_AMBIGUITY or garbage rather than manufacturing a concern", () => {
		expect(parseDeliberationReply("NO_AMBIGUITY", "x")).toHaveLength(0);
		expect(parseDeliberationReply("I think it's mostly fine", "x")).toHaveLength(0);
		expect(parseDeliberationReply("", "x")).toHaveLength(0);
	});
});

describe("combineDeliberation", () => {
	const amb = (text: string, by: string) => ({
		ambiguity: text,
		readings: ["A", "B"],
		raisedBy: [by],
	});

	it("groups the same ambiguity raised by several deliberators", () => {
		const result = combineDeliberation({
			mode: "cross_family",
			perDeliberator: [
				{ raisedBy: "m1", ambiguities: [amb("What counts as a failed login", "m1")] },
				{ raisedBy: "m2", ambiguities: [amb("what counts as a failed login!", "m2")] },
			],
		});
		expect(result.disagreements).toHaveLength(1);
		expect(result.disagreements[0]?.raisedBy).toHaveLength(2);
	});

	it("renders a clarifying question per disagreement", () => {
		const result = combineDeliberation({
			mode: "cross_family",
			perDeliberator: [{ raisedBy: "m1", ambiguities: [amb("Retry policy", "m1")] }],
		});
		expect(result.clarifyingQuestions[0]).toContain("Retry policy");
		expect(result.clarifyingQuestions[0]).toContain("did you mean");
	});

	it("refuses to treat AGREEMENT as validation", () => {
		const result = combineDeliberation({
			mode: "cross_family",
			perDeliberator: [
				{ raisedBy: "m1", ambiguities: [] },
				{ raisedBy: "m2", ambiguities: [] },
			],
		});
		expect(result.disagreements).toHaveLength(0);
		expect(result.foundNothing).toBe(2);
		expect(result.agreementCaveat).toContain("weak evidence of clarity, not proof");
	});

	it("labels single-model stances as one model wearing hats", () => {
		const result = combineDeliberation({
			mode: "single_model_stances",
			perDeliberator: [{ raisedBy: "pessimist", ambiguities: [] }],
		});
		expect(result.agreementCaveat).toContain("ONE model wearing different hats");
	});
});

describe("parseDeliberationReply — real-output robustness (live-found 2026-07-20)", () => {
	it("parses an AMBIGUITY pair embedded in markdown prose and backticks", () => {
		// Verbatim shape from qwen3.6-27b: the payload is mid-line, inside backticks, under a bullet.
		const reply = [
			"   - *Ambiguity 4:* Block duration.",
			"   - *Ambiguity 4:* Block duration. `AMBIGUITY: How long a user remains blocked | READINGS: A fixed penalty duration // Until the rate limit window resets`",
		].join("\n");
		const parsed = parseDeliberationReply(reply, "pessimist");
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.ambiguity).toContain("How long a user remains blocked");
		expect(parsed[0]?.readings).toHaveLength(2);
	});

	it("strips markdown emphasis out of the captured text", () => {
		const parsed = parseDeliberationReply("AMBIGUITY: *the* `threshold` | READINGS: **A** // _B_", "x");
		expect(parsed[0]?.ambiguity).toBe("the threshold");
		expect(parsed[0]?.readings).toEqual(["A", "B"]);
	});
});

describe("parseDeliberationReply — template-echo guard (live-found 2026-07-20)", () => {
	it("DROPS the prompt's own format example when the model echoes it back", () => {
		// Verbatim from a live run: this produced a clarifying question asking the human to choose between
		// "<reading A>" and "<reading B>".
		const echoed = "AMBIGUITY: <what is underspecified> | READINGS: <reading A> // <reading B>";
		expect(parseDeliberationReply(echoed, "x")).toHaveLength(0);
	});

	it("still accepts a real finding alongside an echoed template", () => {
		const mixed = [
			"AMBIGUITY: <what is underspecified> | READINGS: <reading A> // <reading B>",
			"AMBIGUITY: block duration | READINGS: a fixed cooldown // exponential backoff",
		].join("\n");
		const parsed = parseDeliberationReply(mixed, "x");
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.ambiguity).toBe("block duration");
	});
});
