/**
 * §5.L content-scan `secret_like` source — the owed SCANNER that turns raw content into taint labels. Distinct from
 * `taint-labels.ts` (which by design does NOT scan — it reasons over labels that have ALREADY been assigned) and from
 * the prompt-INJECTION scanner (whose findings land in `RetrievedEvidence.promptInjectionRiskFlags`): this module asks
 * only "does this content look like it carries a CREDENTIAL/SECRET?" and, if so, layers the `secret_like` taint on top
 * of a source's provenance label — so admitting web/MCP/repo content no longer requires the caller to pre-compute
 * `looksSecretLike` by hand.
 *
 * Single source of truth: the secret-pattern catalog lives ONCE, in `agent-write-guard` (`findPotentialSecretInText`),
 * and both the write-guard (block writing a secret) and this taint scanner (label content that reads like a secret)
 * consume it — so what counts as "secret-shaped" can never drift between the two seams. Pure + total (no I/O).
 */

import { findPotentialSecretInText } from "./agent-write-guard.js";
import { labelsForSource, type TaintAttachContext, type TaintLabel, type TaintSourceKind } from "./taint-labels.js";

/**
 * Does this text look like it contains a credential/secret (a key, token, private-key block, or long credential
 * assignment)? Delegates to the shared secret-pattern catalog in `agent-write-guard`, so the write-guard and the taint
 * layer never diverge on the definition. Empty/whitespace content is trivially not secret-like.
 */
export function contentLooksSecretLike(content: string): boolean {
	return findPotentialSecretInText(content) !== null;
}

/**
 * Attach taint labels from a source AND its CONTENT: like {@link labelsForSource}, but SCANS the content and folds
 * `secret_like` in automatically when it reads as a credential/secret. An explicit `context.looksSecretLike` still
 * forces the label on (OR-ed with the scan), so a caller with out-of-band knowledge is never overridden. The result is
 * the same de-duplicated, order-stable list `labelsForSource` returns (source-kind label first, then `secret_like`).
 */
export function labelsForSourceContent(
	kind: TaintSourceKind,
	content: string,
	context: TaintAttachContext = {},
): TaintLabel[] {
	return labelsForSource(kind, {
		...context,
		looksSecretLike: context.looksSecretLike === true || contentLooksSecretLike(content),
	});
}
