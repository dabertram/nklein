/**
 * F4.8b — find requirement deliverables whose only consumer sits behind a DEFAULT-OFF env flag. PURE core.
 *
 * ── WHY THIS EXISTS ──
 * `dev requirement-coverage` and `dev unwired-cores` both answer "is this module imported by live code?". F4.8
 * proved that is the WEAKER claim: `context-reanchor.ts` had a complete import chain to the session runtime and
 * was reported as satisfied — while its injection site sat behind `isTruthyEnv(process.env.NKLEIN_GOAL_REANCHOR)`,
 * default OFF. **Nothing reached a prompt in the shipped configuration, and every audit said the requirement was
 * met.** There are 40 distinct default-OFF flags in this codebase; that was found by hand, one requirement at a
 * time, and only because a gate was being worked on.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CLAIM ──
 * **It reports SUSPICION, never a verdict.** Proving that a guard actually wraps a particular call needs real
 * parsing — scope analysis, control flow, whether the flag is read once into a const at module load. This checks
 * only whether a consumer file mentions a default-OFF flag at all. So:
 *  - a `suspect` result means **go look**, not "this is broken";
 *  - a clean result means **this check found nothing**, not "this path definitely runs".
 * Both halves matter. The second is the one that would otherwise quietly become "verified", which is exactly the
 * mistake that produced F4.8 — an audit whose weaker claim got read as the stronger one.
 *
 * Stating the boundary in the OUTPUT rather than only here is deliberate: a checker that cannot see everything
 * must say so where it is read, or its negative answers carry false authority.
 */

export interface ConsumerFile {
	readonly path: string;
	/** Full text of the consumer, so guard mentions can be found. Injected, keeping this pure. */
	readonly text: string;
}

export interface DeliverableConsumers {
	/** The requirement element this delivers, e.g. `acceptance_criteria`. */
	readonly element: string;
	/** The module that delivers it, e.g. `context-reanchor.ts`. */
	readonly module: string;
	readonly consumers: readonly ConsumerFile[];
}

export interface EnvGateSuspicion {
	readonly element: string;
	readonly module: string;
	/** Flags found in consumers. Empty when none were seen. */
	readonly flags: readonly string[];
	/**
	 * `all` — every consumer mentions a default-OFF flag, so the deliverable may not run at all by default.
	 * `some` — at least one consumer looks ungated, so a live path probably exists.
	 * `none` — no consumer mentions a flag.
	 * `no_consumers` — nothing imports it; that is `unwired-cores`' job, reported here so the two agree.
	 */
	readonly exposure: "all" | "some" | "none" | "no_consumers";
	readonly note: string;
}

export interface EnvGateAudit {
	readonly suspicions: readonly EnvGateSuspicion[];
	/** Deliverables where EVERY consumer is env-gated — the F4.8 shape, and the ones worth reading first. */
	readonly fullyGated: readonly string[];
	/**
	 * Flags seen in the codebase that the hand-maintained MECHANISM_REGISTRY does not know about.
	 *
	 * **THIS IS THE MORE USEFUL OUTPUT, and the reason this scanner is not a duplicate of P15.1b.** That registry
	 * already distinguishes "never enabled" from "enabled but silent" — but it is hand-listed, so it can only
	 * report on mechanisms someone remembered to add. F4.8 slipped through precisely there: the goal re-anchor was
	 * never registered, so nothing could tell anyone it was off. The registry answers "did it fire?"; this answers
	 * "is there something the registry has never heard of?" — and a hand-maintained list needs exactly that.
	 */
	readonly unregisteredFlags: readonly string[];
	readonly summary: string;
}

/** Matches the project's default-OFF idiom. A flag read any other way is invisible here — stated, not hidden. */
const ENV_GUARD_PATTERN = /isTruthyEnv\(\s*process\.env\.([A-Z0-9_]+)\s*\)/g;

export function findEnvGuardFlags(text: string): string[] {
	const flags = new Set<string>();
	// `matchAll` on a fresh regex each call — a shared /g regex carries `lastIndex` between calls and would skip
	// matches on every second invocation, which is the kind of bug that makes a checker quietly under-report.
	for (const match of text.matchAll(new RegExp(ENV_GUARD_PATTERN.source, "g"))) {
		if (match[1]) {
			flags.add(match[1]);
		}
	}
	return [...flags].sort();
}

export function auditEnvGatedDelivery(
	deliverables: readonly DeliverableConsumers[],
	/** Flags the MECHANISM_REGISTRY already tracks. Anything else found is reported as unregistered. */
	registeredFlags: readonly string[] = [],
): EnvGateAudit {
	const suspicions: EnvGateSuspicion[] = [];

	for (const deliverable of deliverables) {
		if (deliverable.consumers.length === 0) {
			suspicions.push({
				element: deliverable.element,
				module: deliverable.module,
				flags: [],
				exposure: "no_consumers",
				note: "No consumer at all — this is an unwired core, not an env-gating question.",
			});
			continue;
		}

		const flagsByConsumer = deliverable.consumers.map((consumer) => findEnvGuardFlags(consumer.text));
		const allFlags = [...new Set(flagsByConsumer.flat())].sort();
		const gatedCount = flagsByConsumer.filter((flags) => flags.length > 0).length;

		const exposure = allFlags.length === 0 ? "none" : gatedCount === deliverable.consumers.length ? "all" : "some";

		suspicions.push({
			element: deliverable.element,
			module: deliverable.module,
			flags: allFlags,
			exposure,
			note:
				exposure === "all"
					? `EVERY consumer mentions a default-OFF flag (${allFlags.join(", ")}). This is the F4.8 shape: the import chain is complete while nothing may run by default. VERIFY BY READING — this check cannot prove the guard wraps the call.`
					: exposure === "some"
						? `${gatedCount}/${deliverable.consumers.length} consumer(s) mention ${allFlags.join(", ")}; at least one looks ungated, so a live path probably exists.`
						: "No default-OFF flag seen in any consumer.",
		});
	}

	const fullyGated = suspicions.filter((s) => s.exposure === "all").map((s) => `${s.element} (${s.module})`);

	const known = new Set(registeredFlags);
	const unregisteredFlags = [...new Set(suspicions.flatMap((s) => s.flags))].filter((flag) => !known.has(flag)).sort();

	return {
		suspicions,
		fullyGated,
		unregisteredFlags,
		summary:
			fullyGated.length === 0
				? `No deliverable had ALL of its consumers env-gated. ⚠️ This checker only looks for the \`isTruthyEnv(process.env.X)\` idiom inside consumer files — it cannot prove a guard wraps a call, and a flag read another way is invisible to it. A clean result means NOTHING WAS FOUND, not that every path runs.`
				: `${fullyGated.length} deliverable(s) have EVERY consumer behind a default-OFF flag — the F4.8 shape: ${fullyGated.join("; ")}. Each needs reading; this check reports suspicion, never a verdict.`,
	};
}
