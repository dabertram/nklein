/**
 * WHO OWNS a sandbox container — the primitive §4A said was missing. PURE core.
 *
 * ── WHY THIS EXISTS ──
 * §4A (Aider campaign, 2026-07-23) records a destructive-cleanup incident: a simulator runtime used the kind-wide
 * `nklein.kind=agent-sandbox` label to `docker rm -f` a LIVE campaign container. The fix made destructive cleanup
 * **namespace-exact**, and closed the rule with the sentence that names this module's reason to exist:
 *
 *   > Labels identify resource kind, not ownership—never use a kind-wide query as a destructive multi-runtime
 *   > cleanup boundary.
 *
 * That fix was right, and it opened a leak nothing ever closes. A pool namespace is derived from the runtime's
 * port and workspace scope (`simflow-58219-ephemeral-ws-<hash>`), so it is **unique per run and never recurs**.
 * Namespace-exact reaping therefore only ever collects resources a FUTURE runtime with the SAME namespace would
 * claim — and for ephemeral pools that runtime never boots. The startup reaper is unnamespaced, and its regex
 * (`^nklein-agent-sandbox-\d+$`) cannot match the `-ws-<hash>-<slot>` shape the live pool always produces, so in
 * practice it reaps **nothing at all**.
 *
 * ── MEASURED ON THIS HOST, 2026-08-01 ──
 * 22 sandbox containers (6 still RUNNING, oldest up 6 days) and 105 local volumes of which only 22 were active —
 * 83 leaked workspaces — with **no !Klein runtime process alive to own any of them**. On a machine whose scarce
 * resource is the RAM that local inference needs, six abandoned containers is not bookkeeping.
 *
 * ── THE FIX IS TO MAKE THE LABEL SAY WHAT §4A SAID IT DIDN'T ──
 * A container now carries an OWNER claim (pid + a nonce unique to the owning runtime process). Cleanup then rests
 * on ownership, which is what the rule asked for, instead of on kind (unsafe) or on namespace equality (leaky).
 *
 * The nonce is not decoration. `pid` alone cannot distinguish "our own pool" from "a dead owner whose pid the OS
 * handed to us" — and those demand opposite actions. Same pid + different nonce is positive PROOF the original
 * owner is gone, because two live processes cannot share a pid.
 *
 * ── FAIL-SAFE DIRECTION ──
 * Wrongly reaping destroys a live agent's workspace mid-run; wrongly keeping leaks a container. Those costs are
 * not symmetric, so **every uncertain case keeps**: an unparseable pid, a half-written owner claim, a live pid we
 * do not recognise, and any legacy container outside our namespace all resolve to "keep". Only two paths delete:
 * a provably dead owner, and the historical unnamespaced shape this manager already owned before ownership labels
 * existed (byte-identical to today's behaviour, so the 2026-07-23 boundary is preserved exactly).
 */

/** Identity of the runtime process that created a sandbox resource. */
export interface SandboxOwnerIdentity {
	readonly pid: number;
	/**
	 * Unique per runtime PROCESS (not per pool, not per host). Its only job is to tell "still us" apart from
	 * "our pid, recycled after the owner died" — see the module header.
	 */
	readonly nonce: string;
}

/** A container as the docker listing reports it: name plus whatever owner labels it carries. */
export interface SandboxContainerRecord {
	readonly name: string;
	/** Raw label values — docker reports a missing label as an empty string, which must read as absent. */
	readonly ownerPid?: string | null;
	readonly ownerNonce?: string | null;
}

/**
 * Why a container was kept or reaped. Verdicts are returned rather than booleans so the reaper can LOG the
 * reason: a destructive cleanup that cannot say why it deleted something is the 2026-07-23 incident again.
 */
export type SandboxOrphanVerdict =
	/** The owning process is gone. The only ownership-based delete. */
	| "reap_owner_dead"
	/** Our pid, someone else's nonce — the owner cannot still be running. */
	| "reap_owner_pid_reused"
	/** No owner claim, but the name is one this manager already owned. Pre-existing behaviour, unchanged. */
	| "reap_legacy_namespace_match"
	/** Our own live pool; in-process disposal owns these. */
	| "keep_own_pool"
	/** Another runtime is alive and holding it. */
	| "keep_owner_alive"
	/** No owner claim and not our namespace — the 2026-07-23 boundary. */
	| "keep_legacy_foreign_namespace"
	/** A malformed or half-written owner claim. Never guess at ownership. */
	| "keep_owner_unparseable"
	/**
	 * No owner claim, and an operator explicitly asked for unowned containers too (`dev sandbox-reap
	 * --include-unowned`). This is the ONE verdict not backed by proof, which is why it is opt-in, separately named,
	 * and reachable only for containers carrying NO claim — never for one whose owner is alive.
	 */
	| "reap_unowned_operator_forced";

export interface SandboxOrphanDecision {
	readonly name: string;
	readonly verdict: SandboxOrphanVerdict;
	readonly reap: boolean;
}

const REAPING_VERDICTS: ReadonlySet<SandboxOrphanVerdict> = new Set<SandboxOrphanVerdict>([
	"reap_owner_dead",
	"reap_owner_pid_reused",
	"reap_legacy_namespace_match",
	"reap_unowned_operator_forced",
]);

/** True when this verdict authorises deletion. Single source, so a new verdict cannot become destructive silently. */
export function verdictReaps(verdict: SandboxOrphanVerdict): boolean {
	return REAPING_VERDICTS.has(verdict);
}

/** Docker reports an unset label as `""`; treat empty/whitespace as absent rather than as a claim. */
function presentLabel(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export interface ClassifySandboxContainerInput {
	readonly record: SandboxContainerRecord;
	readonly self: SandboxOwnerIdentity;
	/** Liveness probe for a foreign pid. Must report a pid it cannot inspect as ALIVE (keeping is the safe side). */
	readonly isPidAlive: (pid: number) => boolean;
	/** Whether the name matches this manager's exact namespace — the pre-ownership rule, kept for legacy containers. */
	readonly matchesOwnNamespace: (containerName: string) => boolean;
	/**
	 * Operator override for containers created BEFORE ownership labels existed. Those carry no claim, so nothing can
	 * prove they are abandoned — only a human who knows no runtime is live can say so. Deliberately cannot reach a
	 * container whose owner is alive: this widens the set to "unprovable", never to "provably in use".
	 */
	readonly treatUnownedAsAbandoned?: boolean;
}

export function classifySandboxContainer(input: ClassifySandboxContainerInput): SandboxOrphanDecision {
	const { record, self } = input;
	const rawPid = presentLabel(record.ownerPid);
	const nonce = presentLabel(record.ownerNonce);

	// A COMPLETE claim or none at all. A half-written claim (one label, not the other) is treated as legacy rather
	// than half-trusted: partial evidence of ownership is not evidence of abandonment.
	if (rawPid === null || nonce === null) {
		const verdict: SandboxOrphanVerdict = input.treatUnownedAsAbandoned
			? "reap_unowned_operator_forced"
			: input.matchesOwnNamespace(record.name)
				? "reap_legacy_namespace_match"
				: "keep_legacy_foreign_namespace";
		return { name: record.name, verdict, reap: verdictReaps(verdict) };
	}

	// `Number()` over parseInt: "12abc" must not silently become pid 12 and get something killed.
	const pid = Number(rawPid);
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return { name: record.name, verdict: "keep_owner_unparseable", reap: false };
	}

	if (pid === self.pid) {
		const verdict: SandboxOrphanVerdict = nonce === self.nonce ? "keep_own_pool" : "reap_owner_pid_reused";
		return { name: record.name, verdict, reap: verdictReaps(verdict) };
	}

	if (input.isPidAlive(pid)) {
		return { name: record.name, verdict: "keep_owner_alive", reap: false };
	}
	return { name: record.name, verdict: "reap_owner_dead", reap: true };
}

export interface SandboxOrphanPlan {
	readonly decisions: readonly SandboxOrphanDecision[];
	readonly reapNames: readonly string[];
	readonly summary: string;
}

/** Classify a whole listing and report the plan, so the caller logs one line instead of guessing at the outcome. */
export function planSandboxOrphanReaping(input: {
	readonly records: readonly SandboxContainerRecord[];
	readonly self: SandboxOwnerIdentity;
	readonly isPidAlive: (pid: number) => boolean;
	readonly matchesOwnNamespace: (containerName: string) => boolean;
	readonly treatUnownedAsAbandoned?: boolean;
}): SandboxOrphanPlan {
	const decisions = input.records.map((record) =>
		classifySandboxContainer({
			record,
			self: input.self,
			isPidAlive: input.isPidAlive,
			matchesOwnNamespace: input.matchesOwnNamespace,
			...(input.treatUnownedAsAbandoned === undefined
				? {}
				: { treatUnownedAsAbandoned: input.treatUnownedAsAbandoned }),
		}),
	);
	const reapNames = decisions.filter((decision) => decision.reap).map((decision) => decision.name);
	const byVerdict = new Map<SandboxOrphanVerdict, number>();
	for (const decision of decisions) {
		byVerdict.set(decision.verdict, (byVerdict.get(decision.verdict) ?? 0) + 1);
	}
	const breakdown = [...byVerdict.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.map(([verdict, count]) => `${verdict}=${count}`)
		.join(", ");
	return {
		decisions,
		reapNames,
		summary:
			decisions.length === 0
				? "no sandbox containers listed"
				: `${decisions.length} sandbox container(s): reaping ${reapNames.length} (${breakdown})`,
	};
}

/**
 * The workspace volume that belongs to a container, derived from the container's own name.
 *
 * Volumes are created IMPLICITLY by `docker run -v <name>:/workspace`, so they cannot carry the owner labels the
 * container carries — an implicit volume gets no labels at all. Rather than invent a second liveness heuristic for
 * them (dangling-volume scans race with a concurrent pool boot, which is how the 2026-07-23 incident happened),
 * volume cleanup RIDES ON the container's ownership verdict: the two names are built from the same namespace and
 * slot by `createAgentSandbox{Container,Volume}Name`, differing only in prefix.
 *
 * Returns null when the name is not this prefix's shape, so a caller can never derive a volume name from a
 * container it does not understand.
 */
export function siblingWorkspaceVolumeName(input: {
	readonly containerName: string;
	readonly containerPrefix: string;
	readonly volumePrefix: string;
}): string | null {
	const marker = `${input.containerPrefix}-`;
	if (!input.containerName.startsWith(marker)) {
		return null;
	}
	const suffix = input.containerName.slice(marker.length);
	return suffix.length > 0 ? `${input.volumePrefix}-${suffix}` : null;
}
