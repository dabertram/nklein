import { describe, expect, it } from "vitest";
import {
	KLEIN_CORPUS_DEFAULT_ORDER,
	type KleinCorpusDoc,
	type KleinSelfIntent,
	type KleinSelfIntentCue,
	routeKleinSelfCorpus,
} from "../../../src/core/klein-self-corpus-routing";

describe("routeKleinSelfCorpus — existing-feature questions route to done.md (§5.AH-A)", () => {
	it("'what features exist' leads with done", () => {
		const r = routeKleinSelfCorpus("What features exist in !Klein?");
		expect(r.intent).toBe("existing_feature");
		expect(r.lead).toBe("done");
		expect(r.ranked[0]).toBe("done");
		expect(r.basis).toBe("cue");
		expect(r.matchedSignals).toContain("what-features");
	});

	it("'does it support X' leads with done", () => {
		const r = routeKleinSelfCorpus("Does !Klein support parallel agent sessions?");
		expect(r.intent).toBe("existing_feature");
		expect(r.lead).toBe("done");
	});

	it("'how does <feature> work' leads with done (a feature explainer, not a how-we-work convention)", () => {
		const r = routeKleinSelfCorpus("How does the swarm scheduler work?");
		expect(r.intent).toBe("existing_feature");
		expect(r.lead).toBe("done");
		expect(r.matchedSignals).toContain("how-does-work");
	});

	it("'is X supported / a feature' leads with done", () => {
		const r = routeKleinSelfCorpus("Is model auto-selection a feature yet?");
		expect(r.intent).toBe("existing_feature");
		expect(r.lead).toBe("done");
	});
});

describe("routeKleinSelfCorpus — planned / known-issue questions route to todo.md (§5.AH-A)", () => {
	it("'is this a known bug' leads with todo", () => {
		const r = routeKleinSelfCorpus("Is the sluggish sidebar a known bug?");
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
		expect(r.matchedSignals).toContain("bug/issue");
	});

	it("'is Y planned / on the roadmap' leads with todo", () => {
		const r = routeKleinSelfCorpus("Is self-development planned on the roadmap?");
		expect(r.intent).toBe("future_fit");
		expect(r.lead).toBe("todo");
		expect(r.matchedSignals).toContain("planned");
	});

	it("'would idea Z fit' leads with todo", () => {
		const r = routeKleinSelfCorpus("Would it make sense to add a graph view — would that fit?");
		expect(r.intent).toBe("future_fit");
		expect(r.lead).toBe("todo");
	});

	it("'broken / not working' is a known-issue → todo", () => {
		const r = routeKleinSelfCorpus("Why is the git diff view broken for merge commits?");
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
		expect(r.matchedSignals).toContain("broken");
	});

	it("a limitation / caveat question → todo", () => {
		const r = routeKleinSelfCorpus("What is the main limitation of the small-model path?");
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
	});
});

describe("routeKleinSelfCorpus — how-we-work / release / architecture routing", () => {
	it("'conventions / working mode' leads with agents", () => {
		const r = routeKleinSelfCorpus("What are the working-mode conventions for this repo?");
		expect(r.intent).toBe("how_we_work");
		expect(r.lead).toBe("agents");
		expect(r.matchedSignals).toContain("conventions");
	});

	it("'why is it done this way' leads with agents", () => {
		const r = routeKleinSelfCorpus("Why do we keep pure cores separate from I/O?");
		expect(r.intent).toBe("how_we_work");
		expect(r.lead).toBe("agents");
	});

	it("'when did X ship / changelog' leads with changelog", () => {
		const r = routeKleinSelfCorpus("When did the git history view ship?");
		expect(r.intent).toBe("release_history");
		expect(r.lead).toBe("changelog");
		expect(r.matchedSignals).toContain("release-history");
	});

	it("'architecture / where does X live' leads with docs", () => {
		const r = routeKleinSelfCorpus("What is the overall architecture of the runtime?");
		expect(r.intent).toBe("architecture");
		expect(r.lead).toBe("docs");
		expect(r.matchedSignals).toContain("architecture");
	});
});

describe("routeKleinSelfCorpus — priority resolution when multiple intents fire", () => {
	it("'is <feature> broken' resolves to known_issue over existing_feature (most-specific wins)", () => {
		// Mentions a feature AND a bug — the bug cue is higher priority, so it routes to the backlog, not the catalog.
		const r = routeKleinSelfCorpus("Is the auto-clarify feature broken or does it work?");
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
		// Both cue families fired and are recorded, but the verdict is the higher-priority one.
		expect(r.matchedSignals).toContain("broken");
	});

	it("known_issue outranks future_fit when both cue families fire", () => {
		const r = routeKleinSelfCorpus("Is the planned roadmap item actually a known bug already?");
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
	});

	it("existing_feature outranks how_we_work when both fire", () => {
		// "what features" (existing_feature, rank 2) beats "why do we" (how_we_work, rank 3).
		const r = routeKleinSelfCorpus("What features exist and why do we build them that way?");
		expect(r.intent).toBe("existing_feature");
		expect(r.lead).toBe("done");
	});
});

describe("routeKleinSelfCorpus — unknown / default fallback", () => {
	it("no cue → unknown intent with the spec default order (done → todo → …)", () => {
		const r = routeKleinSelfCorpus("Tell me about yourself.");
		expect(r.intent).toBe("unknown");
		expect(r.basis).toBe("default");
		expect(r.matchedSignals).toEqual([]);
		expect(r.ranked).toEqual([...KLEIN_CORPUS_DEFAULT_ORDER]);
		expect(r.lead).toBe("done");
	});

	it("empty / whitespace question → unknown default", () => {
		expect(routeKleinSelfCorpus("").intent).toBe("unknown");
		expect(routeKleinSelfCorpus("   \n\t ").intent).toBe("unknown");
		expect(routeKleinSelfCorpus("").ranked).toEqual([...KLEIN_CORPUS_DEFAULT_ORDER]);
	});

	it("nullish question is guarded (defaults to unknown, does not throw)", () => {
		// Exercise a nullish arg the type forbids (`as unknown as string`), to prove the `?? ""` guard holds.
		expect(() => routeKleinSelfCorpus(undefined as unknown as string)).not.toThrow();
		expect(routeKleinSelfCorpus(null as unknown as string).intent).toBe("unknown");
	});
});

describe("routeKleinSelfCorpus — full ranking shape", () => {
	it("ranked always contains every corpus doc exactly once, led by the intent doc", () => {
		const intents: { q: string; lead: KleinCorpusDoc }[] = [
			{ q: "what features exist", lead: "done" },
			{ q: "is this a known bug", lead: "todo" },
			{ q: "would that fit the roadmap", lead: "todo" },
			{ q: "what are the conventions", lead: "agents" },
			{ q: "when did it ship (changelog)", lead: "changelog" },
			{ q: "what is the architecture", lead: "docs" },
			{ q: "tell me about it", lead: "done" }, // unknown default
		];
		for (const { q, lead } of intents) {
			const r = routeKleinSelfCorpus(q);
			expect(r.ranked[0]).toBe(lead);
			expect(r.lead).toBe(lead);
			// A permutation of the full corpus: same members, no duplicates.
			expect([...r.ranked].sort()).toEqual([...KLEIN_CORPUS_DEFAULT_ORDER].sort());
			expect(new Set(r.ranked).size).toBe(r.ranked.length);
		}
	});
});

describe("routeKleinSelfCorpus — explicit intent override", () => {
	it("honours an explicit intent and does not consult cues (basis=explicit, no signals)", () => {
		// The text screams "existing_feature" but the override forces known_issue.
		const r = routeKleinSelfCorpus("what features exist and how does it work", { intent: "known_issue" });
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
		expect(r.basis).toBe("explicit");
		expect(r.matchedSignals).toEqual([]);
	});

	it("explicit unknown gives the default order", () => {
		const r = routeKleinSelfCorpus("is this a known bug", { intent: "unknown" });
		expect(r.intent).toBe("unknown");
		expect(r.lead).toBe("done");
		expect(r.ranked).toEqual([...KLEIN_CORPUS_DEFAULT_ORDER]);
	});
});

describe("routeKleinSelfCorpus — availableDocs filtering", () => {
	it("filters the ranking to the available docs, preserving relevance order", () => {
		// existing_feature would lead with done, but done isn't indexed → todo leads (next-ranked available doc).
		const r = routeKleinSelfCorpus("what features exist", { availableDocs: ["todo", "agents", "docs"] });
		expect(r.intent).toBe("existing_feature");
		expect(r.ranked).toEqual(["todo", "agents", "docs"]);
		expect(r.lead).toBe("todo");
	});

	it("keeps the intent's lead doc first when it IS available", () => {
		const r = routeKleinSelfCorpus("is this a known bug", { availableDocs: ["done", "todo"] });
		expect(r.ranked).toEqual(["todo", "done"]);
		expect(r.lead).toBe("todo");
	});

	it("empty availableDocs → empty ranking + lead null + a no-corpus rationale", () => {
		const r = routeKleinSelfCorpus("what features exist", { availableDocs: [] });
		expect(r.ranked).toEqual([]);
		expect(r.lead).toBeNull();
		expect(r.intent).toBe("existing_feature"); // intent is still classified
		expect(r.rationale).toMatch(/no planning-corpus document/i);
	});

	it("a single available doc yields exactly that doc", () => {
		const r = routeKleinSelfCorpus("tell me anything", { availableDocs: ["agents"] });
		expect(r.ranked).toEqual(["agents"]);
		expect(r.lead).toBe("agents");
	});
});

describe("routeKleinSelfCorpus — extra cues", () => {
	it("an extra cue can classify a phrase the built-ins miss", () => {
		const extra: KleinSelfIntentCue[] = [{ pattern: /\bpricing\b/i, intent: "architecture", signal: "pricing-ref" }];
		const r = routeKleinSelfCorpus("where is pricing documented", { extraCues: extra });
		// Both the built-in "where is" (architecture) and the extra fire; verdict is architecture either way.
		expect(r.intent).toBe("architecture");
		expect(r.lead).toBe("docs");
	});

	it("an extra cue for a higher-priority intent wins over a built-in lower-priority match", () => {
		// Built-in classifies as existing_feature; the extra cue raises it to known_issue (higher priority).
		const extra: KleinSelfIntentCue[] = [{ pattern: /\bflaky\b/i, intent: "known_issue", signal: "flaky" }];
		const r = routeKleinSelfCorpus("does the flaky feature work", { extraCues: extra });
		expect(r.intent).toBe("known_issue");
		expect(r.lead).toBe("todo");
		expect(r.matchedSignals).toContain("flaky");
	});
});

describe("routeKleinSelfCorpus — determinism & non-mutation", () => {
	it("is deterministic: identical inputs give a deeply-equal result across calls", () => {
		const q = "Is the auto-clarify feature broken and is a fix planned?";
		const a = routeKleinSelfCorpus(q);
		const b = routeKleinSelfCorpus(q);
		expect(a).toEqual(b);
	});

	it("is case-insensitive and whitespace-insensitive", () => {
		const a = routeKleinSelfCorpus("WHAT FEATURES EXIST");
		const b = routeKleinSelfCorpus("what    features\n\texist");
		expect(a.intent).toBe(b.intent);
		expect(a.lead).toBe(b.lead);
	});

	it("does not mutate the injected availableDocs / extraCues arrays", () => {
		const availableDocs: KleinCorpusDoc[] = ["todo", "done"];
		const availableSnapshot = [...availableDocs];
		const extraCues: KleinSelfIntentCue[] = [{ pattern: /\bfoo\b/i, intent: "architecture", signal: "foo" }];
		const extraSnapshot = [...extraCues];
		routeKleinSelfCorpus("what features exist foo", { availableDocs, extraCues });
		expect(availableDocs).toEqual(availableSnapshot);
		expect(extraCues).toEqual(extraSnapshot);
	});

	it("returns fresh arrays each call (mutating the result does not affect later calls)", () => {
		const first = routeKleinSelfCorpus("what features exist");
		first.ranked.push("agents");
		first.matchedSignals.push("tampered");
		const second = routeKleinSelfCorpus("what features exist");
		expect(second.ranked).toEqual(["done", "todo", "agents", "changelog", "docs"]);
		expect(second.matchedSignals).not.toContain("tampered");
	});

	it("every intent maps to a lead doc that is a member of the default corpus order", () => {
		const allIntents: KleinSelfIntent[] = [
			"known_issue",
			"future_fit",
			"existing_feature",
			"how_we_work",
			"release_history",
			"architecture",
			"unknown",
		];
		for (const intent of allIntents) {
			const r = routeKleinSelfCorpus("anything", { intent });
			expect(r.lead).not.toBeNull();
			expect(KLEIN_CORPUS_DEFAULT_ORDER).toContain(r.lead as KleinCorpusDoc);
		}
	});
});
