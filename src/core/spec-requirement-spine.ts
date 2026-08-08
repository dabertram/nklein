/**
 * The TRACEABILITY SPINE P23.7 asks for first: every requirement in an over-long spec, with a stable id, its
 * dependencies, and the test that discharges it. PURE core.
 *
 * ── WHY THIS EXISTS, AND WHY THE EARLIER ANSWER WAS "IMPOSSIBLE" ──
 * P23.7 recorded that the spine "CANNOT BE EXTRACTED … The document contains ZERO RFC-2119 keywords: not one MUST,
 * SHALL, SHOULD or MAY across 25,059 words … The spine has to be AUTHORED, not derived."
 *
 * The measurement was correct and the conclusion was too broad. It searched for requirement MODALITY and found none.
 * But the requirement UNIT in this document is not a sentence — it is a **card**, and the card grammar is perfectly
 * regular: 51 cards (`S01`…`S51`), **100% of which carry `dependsOn:`**, plus `files:`, `acceptance:` and a named
 * `invariant:`. That is a stronger spine than RFC-2119 prose would have given, because it carries the dependency
 * edges and the discharging test as DATA rather than as narrative.
 *
 * The lesson generalises: "this cannot be derived" is a claim about the grammar you looked for, not about the
 * document. Before concluding a spec is unstructured, ask what its author actually used as the unit of work.
 *
 * ── ADDITIVE, LIKE THE SECTION INDEX ──
 * The specification is a TEST FIXTURE whose size is part of what it measures ("this specification is itself a
 * context benchmark"). Rewriting it would change the test instead of passing it. This reads it and produces an
 * index; the fixture is never touched.
 *
 * ── WHAT IT IS FOR ──
 * With the spine, an agent working card `S12` retrieves S12 and its transitive dependencies — a few hundred words —
 * instead of the 24k-word document the spec's own prose tells it to read. That is progressive disclosure with
 * traceability: every retrieved unit names the invariant it serves and the acceptance test that proves it.
 */

export interface SpecRequirementCard {
	/** Stable id as authored (`S01`). Cited in plans and cards; survives unrelated edits to the document. */
	readonly id: string;
	readonly title: string;
	/** Ids this card depends on, in document order. Empty for a root card (`dependsOn: none`). */
	readonly dependsOn: readonly string[];
	/** Files the card declares it creates or changes — the file-overlap signal a scheduler can serialize on. */
	readonly files: readonly string[];
	/** The acceptance test text: what discharges this requirement. Null when the card omits it. */
	readonly acceptance: string | null;
	/** The named invariant this card serves, e.g. "Determinism (E11.7 / V1)". Null when the card omits it. */
	readonly invariant: string | null;
	/** The raw `dependsOn:` text when it could not be read as ids — kept so the issue can quote what it saw. */
	readonly unparseableDependsOn?: string;
}

export interface SpecSpineIssue {
	readonly kind:
		| "duplicate_id"
		| "unresolved_dependency"
		| "dependency_cycle"
		| "missing_acceptance"
		| "missing_invariant"
		/**
		 * `dependsOn:` says something other than `none` or a backticked list — the real spec has
		 * `dependsOn: most prior.` on S49. Without this the value yields zero ids and the card reads as a ROOT,
		 * which is the opposite of what it says. An unreadable dependency must never look like no dependency.
		 */
		| "unparseable_dependency";
	readonly cardId: string;
	readonly detail: string;
}

export interface SpecRequirementSpine {
	readonly cards: readonly SpecRequirementCard[];
	readonly issues: readonly SpecSpineIssue[];
	/** Card ids in dependency order; empty when a cycle makes the order undefined. */
	readonly topologicalOrder: readonly string[];
	readonly summary: string;
}

/** Opens a card: `**` + backticked id + em-dash + title + `.**`. Anchored at line start so prose cannot match. */
const CARD_HEADER = /^\*\*`(S\d+)`\s*—\s*([\s\S]*?)\.?\*\*/u;
const CARD_HEADER_GLOBAL = /^\*\*`S\d+`\s*—/gmu;

/** Backticked identifiers inside a field value: `` `S03`, `S04` `` or `` `package.json` ``. */
function backticked(value: string): string[] {
	return [...value.matchAll(/`([^`]+)`/gu)].map((match) => match[1] as string);
}

/**
 * Read one labelled field out of a card block.
 *
 * Fields are NOT line-delimited — `acceptance:` and `invariant:` routinely share a line — so a value runs to the
 * next known label rather than to the next newline. Reading to end-of-line would silently truncate `acceptance` on
 * every card that pairs them, which is most of them.
 */
function field(block: string, label: string): string | null {
	const labels = [
		"dependsOn",
		"files",
		"interface",
		"how to implement",
		"how to implement \\(guard\\)",
		"acceptance",
		"invariant",
	];
	const stop = labels.filter((other) => other !== label).join(":|");
	const match = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=(?:${stop}:)|$)`, "u").exec(block);
	return match ? (match[1] as string).trim() : null;
}

function parseCardBlock(block: string): SpecRequirementCard | null {
	const header = CARD_HEADER.exec(block);
	if (!header) {
		return null;
	}
	const dependsOnRaw = field(block, "dependsOn");
	const filesRaw = field(block, "files");
	const acceptance = field(block, "acceptance");
	const invariant = field(block, "invariant");
	// "none" is the authored spelling for a root card; treating it as an id would invent a phantom dependency.
	const declaresNone = dependsOnRaw === null || /^none\b/iu.test(dependsOnRaw);
	const dependsOn = declaresNone ? [] : backticked(dependsOnRaw);
	return {
		id: header[1] as string,
		title: (header[2] as string).replace(/\s+/gu, " ").trim(),
		dependsOn,
		// Prose where ids were expected ("most prior") parses to nothing. Recording the raw text is what lets the
		// caller distinguish "no dependencies" from "dependencies this grammar could not read".
		...(declaresNone || dependsOn.length > 0
			? {}
			: { unparseableDependsOn: dependsOnRaw.replace(/\s+/gu, " ").trim() }),
		files: filesRaw ? backticked(filesRaw) : [],
		acceptance: acceptance && acceptance.length > 0 ? acceptance.replace(/\s+/gu, " ").trim() : null,
		invariant:
			invariant && invariant.length > 0
				? invariant
						.replace(/[*\s]+/gu, " ")
						.replace(/\.\s*$/u, "")
						.trim()
				: null,
	};
}

/** Split the document at card headers; everything before the first header is prose and is discarded. */
function cardBlocks(markdown: string): string[] {
	const starts = [...markdown.matchAll(CARD_HEADER_GLOBAL)].map((match) => match.index as number);
	return starts.map((start, index) => markdown.slice(start, starts[index + 1] ?? markdown.length));
}

export function buildSpecRequirementSpine(markdown: string): SpecRequirementSpine {
	const cards = cardBlocks(markdown)
		.map(parseCardBlock)
		.filter((card): card is SpecRequirementCard => card !== null);

	// Which conventions THIS document actually establishes — by MAJORITY, not by existence.
	//
	// Measured across the 18 card-grammar specs in `dev-test-projects/`: judging every document by one document's
	// style reported 441 "gaps", nearly all of them specs that never adopted `invariant:` at all. Relaxing to
	// "any card uses it" still mis-read two specs where 2-of-38 and 1-of-18 cards carry the field — those two are
	// outliers, not evidence that the other 36 are deficient. A convention is established when MOST cards follow
	// it; below that, the odd card carrying a field is an extra, and its absence elsewhere is not a defect.
	const establishes = (has: (card: SpecRequirementCard) => boolean): boolean =>
		cards.length > 0 && cards.filter(has).length * 2 > cards.length;
	const usesInvariants = establishes((card) => card.invariant !== null);
	const usesAcceptance = establishes((card) => card.acceptance !== null);

	const issues: SpecSpineIssue[] = [];
	const byId = new Map<string, SpecRequirementCard>();
	for (const card of cards) {
		if (byId.has(card.id)) {
			issues.push({ kind: "duplicate_id", cardId: card.id, detail: `${card.id} is declared more than once` });
			continue;
		}
		byId.set(card.id, card);
	}
	for (const card of cards) {
		for (const dependency of card.dependsOn) {
			if (!byId.has(dependency)) {
				// A dangling edge is a defect in the SPEC, not in this parser — surface it rather than dropping it.
				issues.push({
					kind: "unresolved_dependency",
					cardId: card.id,
					detail: `${card.id} depends on ${dependency}, which no card declares`,
				});
			}
		}
		if (card.unparseableDependsOn !== undefined) {
			issues.push({
				kind: "unparseable_dependency",
				cardId: card.id,
				detail: `${card.id} declares dependsOn: "${card.unparseableDependsOn}" — not \`none\` and not a list of ids, so its dependencies are UNKNOWN rather than absent`,
			});
		}
		// A field is only MISSING if this document uses it elsewhere. Reporting every card of a spec that never
		// adopted the `invariant:` convention would flag 441 non-defects across the dev-test set — one document's
		// grammar imposed on seventeen others. The gap that matters is a card omitting what its OWN spec establishes.
		if (card.acceptance === null && usesAcceptance) {
			issues.push({ kind: "missing_acceptance", cardId: card.id, detail: `${card.id} declares no acceptance test` });
		}
		if (card.invariant === null && usesInvariants) {
			issues.push({ kind: "missing_invariant", cardId: card.id, detail: `${card.id} names no invariant` });
		}
	}

	// Kahn's algorithm; whatever cannot be emitted is in (or behind) a cycle.
	const remaining = new Map([...byId].map(([id, card]) => [id, card.dependsOn.filter((d) => byId.has(d)).length]));
	const dependents = new Map<string, string[]>();
	for (const card of byId.values()) {
		for (const dependency of card.dependsOn.filter((d) => byId.has(d))) {
			dependents.set(dependency, [...(dependents.get(dependency) ?? []), card.id]);
		}
	}
	const order: string[] = [];
	const startable = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
	// A card whose dependsOn could not be read has UNKNOWN dependencies, and zero known ones — so plain Kahn treats
	// it as a root and emits it first. For the real spec that put S49 ("Index barrel", `dependsOn: most prior`)
	// SECOND in the build order, i.e. advising an agent to build the public API surface before the code behind it.
	// Deferring these until nothing else is startable is the conservative reading of "unknown", and it never
	// reorders a card whose dependencies ARE known: a dependent still waits for its indegree to reach zero.
	const ready = startable.filter((id) => byId.get(id)?.unparseableDependsOn === undefined);
	const deferred = startable.filter((id) => byId.get(id)?.unparseableDependsOn !== undefined);
	while (ready.length > 0 || deferred.length > 0) {
		const id = (ready.length > 0 ? ready.shift() : deferred.shift()) as string;
		order.push(id);
		for (const dependent of dependents.get(id) ?? []) {
			const left = (remaining.get(dependent) ?? 0) - 1;
			remaining.set(dependent, left);
			if (left === 0) {
				(byId.get(dependent)?.unparseableDependsOn === undefined ? ready : deferred).push(dependent);
			}
		}
	}
	const cyclic = [...byId.keys()].filter((id) => !order.includes(id));
	for (const id of cyclic) {
		issues.push({ kind: "dependency_cycle", cardId: id, detail: `${id} is in or behind a dependency cycle` });
	}

	return {
		cards,
		issues,
		topologicalOrder: cyclic.length > 0 ? [] : order,
		summary:
			cards.length === 0
				? "no requirement cards found — this says nothing about the document's structure, only that this grammar did not match it"
				: `${cards.length} requirement card(s), ${cards.filter((card) => card.invariant !== null).length} naming an invariant; ${issues.length} issue(s)`,
	};
}

/**
 * One globally-numbered invariant, e.g. `E11.7` = "Determinism".
 *
 * ── THE CONVENTION, AND WHY NO SEARCH FINDS IT ──
 * A card says `invariant: **Determinism (E11.7 / V1)**`. Grepping the document for "E11.7" near a definition finds
 * nothing, because **the id never appears at its own definition site**. `## E11` contains a NUMBERED LIST, and the
 * sub-id is the list POSITION: item 7 is "Determinism". `## V8` ("Global invariants, v3 — extends E11") continues
 * the same list from 8, which is why its items are cited as `V8.8`…`V8.14`.
 *
 * That is why the earlier pass concluded 13 of 33 referenced invariants were "undefined": every textual grammar
 * misses an identifier that is implied by ordinal position rather than written down.
 *
 * ── ⚠️ AND IT IS FRAGILE, WHICH IS THE FINDING WORTH ACTING ON ──
 * Because the ids are POSITIONAL, inserting one list item renumbers every invariant below it and silently
 * invalidates every card that cites them — no test fails, no link breaks, the references just quietly mean
 * something else. A charter with written, stable ids is the fix; this resolver is what makes the current state
 * navigable until then.
 */
export interface SpecInvariantDefinition {
	/** The cited id, e.g. `E11.7` — composed from the section id and the ordinal, never read from the text. */
	readonly id: string;
	readonly name: string;
	readonly sectionId: string;
	readonly ordinal: number;
	/**
	 * Whether the id is WRITTEN at the definition (`### V3.3 …`, `- **V6.2 …**`) or implied by ORDINAL POSITION
	 * (`7. **Determinism**` under `## E11`). Only the positional ones are renumbering-fragile, so this is what
	 * separates "13 of 33 are positional" from a raw count of ids that merely happen to carry a sub-number.
	 */
	readonly idSource: "written" | "positional";
}

/**
 * A section whose NUMBERED LIST carries globally-cited invariants — recognised by the heading SAYING SO
 * ("global invariants"), not by its id shape. `## E12.` is also `[EV]\d+.` and holds an ordinary numbered list;
 * harvesting it would mint a phantom `E12.1` invariant that no card cites and no section defines.
 */
const INVARIANT_CATALOG_HEADING = /^#{2,4}\s+([EV]\d+)\.\s+(.*invariant.*)$/iu;
/** Any section heading that carries an id, with or without a trailing dot: `## E1. …` and `### V3.3 …`. */
const ID_HEADING = /^#{2,4}\s+([EV]\d+(?:\.\d+)*)\.?\s+(.+)$/u;
/** `7. **Determinism** — …` — the ordinal is the identity; the bolded lead is the name. */
const NUMBERED_INVARIANT = /^(\d+)\.\s+\*\*(.+?)\*\*/u;
/** `- **V6.2 The reward-hacking detector.**` — id inline at the head of a bolded bullet, no parentheses. */
const BULLET_ID_DEFINITION = /^[-*]\s+\*\*([EV]\d+(?:\.\d+)*)\s+(.+?)\.?\*\*/u;

/** "Capability soundness (V5)." → "Capability soundness" — the trailing citation is not part of the name. */
function invariantName(raw: string): string {
	return raw
		.replace(/\s*\([^)]*\)\s*\.?$/u, "")
		.replace(/\.$/u, "")
		.trim();
}

/**
 * Every invariant a card can cite, from all FOUR forms the document uses.
 *
 * Each narrower grammar produced a confident, wrong "undefined" count on the way here — 28/33, then 13/33, then
 * 1/33 — which is the whole lesson: an extractor reports what its grammar can see, not what the document contains.
 *   · `## E1. …`                          — section heading, WITH a trailing dot
 *   · `### V3.3 …`                        — subsection heading, NO dot (a dot-requiring regex misses these)
 *   · `- **V6.2 The … detector.**`        — id inline at the head of a bolded bullet
 *   · `7. **Determinism**` under `## E11` — ORDINAL position; the id appears NOWHERE at its own definition
 */
export function buildInvariantCatalog(markdown: string): readonly SpecInvariantDefinition[] {
	const definitions: SpecInvariantDefinition[] = [];
	const seen = new Set<string>();
	let catalogSectionId: string | null = null;

	for (const line of markdown.split(/\r?\n/)) {
		const catalogHeading = INVARIANT_CATALOG_HEADING.exec(line);
		const idHeading = ID_HEADING.exec(line);
		if (idHeading && !seen.has(idHeading[1] as string)) {
			const id = idHeading[1] as string;
			seen.add(id);
			definitions.push({
				id,
				name: invariantName(idHeading[2] as string),
				sectionId: id.split(".")[0] as string,
				ordinal: Number(id.split(".")[1] ?? 0),
				idSource: "written",
			});
		}
		const bulletDefinition = BULLET_ID_DEFINITION.exec(line);
		if (bulletDefinition && !seen.has(bulletDefinition[1] as string)) {
			const id = bulletDefinition[1] as string;
			seen.add(id);
			definitions.push({
				id,
				name: invariantName(bulletDefinition[2] as string),
				sectionId: id.split(".")[0] as string,
				ordinal: Number(id.split(".")[1] ?? 0),
				idSource: "written",
			});
		}
		if (catalogHeading) {
			catalogSectionId = catalogHeading[1] as string;
			continue;
		}
		if (line.startsWith("## ")) {
			// Any other top-level section ends the numbered run.
			catalogSectionId = null;
			continue;
		}
		const item = catalogSectionId === null ? null : NUMBERED_INVARIANT.exec(line);
		if (!item || catalogSectionId === null) {
			continue;
		}
		const ordinal = Number(item[1]);
		const id = `${catalogSectionId}.${ordinal}`;
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		definitions.push({
			id,
			name: invariantName(item[2] as string),
			sectionId: catalogSectionId,
			ordinal,
			idSource: "positional",
		});
	}
	return definitions;
}

/** Invariant ids a card cites, e.g. `Determinism (E11.7 / V1)` → ["E11.7", "V1"]. */
export function citedInvariantIds(card: SpecRequirementCard): readonly string[] {
	return [...(card.invariant ?? "").matchAll(/\b([EV]\d+(?:\.\d+)*)\b/gu)].map((match) => match[1] as string);
}

/**
 * The transitive dependency closure of a card, in dependency order, INCLUDING the card itself.
 *
 * This is the retrieval unit that makes the spine worth having: working `S12` means reading S12 and what it rests
 * on, not the 24k-word document the spec's own prose instructs an agent to read in full.
 */
export function requirementClosure(spine: SpecRequirementSpine, cardId: string): readonly string[] {
	const byId = new Map(spine.cards.map((card) => [card.id, card]));
	if (!byId.has(cardId)) {
		return [];
	}
	const seen = new Set<string>();
	const order: string[] = [];
	const visit = (id: string): void => {
		if (seen.has(id)) {
			return;
		}
		seen.add(id);
		for (const dependency of byId.get(id)?.dependsOn ?? []) {
			if (byId.has(dependency)) {
				visit(dependency);
			}
		}
		order.push(id);
	};
	visit(cardId);
	return order;
}

/**
 * ── THE CHARTER: written, stable ids for the 13 POSITIONAL invariants (P23.7's remaining ask) ──
 *
 * `E11.7` means "the 7th item under `## E11`". `## V8` continues the same list from 8, which is why cards cite
 * `V8.8`…`V8.14`. Insert one list item and every invariant below it renumbers: no test fails, no link breaks,
 * and every card citing them silently starts meaning a different invariant.
 *
 * The fix is NOT to renumber the document. That specification is a TEST FIXTURE whose size and shape are part of
 * what it measures, so it stays untouched and the charter lives beside it. What the charter buys is twofold:
 *   · a WRITTEN id (`INV-DETERMINISM`) that survives any renumbering, so future citations can be made durable;
 *   · a NAME anchor per positional id, which turns a silent renumber into a LOUD failure — `verifyInvariantCharter`
 *     re-resolves each id against the live document and reports any that no longer land on the same invariant.
 *
 * Drift detection is the whole point. An unstable reference that cannot announce its own breakage is exactly the
 * failure this item flagged, and it is the same shape as every other lesson in this repo: an input that has
 * quietly changed meaning must never present as a clean answer.
 */
export interface CharteredInvariant {
	/** What cards cite TODAY — positional, and fragile by construction. */
	readonly positionalId: string;
	/** The durable handle, written down here rather than implied by a list position. */
	readonly stableId: string;
	/** The canonical name at charter time; the anchor that makes a renumber detectable. */
	readonly name: string;
}

export const SPEC_INVARIANT_CHARTER: readonly CharteredInvariant[] = Object.freeze([
	{ positionalId: "E11.1", stableId: "INV-CONSERVATION-OF-MONEY", name: "Conservation of money" },
	{ positionalId: "E11.2", stableId: "INV-TOTALITY-OF-AUDIT", name: "Totality of audit" },
	{ positionalId: "E11.3", stableId: "INV-AUTHORITY-NON-ESCALATION", name: "Authority non-escalation" },
	{
		positionalId: "E11.4",
		stableId: "INV-IDEMPOTENT-PAID-ACTIONS",
		name: "Idempotent paid actions across failover",
	},
	{ positionalId: "E11.5", stableId: "INV-TAINT-MONOTONICITY", name: "Taint monotonicity" },
	{ positionalId: "E11.6", stableId: "INV-REVIEWABILITY", name: "Reviewability" },
	{ positionalId: "E11.7", stableId: "INV-DETERMINISM", name: "Determinism" },
	{ positionalId: "V8.8", stableId: "INV-CAPABILITY-SOUNDNESS", name: "Capability soundness" },
	{
		positionalId: "V8.9",
		stableId: "INV-TOKEN-ATTENUATION-MONOTONICITY",
		name: "Token-attenuation monotonicity",
	},
	{ positionalId: "V8.10", stableId: "INV-RUN-GOVERNANCE-TOTALITY", name: "!Klein-run governance totality" },
	{ positionalId: "V8.11", stableId: "INV-EVIDENCE-DERIVED-SUCCESS", name: "Evidence-derived success only" },
	{ positionalId: "V8.13", stableId: "INV-CALIBRATION-HONESTY", name: "Calibration honesty" },
	{ positionalId: "V8.14", stableId: "INV-ADAPTER-CONTRACT-PARITY", name: "Adapter-contract parity" },
]);

export type CharterDrift =
	| { readonly kind: "missing"; readonly positionalId: string; readonly stableId: string }
	| {
			readonly kind: "renumbered";
			readonly positionalId: string;
			readonly stableId: string;
			readonly charteredName: string;
			readonly currentName: string;
	  };

/**
 * Re-resolve every chartered id against the live document. Empty means the citations still mean what they meant.
 *
 * A `renumbered` result is the important one: the id still resolves, so nothing looks broken, but it now names a
 * DIFFERENT invariant — the silent failure the charter exists to make loud.
 */
export function verifyInvariantCharter(markdown: string): readonly CharterDrift[] {
	const byId = new Map(buildInvariantCatalog(markdown).map((definition) => [definition.id, definition]));
	const drift: CharterDrift[] = [];
	for (const entry of SPEC_INVARIANT_CHARTER) {
		const current = byId.get(entry.positionalId);
		if (!current) {
			drift.push({ kind: "missing", positionalId: entry.positionalId, stableId: entry.stableId });
			continue;
		}
		if (current.name !== entry.name) {
			drift.push({
				kind: "renumbered",
				positionalId: entry.positionalId,
				stableId: entry.stableId,
				charteredName: entry.name,
				currentName: current.name,
			});
		}
	}
	return drift;
}

/** Resolve a durable `INV-…` handle to whatever position currently holds it, so callers can cite the stable id. */
export function resolveCharteredInvariant(stableId: string): CharteredInvariant | null {
	return SPEC_INVARIANT_CHARTER.find((entry) => entry.stableId === stableId) ?? null;
}
