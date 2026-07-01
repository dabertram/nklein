/**
 * !Klein self-awareness corpus ROUTER — the "which of !Klein's own planning docs should ground this answer?" gate of the
 * read-only self-awareness chat scope (todo §5.AH-A).
 *
 * WHY. §5.AH-A gives the chat agent a read-only `klein_self` scope so a user can *discuss* !Klein with it — "what
 * features exist", "how does the swarm scheduler work", "is this a known bug", "would idea Z fit". The grounding for
 * those answers is !Klein's own **planning corpus**: `done.md` (the shipped-feature catalog — exactly "what exists"),
 * `todo.md` (what's left + why — "planned/known"), `AGENTS.md` (tribal knowledge / how-we-work), `CHANGELOG.md`
 * (user-facing release history), and `docs/**` (current maintained references). The spec is explicit that the routing is
 * intent-dependent — verbatim: *"prefer done.md for 'existing features' + todo.md for 'planned/known'"*. But nothing
 * upstream DERIVES that preference: `retrieval-query-plan.ts` rewrites a task into generic query STRINGS (primary +
 * knowledge-debt alternates) and `retrieval-source-trust.ts` scores a WEB source's ORIGIN — neither answers "given THIS
 * self-question, which corpus DOCUMENT is the authority to read first?". This module is that missing policy: classify a
 * self-awareness question's INTENT from deterministic cues, then rank the corpus documents so the highest-priority
 * source for that intent leads (done.md for "does X exist / what features", todo.md for "is Y planned / known bug",
 * AGENTS.md for "how do we work / conventions", CHANGELOG.md for "when did / released", docs for "architecture /
 * reference"), with a stable, spec-aligned fallback order when the question gives no cue.
 *
 * The classifier is deterministic and CUE-BASED (not a model): an injected question string is scanned against a small
 * intent lexicon, or an explicit `intent` is honoured verbatim. The MOST-specific matched intent wins by a fixed
 * priority (an "is feature X a known BUG" question routes to todo.md even though it also mentions a feature), so the
 * routing is predictable; matched cue signals are recorded (in lexicon order) so the reasoning is auditable. No cue
 * match ⇒ `unknown` intent, which still yields a full, sensibly-ordered ranking (the spec's done.md → todo.md lead)
 * rather than nothing.
 *
 * PRIME DIRECTIVE boundary (todo §5.AH invariants #1/#2/#3): this DECIDES only — it performs NO file read / retrieval /
 * indexing / model / UI / fs / network. It never opens done.md or any corpus file; every input (the question text, the
 * optional set of AVAILABLE corpus documents, an optional explicit intent, extra cues) is INJECTED as a plain value, and
 * the output is a pure *plan* (ranked document ids + rationale) that an effectful caller uses to fetch/retrieve. PURE +
 * deterministic → fully unit-testable. Complements — does not duplicate — `retrieval-query-plan.ts` (task → query
 * strings), `retrieval-source-trust.ts` (web ORIGIN → trust tier), and `retrieval-rerank.ts` (relevance ORDER of already
 * -retrieved results); this routes among a FIXED, known-authoritative local corpus BEFORE any of those run.
 */

// ---------------------------------------------------------------------------
// Corpus documents
// ---------------------------------------------------------------------------

/**
 * The planning-corpus documents the `klein_self` scope grounds on (todo §5.AH-A), each a stable id an effectful caller
 * maps to a real path/retriever:
 *   • `done` — `done.md`, the shipped-feature catalog. The authority for "what EXISTS / is this feature present".
 *   • `todo` — `todo.md`, the backlog + rationale. The authority for "what's PLANNED / is this a known bug / would Z fit".
 *   • `agents` — `AGENTS.md`, tribal knowledge + working mode. The authority for "how do WE work / conventions / why".
 *   • `changelog` — `CHANGELOG.md`, user-facing release notes. The authority for "WHEN did X ship / release history".
 *   • `docs` — `docs/**`, current maintained references (architecture, integrations). The authority for "how is X
 *     ARCHITECTED / reference material".
 */
export type KleinCorpusDoc = "done" | "todo" | "agents" | "changelog" | "docs";

/**
 * Every corpus document in the spec's default reading order. `done` leads and `todo` follows — verbatim from §5.AH-A
 * ("prefer done.md for 'existing features' + todo.md for 'planned/known'"); the how-we-work / release / reference docs
 * trail. This is the fallback ranking for an `unknown` intent and the tail-ordering for every other intent.
 */
export const KLEIN_CORPUS_DEFAULT_ORDER: readonly KleinCorpusDoc[] = ["done", "todo", "agents", "changelog", "docs"];

// ---------------------------------------------------------------------------
// Question intent
// ---------------------------------------------------------------------------

/**
 * The kind of self-awareness question, which decides the lead corpus document, most-specific → least:
 *   • `known_issue`     — "is this a known bug / limitation / not working / broken / TODO?" → todo.md leads (the backlog
 *     is where known issues + what's-left live). Ranked ABOVE `existing_feature` so an "is feature X broken" question
 *     routes to the backlog, not the shipped catalog, even though it names a feature.
 *   • `future_fit`      — "is Y planned / on the roadmap / would idea Z fit / could we add?" → todo.md leads.
 *   • `existing_feature`— "what features exist / does !Klein do X / is X supported / how does <feature> work?" →
 *     done.md leads (the shipped-feature catalog is exactly "what exists").
 *   • `how_we_work`     — "what are the conventions / working mode / why is it done this way / tribal knowledge?" →
 *     AGENTS.md leads.
 *   • `release_history` — "when did X ship / what changed in the release / version history?" → CHANGELOG.md leads.
 *   • `architecture`    — "how is it architected / where does X live / module/design reference?" → docs leads.
 *   • `unknown`         — no cue matched; the spec's default done → todo → … order applies.
 */
export type KleinSelfIntent =
	| "known_issue"
	| "future_fit"
	| "existing_feature"
	| "how_we_work"
	| "release_history"
	| "architecture"
	| "unknown";

/**
 * Priority of an intent (0 = most specific / wins a tie). A question that fires MULTIPLE intents resolves to the
 * highest-priority (lowest-rank) match, so "is <feature> a known bug" → `known_issue` (rank 0) beats `existing_feature`
 * (rank 2). `unknown` never appears as a matched cue — it's only the no-match fallback — so it is deliberately last.
 */
const INTENT_PRIORITY: readonly KleinSelfIntent[] = [
	"known_issue",
	"future_fit",
	"existing_feature",
	"how_we_work",
	"release_history",
	"architecture",
	"unknown",
];

/** Rank of an intent in {@link INTENT_PRIORITY} (0 = wins). */
function intentRank(intent: KleinSelfIntent): number {
	return INTENT_PRIORITY.indexOf(intent);
}

/**
 * The lead corpus document each intent routes to. This is the spec's routing table: `existing_feature` → done.md,
 * `known_issue`/`future_fit` → todo.md, and so on. The leader is placed FIRST in the ranking; the remaining docs follow
 * in {@link KLEIN_CORPUS_DEFAULT_ORDER} so the answer always has a full, ordered corpus to fall back through.
 */
const LEAD_DOC_BY_INTENT: Readonly<Record<KleinSelfIntent, KleinCorpusDoc>> = {
	known_issue: "todo",
	future_fit: "todo",
	existing_feature: "done",
	how_we_work: "agents",
	release_history: "changelog",
	architecture: "docs",
	unknown: "done",
};

// ---------------------------------------------------------------------------
// Intent lexicon
// ---------------------------------------------------------------------------

/** A word/phrase cue mapped to the intent its presence implies. Matched case-insensitively against the question. */
export interface KleinSelfIntentCue {
	readonly pattern: RegExp;
	readonly intent: KleinSelfIntent;
	/** Human-readable signal name recorded in {@link KleinSelfCorpusRoute.matchedSignals}. */
	readonly signal: string;
}

/**
 * The built-in intent lexicon. Order does NOT matter for the verdict (the highest-PRIORITY matched intent always wins,
 * per {@link INTENT_PRIORITY}); it exists only to make `matchedSignals` deterministic. Patterns use `\b…\b` word
 * boundaries so "buggy" doesn't slip past "bug"-scoped intent unintentionally and cues are whole words/phrases. Callers
 * may append extra cues via {@link RouteKleinSelfCorpusOptions.extraCues}.
 */
const DEFAULT_CUES: readonly KleinSelfIntentCue[] = [
	// known_issue — "is this a known bug / limitation / broken?"
	{
		pattern: /\b(?:known )?(?:bug|bugs|issue|issues|defect|regression)\b/i,
		intent: "known_issue",
		signal: "bug/issue",
	},
	{
		pattern: /\b(?:broken|not working|doesn'?t work|fails?|failing|crash(?:es|ing)?)\b/i,
		intent: "known_issue",
		signal: "broken",
	},
	{
		pattern: /\b(?:limitation|limitations|shortcoming|caveat|gotcha|footgun)\b/i,
		intent: "known_issue",
		signal: "limitation",
	},
	// future_fit — "is Y planned / would Z fit / could we add?"
	{ pattern: /\b(?:planned|roadmap|backlog|upcoming|future|todo|to-do)\b/i, intent: "future_fit", signal: "planned" },
	{
		pattern: /\b(?:would|could|should) (?:it|we|this|that|z|idea)\b.*\b(?:fit|work|make sense|be added|be worth)\b/i,
		intent: "future_fit",
		signal: "would-fit",
	},
	{
		pattern:
			/\b(?:add|adding|introduce|implement|build) (?:a |an |the )?(?:new )?(?:feature|support|idea|capability)\b/i,
		intent: "future_fit",
		signal: "add-idea",
	},
	// existing_feature — "what features exist / does it do X / how does <feature> work?"
	{
		pattern: /\b(?:what|which) (?:features?|capabilit(?:y|ies)|tools?)\b/i,
		intent: "existing_feature",
		signal: "what-features",
	},
	{
		pattern: /\b(?:does|can) (?:it|klein|!?klein|the app|the agent)\b.*\b(?:support|do|have|handle)\b/i,
		intent: "existing_feature",
		signal: "does-it-support",
	},
	{
		pattern: /\b(?:is|are) .* (?:supported|available|implemented|built[- ]?in|a feature)\b/i,
		intent: "existing_feature",
		signal: "is-supported",
	},
	{ pattern: /\bhow does\b.*\bwork\b/i, intent: "existing_feature", signal: "how-does-work" },
	// how_we_work — "conventions / working mode / why this way?"
	{
		pattern: /\b(?:convention|conventions|working mode|tribal knowledge|prime directive|guidelines?|standards?)\b/i,
		intent: "how_we_work",
		signal: "conventions",
	},
	{ pattern: /\b(?:why (?:is|do|are|does) (?:it|we|this|things))\b/i, intent: "how_we_work", signal: "why-this-way" },
	// release_history — "when did X ship / release history?"
	{
		pattern: /\b(?:changelog|release notes|release history|version history|shipped|released|when did)\b/i,
		intent: "release_history",
		signal: "release-history",
	},
	// architecture — "how is it architected / where does X live?"
	{
		pattern:
			/\b(?:architecture|architected|module|modules|design(?: doc)?|where (?:does|is)|codebase layout|structure)\b/i,
		intent: "architecture",
		signal: "architecture",
	},
];

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Result of routing a self-awareness question to the planning corpus. */
export interface KleinSelfCorpusRoute {
	/** The classified intent — the highest-PRIORITY matched cue, an explicit override, or `unknown` when nothing matched. */
	intent: KleinSelfIntent;
	/**
	 * The corpus documents to consult, most- → least-relevant for this intent: the intent's lead doc first, then the
	 * remaining docs in {@link KLEIN_CORPUS_DEFAULT_ORDER}. Filtered to `availableDocs` when the caller supplies that set
	 * (so an answer never routes to a doc the runtime hasn't indexed). Always duplicate-free.
	 */
	ranked: KleinCorpusDoc[];
	/** The single lead doc — `ranked[0]`, or `null` when `availableDocs` is empty (no corpus to route to). */
	lead: KleinCorpusDoc | null;
	/** Distinct intent cues that fired, in lexicon order (deterministic). Empty for an explicit override or no match. */
	matchedSignals: string[];
	/**
	 * How the intent was reached:
	 *   • `explicit` — the caller passed an `intent` override (cues not consulted).
	 *   • `cue`      — ≥1 lexicon cue fired and set the intent.
	 *   • `default`  — no cue fired → `unknown` intent, the spec's default ordering.
	 */
	basis: "explicit" | "cue" | "default";
	/** A short rail an agent can surface: which doc leads and why. */
	rationale: string;
}

/** Options for {@link routeKleinSelfCorpus}. All optional; every value is INJECTED (no I/O). */
export interface RouteKleinSelfCorpusOptions {
	/**
	 * An explicit intent that OVERRIDES cue classification (the cues are not consulted; `basis: "explicit"`). For a
	 * caller that already knows the intent (e.g. from a UI affordance) and just wants the ranking.
	 */
	intent?: KleinSelfIntent;
	/**
	 * The corpus documents the runtime has actually indexed/loaded. When provided, the ranking is FILTERED to this set
	 * (preserving relevance order) so an answer never routes to an unavailable doc; when omitted, all docs are eligible.
	 * An empty array yields an empty ranking + `lead: null`.
	 */
	availableDocs?: readonly KleinCorpusDoc[];
	/** Extra intent cues appended to the built-in lexicon (checked after the defaults; priority still decides the winner). */
	extraCues?: readonly KleinSelfIntentCue[];
}

function rationaleFor(intent: KleinSelfIntent, lead: KleinCorpusDoc | null): string {
	if (lead === null) {
		return "No planning-corpus document is available to route this question to.";
	}
	switch (intent) {
		case "known_issue":
			return "Known-issue question → todo.md leads (the backlog holds known bugs + what's left).";
		case "future_fit":
			return "Planned / would-it-fit question → todo.md leads (the backlog holds the roadmap + rationale).";
		case "existing_feature":
			return "Existing-feature question → done.md leads (the shipped-feature catalog is exactly 'what exists').";
		case "how_we_work":
			return "How-we-work question → AGENTS.md leads (working mode + tribal knowledge + conventions).";
		case "release_history":
			return "Release-history question → CHANGELOG.md leads (user-facing 'what shipped when').";
		case "architecture":
			return "Architecture / reference question → docs/** leads (current maintained references).";
		default:
			return "No specific intent cue — default corpus order (done.md → todo.md → …) applies.";
	}
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Collapse runs of whitespace to a single space and trim leading/trailing whitespace. */
function normalise(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Rank the remaining corpus docs after `lead`, in {@link KLEIN_CORPUS_DEFAULT_ORDER}, with `lead` moved to the front —
 * a duplicate-free full ordering led by the intent's authority.
 */
function orderLeadFirst(lead: KleinCorpusDoc): KleinCorpusDoc[] {
	return [lead, ...KLEIN_CORPUS_DEFAULT_ORDER.filter((doc) => doc !== lead)];
}

/**
 * Classify a self-awareness question's intent from cues (or honour an explicit override) and rank the planning-corpus
 * documents so the intent's authority leads (both the question text and options are INJECTED). Deterministic:
 *   1. An explicit `options.intent` wins outright (`basis: "explicit"`, no cues consulted).
 *   2. Otherwise every built-in + extra cue is tested against the normalised question; the MOST-specific matched intent
 *      wins by {@link INTENT_PRIORITY} (`basis: "cue"`). Matched signals are recorded in lexicon order.
 *   3. No cue fires ⇒ `unknown` intent + the spec's default done → todo → … order (`basis: "default"`).
 *   4. The chosen intent's lead doc is placed first; the rest follow in {@link KLEIN_CORPUS_DEFAULT_ORDER}. When
 *      `availableDocs` is supplied the ranking is filtered to it (relevance order preserved); an empty set ⇒ `lead:
 *      null`.
 * Never fetches, reads a file, or calls a model — it returns a routing PLAN only.
 */
export function routeKleinSelfCorpus(question: string, options?: RouteKleinSelfCorpusOptions): KleinSelfCorpusRoute {
	const normalisedQuestion = normalise(question ?? "");

	let intent: KleinSelfIntent;
	let matchedSignals: string[];
	let basis: KleinSelfCorpusRoute["basis"];

	if (options?.intent !== undefined) {
		intent = options.intent;
		matchedSignals = [];
		basis = "explicit";
	} else {
		const cues = options?.extraCues ? [...DEFAULT_CUES, ...options.extraCues] : DEFAULT_CUES;
		const signals: string[] = [];
		let best: KleinSelfIntent | null = null;
		for (const cue of cues) {
			if (cue.pattern.test(normalisedQuestion)) {
				if (!signals.includes(cue.signal)) {
					signals.push(cue.signal);
				}
				if (best === null || intentRank(cue.intent) < intentRank(best)) {
					best = cue.intent;
				}
			}
		}
		if (best === null) {
			intent = "unknown";
			matchedSignals = [];
			basis = "default";
		} else {
			intent = best;
			matchedSignals = signals;
			basis = "cue";
		}
	}

	const leadDoc = LEAD_DOC_BY_INTENT[intent];
	const fullOrder = orderLeadFirst(leadDoc);
	const available = options?.availableDocs;
	const ranked = available ? fullOrder.filter((doc) => available.includes(doc)) : fullOrder;
	const lead = ranked.length > 0 ? ranked[0] : null;

	return {
		intent,
		ranked,
		lead,
		matchedSignals,
		basis,
		rationale: rationaleFor(intent, lead),
	};
}
