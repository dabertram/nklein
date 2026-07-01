/**
 * Taint-label model (todo §5.L — "assume prompt injection SUCCEEDS, protect the sinks") — PURE decision core.
 *
 * WHAT: the vocabulary of provenance/trust taint labels that ride along with every piece of content that reaches
 * the model, plus (a) how those labels attach to a content source, (b) how they propagate when content is merged
 * into the model context, and (c) the ONE core rule that governs what tainted content is allowed to influence.
 *
 * WHY: once online retrieval (§5.AC), the browser (§5.M G6), and MCP are live, model-facing content is untrusted.
 * The invariant §5.L pins down (and this module encodes as a pure predicate) is:
 *
 *   > repo / web / MCP content can guide **STYLE** but must **never** modify capabilities, approvals, network,
 *   > secrets, git-delivery, or host access **without a trusted plan + confirmation**.
 *
 * This is the substrate the capability broker (the next §5.L leaf: `allow | deny | one-time-confirm |
 * require-fresh-trusted-plan`) sits on: the broker reads the *taint labels* on the requested action's context and
 * asks {@link taintedContentMayInfluence} before letting an influence reach a protected sink. Keeping it pure (no
 * I/O, no SDK) mirrors `agent-rulesets.ts` / `tool-capability-manifest.ts` so the rule is unit-testable without a
 * live runtime. It does NOT scan content for injection patterns (that is the taint *scanner*, whose findings land
 * in `RetrievedEvidence.promptInjectionRiskFlags`); it reasons over labels that have already been assigned.
 */

/**
 * The provenance/trust class of a piece of content, exactly per §5.L. A single content source may carry several
 * labels at once (e.g. a private-repo file that also `secret_like`), and labels only ever accumulate as content
 * flows into context — they are never silently dropped.
 *
 *  - `repo_instruction` — text from a repository (README/AGENTS/comments). Community-trust: guides style, not power.
 *  - `web`              — content fetched from the open web. Untrusted; adversarial until proven otherwise.
 *  - `mcp`              — content vended by an MCP tool/resource. Untrusted (remote MCP annotations are hints).
 *  - `private_repo`     — content from a private/internal repository. Sensitive, but still not operator-authored.
 *  - `secret_like`      — content that looks like a credential/secret (token, key, password-shaped).
 *  - `user_trusted`     — content the human operator authored/asserted directly (the trust anchor).
 *  - `runtime_policy`   — content that IS platform policy (the ruleset/manifest/config the runtime itself set).
 */
export const TAINT_LABELS = [
	"repo_instruction",
	"web",
	"mcp",
	"private_repo",
	"secret_like",
	"user_trusted",
	"runtime_policy",
] as const;

export type TaintLabel = (typeof TAINT_LABELS)[number];

/**
 * The labels whose content is UNTRUSTED for the purpose of influencing protected sinks — i.e. content that "guides
 * STYLE only". Everything a model reads from outside the operator's control surface lives here. `secret_like` is
 * untrusted-to-influence too: a leaked-looking secret must never be treated as an authorization to act.
 *
 * The two TRUSTED anchors (`user_trusted`, `runtime_policy`) are deliberately absent — content bearing *only* those
 * may authorize a protected action. Membership here is the sole definition of "tainted" used by the core rule.
 */
const UNTRUSTED_LABELS: ReadonlySet<TaintLabel> = new Set<TaintLabel>([
	"repo_instruction",
	"web",
	"mcp",
	"private_repo",
	"secret_like",
]);

/** Whether a single label marks its content as untrusted-to-influence (guides style only). */
export function isUntrustedTaintLabel(label: TaintLabel): boolean {
	return UNTRUSTED_LABELS.has(label);
}

/**
 * The classes of source content can attach to. Deliberately coarse — it mirrors the `sourceType` a retrieval
 * envelope already knows, so labels can be assigned the moment content is admitted, before any scanning.
 */
export type TaintSourceKind = "web" | "repo" | "private_repo" | "mcp" | "user" | "runtime_policy";

/** Extra provenance hints available at attach time that add labels beyond the source kind. */
export interface TaintAttachContext {
	/** The taint scanner (or a caller heuristic) believes the content contains a credential/secret. */
	looksSecretLike?: boolean;
}

/**
 * Attach the taint labels a content source carries, given its {@link TaintSourceKind} and optional provenance
 * hints. Deterministic and total: the base label is derived from the source kind, and `looksSecretLike` layers
 * `secret_like` on top (so a private-repo file that reads like a token gets BOTH `private_repo` and `secret_like`).
 * Returned labels are de-duplicated and order-stable (source-kind label first, then `secret_like`).
 */
export function labelsForSource(kind: TaintSourceKind, context: TaintAttachContext = {}): TaintLabel[] {
	const base: TaintLabel = ((): TaintLabel => {
		switch (kind) {
			case "web":
				return "web";
			case "repo":
				return "repo_instruction";
			case "private_repo":
				return "private_repo";
			case "mcp":
				return "mcp";
			case "user":
				return "user_trusted";
			case "runtime_policy":
				return "runtime_policy";
		}
	})();
	const labels: TaintLabel[] = [base];
	if (context.looksSecretLike && base !== "secret_like") {
		labels.push("secret_like");
	}
	return labels;
}

/**
 * Propagate taint into the model context: the UNION of every label already on the context with every label the
 * newly-admitted content carries. Taint only ever accumulates — once web/MCP content mingles with a prompt, that
 * prompt is web/MCP-tainted forever (you cannot "launder" untrusted provenance by mixing it with trusted text).
 *
 * Returns a de-duplicated, canonical-order list (following {@link TAINT_LABELS}) so equal label *sets* always
 * compare equal as arrays — handy for stable audit records and test assertions.
 */
export function propagateTaint(existing: readonly TaintLabel[], incoming: readonly TaintLabel[]): TaintLabel[] {
	const present = new Set<TaintLabel>([...existing, ...incoming]);
	return TAINT_LABELS.filter((label) => present.has(label));
}

/** Whether a context carries ANY untrusted-to-influence label (i.e. it is tainted). */
export function isTainted(labels: readonly TaintLabel[]): boolean {
	return labels.some(isUntrustedTaintLabel);
}

/**
 * The protected effect classes tainted content must NEVER reach on its own. These are the "sinks" of §5.L: an
 * influence that would change any of them requires a trusted plan + confirmation — never a bare instruction lifted
 * from web/repo/MCP text. Everything OUTSIDE this set (style, tone, wording, formatting, phrasing) is fair game for
 * tainted content to guide, which is the whole point of admitting it.
 */
export const PROTECTED_INFLUENCE_KINDS = [
	"capabilities",
	"approvals",
	"network",
	"secrets",
	"git_delivery",
	"host_access",
] as const;

export type ProtectedInfluenceKind = (typeof PROTECTED_INFLUENCE_KINDS)[number];

/** The kind of effect a proposed influence would have. `style` is the catch-all for non-protected influence. */
export type InfluenceKind = ProtectedInfluenceKind | "style";

const PROTECTED_INFLUENCE_SET: ReadonlySet<InfluenceKind> = new Set<InfluenceKind>(PROTECTED_INFLUENCE_KINDS);

/** Whether an influence kind targets a protected sink (vs. a benign `style`-class influence). */
export function isProtectedInfluence(kind: InfluenceKind): boolean {
	return PROTECTED_INFLUENCE_SET.has(kind);
}

/** A request to let some tainted-or-not context exert an influence of a given kind. */
export interface TaintInfluenceRequest {
	/** The taint labels currently on the context proposing the influence. */
	labels: readonly TaintLabel[];
	/** What the influence would change. */
	influence: InfluenceKind;
	/**
	 * Whether a trusted plan + human confirmation backs this influence. Only a caller that has genuinely obtained
	 * the plan + confirmation may set this — it is the ONE gate that lets tainted content reach a protected sink.
	 */
	backedByTrustedPlanAndConfirmation?: boolean;
}

/**
 * THE CORE §5.L RULE, as a pure predicate. Returns whether the proposed influence is permitted:
 *
 *   - A `style`-class influence (non-protected) is ALWAYS allowed — tainted content is admitted precisely so it
 *     can guide style/wording.
 *   - An influence on a PROTECTED sink (capabilities/approvals/network/secrets/git-delivery/host) is allowed only
 *     when the context is NOT tainted OR a trusted plan + confirmation explicitly backs it. Tainted content on its
 *     own can never move a protected sink.
 *
 * This encodes: "repo/web/MCP content can guide STYLE but never modify capabilities, approvals, network, secrets,
 * git-delivery, or host access without a trusted plan + confirmation." It is fail-closed: an unknown/empty label
 * set counts as untainted (nothing to distrust), but the presence of ANY untrusted label taints the whole context.
 */
export function taintedContentMayInfluence(request: TaintInfluenceRequest): boolean {
	if (!isProtectedInfluence(request.influence)) {
		return true;
	}
	if (!isTainted(request.labels)) {
		return true;
	}
	return request.backedByTrustedPlanAndConfirmation === true;
}
