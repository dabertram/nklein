import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildInvariantCatalog,
	buildSpecRequirementSpine,
	citedInvariantIds,
	requirementClosure,
	resolveCharteredInvariant,
	SPEC_INVARIANT_CHARTER,
	verifyInvariantCharter,
} from "../../../src/core/spec-requirement-spine";

/**
 * P23.7's "traceability spine", which the item recorded as impossible to derive.
 *
 * That conclusion came from a real measurement — ZERO RFC-2119 keywords across 25,059 words — and generalised too
 * far. The requirement UNIT here is not a sentence but a CARD, and the card grammar is perfectly regular. These
 * tests pin both the grammar and the properties that make it a spine rather than a list.
 */

const SPEC_PATH = "dev-test-projects/36_dark_factory_dschinn_universal_agent/specification.md";

const SAMPLE = `
Some prose that mentions \`S01\` but is not a card.

**\`S01\` — Repo + tooling skeleton.** dependsOn: none. files: \`package.json\`, \`tsconfig.json\`.
how to implement: create the package.
acceptance: \`npm test\` green. invariant: **none (enables all).**

**\`S02\` — Virtual clock.** dependsOn: \`S01\`. files: \`src/kernel/clock.ts\`.
acceptance: advance(5) moves now 0→5. invariant: **Determinism (E11.7 / V1).**
`;

describe("buildSpecRequirementSpine", () => {
	it("extracts id, title, dependencies, files, acceptance and invariant", () => {
		const spine = buildSpecRequirementSpine(SAMPLE);
		expect(spine.cards.map((card) => card.id)).toEqual(["S01", "S02"]);
		const [first, second] = spine.cards;
		expect(first?.title).toBe("Repo + tooling skeleton");
		expect(first?.files).toEqual(["package.json", "tsconfig.json"]);
		expect(second?.dependsOn).toEqual(["S01"]);
		expect(second?.invariant).toBe("Determinism (E11.7 / V1)");
	});

	it("reads `dependsOn: none` as NO dependency, not as a card named none", () => {
		expect(buildSpecRequirementSpine(SAMPLE).cards[0]?.dependsOn).toEqual([]);
	});

	it("does not treat prose mentioning a card id as a card", () => {
		// The header regex is anchored at line start for exactly this reason; the sample's first line names `S01`.
		expect(buildSpecRequirementSpine(SAMPLE).cards).toHaveLength(2);
	});

	it("keeps ACCEPTANCE whole when it shares a line with invariant — the truncation this format invites", () => {
		// Fields are not line-delimited. Reading acceptance to end-of-line would silently drop it on nearly every
		// card, and the spine would look complete while carrying no discharging tests.
		const spine = buildSpecRequirementSpine(SAMPLE);
		expect(spine.cards[1]?.acceptance).toBe("advance(5) moves now 0→5.");
		expect(spine.cards[1]?.acceptance).not.toContain("invariant");
	});

	it("reports an unresolved dependency as an ISSUE rather than dropping the edge", () => {
		const spine = buildSpecRequirementSpine("**`S02` — B.** dependsOn: `S99`. acceptance: x. invariant: **I.**");
		expect(spine.issues.map((issue) => issue.kind)).toContain("unresolved_dependency");
	});

	it("distinguishes UNKNOWN dependencies from NO dependencies", () => {
		// `dependsOn: most prior.` names no ids. Silently yielding [] would promote the card to a root and put it
		// FIRST in the build order — precisely inverting what it declares.
		const spine = buildSpecRequirementSpine("**`S02` — B.** dependsOn: most prior. acceptance: x. invariant: **I.**");
		expect(spine.issues.map((issue) => issue.kind)).toContain("unparseable_dependency");
		expect(spine.cards[0]?.unparseableDependsOn).toBe("most prior.");
	});

	it("does not flag `dependsOn: none` as unparseable", () => {
		const spine = buildSpecRequirementSpine(SAMPLE);
		expect(spine.issues.filter((issue) => issue.kind === "unparseable_dependency")).toEqual([]);
	});

	it("flags a duplicate id", () => {
		const doc =
			"**`S01` — A.** dependsOn: none. acceptance: x. invariant: **I.**\n**`S01` — B.** dependsOn: none. acceptance: y. invariant: **J.**";
		expect(buildSpecRequirementSpine(doc).issues.map((issue) => issue.kind)).toContain("duplicate_id");
	});

	it("flags a card with no acceptance test when the document ESTABLISHES acceptance", () => {
		const doc = `
**\`S01\` — A.** dependsOn: none. acceptance: x. invariant: **I.**
**\`S02\` — B.** dependsOn: none. acceptance: y. invariant: **I.**
**\`S03\` — C.** dependsOn: none. invariant: **I.**
`;
		const issues = buildSpecRequirementSpine(doc).issues.filter((issue) => issue.kind === "missing_acceptance");
		expect(issues.map((issue) => issue.cardId)).toEqual(["S03"]);
	});

	it("does NOT flag a document that never established the convention", () => {
		// Judging every spec by one spec's style reported 441 "gaps" across `dev-test-projects/`, nearly all of them
		// documents that simply never adopted `invariant:`. A field is missing only where its own document expects it.
		const doc = "**`S01` — A.** dependsOn: none.\n**`S02` — B.** dependsOn: none.";
		const kinds = buildSpecRequirementSpine(doc).issues.map((issue) => issue.kind);
		expect(kinds).not.toContain("missing_acceptance");
		expect(kinds).not.toContain("missing_invariant");
	});

	it("treats a lone outlier as an EXTRA, not as evidence the other cards are deficient", () => {
		// Measured: two specs carry `invariant:` on 2-of-38 and 1-of-18 cards. Under an "any card uses it" rule
		// those became 36 and 17 false gaps. A convention is established by MAJORITY.
		const doc = `
**\`S01\` — A.** dependsOn: none. acceptance: x. invariant: **I.**
**\`S02\` — B.** dependsOn: none. acceptance: y.
**\`S03\` — C.** dependsOn: none. acceptance: z.
`;
		expect(buildSpecRequirementSpine(doc).issues.filter((issue) => issue.kind === "missing_invariant")).toEqual([]);
	});

	it("orders cards by dependency", () => {
		const spine = buildSpecRequirementSpine(SAMPLE);
		expect(spine.topologicalOrder.indexOf("S01")).toBeLessThan(spine.topologicalOrder.indexOf("S02"));
	});

	it("reports a CYCLE and refuses to emit an order, rather than emitting a partial one", () => {
		// A partial order is worse than none: it reads as a complete build sequence while silently omitting cards.
		const doc =
			"**`S01` — A.** dependsOn: `S02`. acceptance: x. invariant: **I.**\n**`S02` — B.** dependsOn: `S01`. acceptance: y. invariant: **J.**";
		const spine = buildSpecRequirementSpine(doc);
		expect(spine.issues.map((issue) => issue.kind)).toContain("dependency_cycle");
		expect(spine.topologicalOrder).toEqual([]);
	});

	it("says plainly when the grammar matched nothing", () => {
		// A silent empty spine would look like a clean document. It means "this grammar did not match", nothing more.
		expect(buildSpecRequirementSpine("# Just prose\n\nNo cards here.").summary).toMatch(/says nothing about/u);
	});
});

describe("requirementClosure", () => {
	it("returns the card and its transitive dependencies, dependencies first", () => {
		const doc = `
**\`S01\` — A.** dependsOn: none. acceptance: x. invariant: **I.**
**\`S02\` — B.** dependsOn: \`S01\`. acceptance: x. invariant: **I.**
**\`S03\` — C.** dependsOn: \`S02\`. acceptance: x. invariant: **I.**
`;
		expect(requirementClosure(buildSpecRequirementSpine(doc), "S03")).toEqual(["S01", "S02", "S03"]);
	});

	it("returns empty for an unknown card rather than inventing one", () => {
		expect(requirementClosure(buildSpecRequirementSpine(SAMPLE), "S99")).toEqual([]);
	});

	it("terminates on a cycle", () => {
		const doc =
			"**`S01` — A.** dependsOn: `S02`. acceptance: x. invariant: **I.**\n**`S02` — B.** dependsOn: `S01`. acceptance: y. invariant: **J.**";
		expect(requirementClosure(buildSpecRequirementSpine(doc), "S01")).toHaveLength(2);
	});
});

describe("the real specification — the spine P23.7 said could not be derived", () => {
	const spine = buildSpecRequirementSpine(readFileSync(SPEC_PATH, "utf8"));

	it("extracts all 51 cards", () => {
		// Pinned: a parser that silently matched fewer would still look like it worked, which is the failure mode
		// the item's own "a keyword extractor would return an empty index while looking like it worked" warns about.
		expect(spine.cards).toHaveLength(51);
		expect(spine.cards[0]?.id).toBe("S01");
		expect(spine.cards.at(-1)?.id).toBe("S51");
	});

	it("resolves EVERY dependency — the document's task graph is internally consistent", () => {
		expect(spine.issues.filter((issue) => issue.kind === "unresolved_dependency")).toEqual([]);
		expect(spine.issues.filter((issue) => issue.kind === "duplicate_id")).toEqual([]);
	});

	it("is acyclic, so the spec yields a real build order", () => {
		expect(spine.issues.filter((issue) => issue.kind === "dependency_cycle")).toEqual([]);
		expect(spine.topologicalOrder).toHaveLength(51);
		expect(spine.topologicalOrder[0]).toBe("S01");
	});

	it("does not advise building S49 early just because its dependencies are UNREADABLE", () => {
		// Plain Kahn saw zero known dependencies and emitted S49 second — telling an agent to build the public API
		// barrel before the code behind it. Unknown is deferred, not treated as none.
		expect(spine.topologicalOrder.indexOf("S49")).toBeGreaterThan(40);
	});

	it("gives every card an acceptance test", () => {
		// Part of what makes it a TRACEABILITY spine: each requirement names what discharges it.
		expect(spine.issues.filter((issue) => issue.kind === "missing_acceptance")).toEqual([]);
	});

	it("finds S49 — the ONE card with no named invariant — and nothing else", () => {
		// A real gap in the document, not a parser miss: S49 ("Index barrel + public API surface") ends at
		// `acceptance: typecheck + existing tests still green.` with no `invariant:` at all. 50 of 51 cards name one,
		// which is exactly the kind of single hole a spine exists to surface and prose review never would.
		expect(spine.issues.filter((issue) => issue.kind === "missing_invariant").map((issue) => issue.cardId)).toEqual([
			"S49",
		]);
	});

	it("refuses to read S49's `dependsOn: most prior` as NO dependencies", () => {
		// The parser's own near-miss, caught by the fixture: prose where ids were expected yields zero ids, so S49
		// would have read as a ROOT card — the opposite of what it says — and the build order would have placed it
		// first. Unknown must never render as absent.
		const unparseable = spine.issues.filter((issue) => issue.kind === "unparseable_dependency");
		expect(unparseable.map((issue) => issue.cardId)).toEqual(["S49"]);
		expect(unparseable[0]?.detail).toContain("most prior");
	});

	it("makes progressive disclosure concrete: a mid-graph card needs a handful of cards, not 24k words", () => {
		// P23.7's whole complaint is that the spec says "read the entire specification before planning" against a
		// 32k context. The closure is the answer to that in numbers.
		const closure = requirementClosure(spine, "S12");
		expect(closure.at(-1)).toBe("S12");
		expect(closure.length).toBeLessThan(12);
	});
});

/**
 * The invariant catalog — the half of traceability that no text search can reach.
 *
 * A card cites `invariant: **Determinism (E11.7 / V1)**`. Searching the document for "E11.7" near a definition
 * finds nothing, because THE ID NEVER APPEARS AT ITS OWN DEFINITION SITE: `## E11` holds a numbered list and the
 * sub-id is the list POSITION. `## V8` ("extends E11") continues the same list from 8. An earlier pass concluded
 * 13 of 33 cited invariants were "undefined" purely because every textual grammar misses an implied identifier.
 */
describe("buildInvariantCatalog", () => {
	const SECTIONS = `
## E11. The meta-test harness: global invariants

1. **Conservation of money** — sums balance.
2. **Totality of audit** — every side effect has one audit event.
7. **Determinism** — same seed, same log.

## V8. Global invariants, v3 (extends E11)

8. **Capability soundness (V5).** Every side effect traces to a valid token.

## E12. Something else

1. **Not an invariant** — a numbered list in an unrelated section.
`;

	it("composes the id from SECTION + ORDINAL, never from the text", () => {
		const catalog = buildInvariantCatalog(SECTIONS);
		expect(catalog.find((entry) => entry.id === "E11.7")?.name).toBe("Determinism");
		expect(catalog.find((entry) => entry.id === "E11.2")?.name).toBe("Totality of audit");
	});

	it("continues the numbering into V8, which is why cards cite V8.8 and not V8.1", () => {
		expect(buildInvariantCatalog(SECTIONS).find((entry) => entry.id === "V8.8")?.name).toBe("Capability soundness");
	});

	it("does NOT harvest numbered lists from unrelated sections", () => {
		// `## E12` is prose with a list; treating it as a catalog would mint a phantom `E12.1` invariant. Catalogs
		// are recognised by the heading SAYING "invariants", not by the id shape — `E12.` matches that shape too.
		expect(buildInvariantCatalog(SECTIONS).some((entry) => entry.id === "E12.1")).toBe(false);
	});

	it("resolves a BOLDED-BULLET id, the fourth form", () => {
		// `- **V6.2 The reward-hacking / objective-hacking detector.**` — id inline, no parentheses. The earlier
		// "definition bullet" grammar required `- **Name (ID):**` and so missed every one of these.
		const catalog = buildInvariantCatalog("- **V6.2 The reward-hacking detector.** Because DGM fabricated a log.\n");
		expect(catalog.find((entry) => entry.id === "V6.2")?.name).toContain("reward-hacking");
	});

	it("also resolves a SUBSECTION-heading id, which has no trailing dot", () => {
		// `### V3.3 The deterministic !Klein fixture` — a dot-requiring heading regex misses these entirely, which
		// is why V3.3 and V6.2 previously read as undefined.
		const catalog = buildInvariantCatalog("### V3.3 The deterministic !Klein fixture\n");
		expect(catalog.find((entry) => entry.id === "V3.3")?.name).toContain("deterministic");
	});

	it("strips a trailing citation from the name", () => {
		expect(buildInvariantCatalog(SECTIONS).find((entry) => entry.id === "V8.8")?.name).not.toContain("V5");
	});
});

describe("the real specification — every cited invariant resolves", () => {
	const markdown = readFileSync(SPEC_PATH, "utf8");
	const spine = buildSpecRequirementSpine(markdown);
	const catalog = buildInvariantCatalog(markdown);

	it("resolves the ordinal invariants the cards actually cite", () => {
		const byId = new Map(catalog.map((entry) => [entry.id, entry]));
		expect(byId.get("E11.7")?.name).toBe("Determinism");
		expect(byId.get("E11.2")?.name).toBe("Totality of audit");
		expect(byId.get("E11.5")?.name).toContain("Taint monotonicity");
		expect(byId.get("V8.8")?.name).toContain("Capability soundness");
	});

	it("covers EVERY sub-numbered invariant the 51 cards cite — the 13 previously called undefined", () => {
		// Sub-ids (`E11.7`, `V8.8`) are the ones only this convention reaches; top-level ids (`E1`, `V1`) are
		// ordinary section headings and were never the gap.
		const byId = new Set(catalog.map((entry) => entry.id));
		const citedSubIds = new Set(
			spine.cards.flatMap((card) => citedInvariantIds(card)).filter((id) => id.includes(".")),
		);
		expect([...citedSubIds].filter((id) => !byId.has(id))).toEqual([]);
		expect(citedSubIds.size).toBeGreaterThanOrEqual(13);
	});

	it("shows the ids are POSITIONAL — the fragility worth acting on", () => {
		// Each ordinal id is section + list position, so inserting one item renumbers everything below it and
		// silently re-points every card that cites them. No test fails; the references quietly mean something else.
		const determinism = catalog.find((entry) => entry.id === "E11.7");
		expect(determinism?.name).toBe("Determinism");
		expect(determinism?.ordinal).toBe(7);
		expect(determinism?.id).toBe(`${determinism?.sectionId}.${determinism?.ordinal}`);
	});
});

describe("the invariant charter — P23.7's remaining ask", () => {
	const markdown = readFileSync(SPEC_PATH, "utf8");

	it("charters exactly the 13 positional invariants, and nothing with a written id", () => {
		const catalog = buildInvariantCatalog(markdown);
		const positional = new Set(catalog.filter((d) => d.idSource === "positional").map((d) => d.id));
		const chartered = SPEC_INVARIANT_CHARTER.map((entry) => entry.positionalId);
		expect(chartered).toHaveLength(13);
		// V3.3 and V6.2 carry sub-numbers too, but their ids are WRITTEN at the definition, so they survive a
		// renumber on their own. Chartering them would overstate the fragile set.
		for (const id of chartered) {
			expect(positional.has(id)).toBe(true);
		}
		expect(new Set(SPEC_INVARIANT_CHARTER.map((e) => e.stableId)).size).toBe(13);
	});

	it("resolves cleanly against the live specification", () => {
		expect(verifyInvariantCharter(markdown)).toEqual([]);
	});

	it("FIRES when a list item is inserted and every invariant below it renumbers", () => {
		// The exact silent failure the charter exists to catch. Inserting an item under `## E11` shifts
		// Determinism from 7 to 8, so `E11.7` still resolves — it just quietly means something else now.
		const renumbered = markdown.replace(
			/^6\.\s+\*\*Reviewability\*\*/mu,
			"6. **Freshly inserted invariant** — pushed everything below it down one.\n7. **Reviewability**",
		);
		expect(renumbered).not.toBe(markdown); // the fixture still has the line this test edits

		const drift = verifyInvariantCharter(renumbered);
		expect(drift.length).toBeGreaterThan(0);
		const determinism = drift.find((d) => d.stableId === "INV-DETERMINISM");
		expect(determinism?.kind).toBe("renumbered");
		if (determinism?.kind === "renumbered") {
			// Loud AND specific: it names what the citation used to mean and what it means now.
			expect(determinism.charteredName).toBe("Determinism");
			expect(determinism.currentName).not.toBe("Determinism");
		}
	});

	it("reports a chartered invariant that disappeared entirely", () => {
		const deleted = markdown.replace(/^7\.\s+\*\*Determinism\*\*.*$/mu, "");
		const drift = verifyInvariantCharter(deleted);
		expect(drift.some((d) => d.stableId === "INV-DETERMINISM")).toBe(true);
	});

	it("maps a durable handle back to the position that currently holds it", () => {
		expect(resolveCharteredInvariant("INV-DETERMINISM")?.positionalId).toBe("E11.7");
		expect(resolveCharteredInvariant("INV-NOT-A-REAL-ONE")).toBeNull();
	});
});
