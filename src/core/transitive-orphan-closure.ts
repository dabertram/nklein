/**
 * P15.7c — TRANSITIVE orphan closure: "has a consumer" is not "reaches production". PURE core.
 *
 * P15.1's scan is one level deep. It asks whether a symbol is mentioned by non-test code, and a single mention is
 * enough to call it wired. That is exactly wrong when the mentioning module is itself dead, and the live example
 * was already sitting in P15.7b's own output:
 *
 *   retry-policy::planNextAttempt  →  consumed ONLY by adaptive-attempt-loop.ts
 *   adaptive-attempt-loop.ts       →  ZERO importers
 *
 * So `planNextAttempt` reported `satisfied` while its entire chain reaches no live path. The requirement audit
 * read green on a dead branch. **A one-level scan cannot distinguish "wired" from "wired to something dead", and
 * the difference is the whole question.**
 *
 * ── THE FIXED POINT ──
 * Iterate: a core module is DEAD when every one of its exports is orphaned; references originating from a dead
 * module do not count as consumption; recompute. Repeat until nothing changes. Killing one module can orphan the
 * symbols it was the last consumer of, which can kill the next module — the cascade is the point, and it is why a
 * single extra pass would not do.
 *
 * ── THE CONSERVATIVE DIRECTION, CHOSEN DELIBERATELY ──
 * Only modules in `src/core` are eligible to be judged dead. A reference from anywhere else — a command, the
 * runtime, the web UI — always counts as live, because this scan does not model those reachability graphs and
 * **guessing in that direction would report a genuinely-wired core as orphaned.** That is the expensive error:
 * it invites someone to delete working code. Under-reporting merely leaves a real orphan hidden for longer, which
 * is where the codebase already was. So when uncertain this module says "wired", and the count it produces is a
 * FLOOR on the orphan set, never a ceiling.
 *
 * ── THE LIMIT, STATED RATHER THAN HIDDEN: A CYCLE OF DEAD MODULES KEEPS ITSELF ALIVE ──
 * If `a.ts` and `b.ts` reference each other and nothing else references either, both are unreachable and this
 * algorithm reports both as WIRED. That is not an oversight to fix later with a special case — **reference
 * counting provably cannot detect cycles**; only mark-and-sweep from known roots can, and that needs an entry-point
 * graph this module deliberately does not model. The limitation is asserted by a test so a reader who assumes
 * "this finds all dead code" is corrected by the suite rather than by a bad deletion months later. It also sits on
 * the safe side of the conservative direction above: a missed orphan, not a false one.
 */

export interface SymbolRef {
	readonly module: string;
	readonly name: string;
}

export interface ReferenceSite {
	/** Path of the file containing the reference, e.g. `src/core/foo.ts` or `src/commands/bar.ts`. */
	readonly file: string;
	readonly line: string;
}

export interface ClosureInput {
	readonly symbols: readonly SymbolRef[];
	/** `module::name` → the sites that reference it. Comment-only sites should already be filtered by the caller. */
	readonly referenceSites: ReadonlyMap<string, readonly ReferenceSite[]>;
	/** Directory prefix whose modules may be judged dead. Everything outside it counts as live. */
	readonly coreDirPrefix?: string;
}

export interface ClosureResult {
	/** `module::name` keys with no LIVE consumer, after the cascade. */
	readonly orphanKeys: ReadonlySet<string>;
	/** Core modules where every export is orphaned. */
	readonly deadModules: readonly string[];
	/** Keys that a one-level scan called wired but the closure does not — the value this module adds. */
	readonly newlyOrphanedByClosure: readonly string[];
	/** How many passes the fixed point took. >1 means a real cascade occurred. */
	readonly passes: number;
	readonly summary: string;
}

const DEFAULT_CORE_PREFIX = "src/core/";

/** The core module a file belongs to, or `null` when the file is outside the judgeable set. */
function coreModuleOf(file: string, prefix: string): string | null {
	if (!file.startsWith(prefix)) {
		return null;
	}
	const rest = file.slice(prefix.length);
	return rest.includes("/") ? null : rest;
}

/**
 * Compute the transitive orphan set.
 *
 * Terminates by construction: the dead-module set only ever grows, and it is bounded by the module count, so the
 * loop runs at most once per module. The pass counter is returned rather than discarded because `passes > 1` is
 * the evidence that a cascade happened — the case a one-level scan provably cannot reach.
 */
export function computeTransitiveOrphanClosure(input: ClosureInput): ClosureResult {
	const prefix = input.coreDirPrefix ?? DEFAULT_CORE_PREFIX;

	const exportsByModule = new Map<string, string[]>();
	for (const symbol of input.symbols) {
		const bucket = exportsByModule.get(symbol.module) ?? [];
		bucket.push(`${symbol.module}::${symbol.name}`);
		exportsByModule.set(symbol.module, bucket);
	}

	const deadModules = new Set<string>();
	let orphanKeys = new Set<string>();
	let firstPassOrphans: ReadonlySet<string> = new Set();
	let passes = 0;

	for (;;) {
		passes += 1;
		const nextOrphans = new Set<string>();
		for (const symbol of input.symbols) {
			const key = `${symbol.module}::${symbol.name}`;
			const sites = input.referenceSites.get(key) ?? [];
			const liveSites = sites.filter((site) => {
				const module = coreModuleOf(site.file, prefix);
				// Outside the core dir → not judgeable → counts as live. See the conservative-direction note.
				return module === null || !deadModules.has(module);
			});
			if (liveSites.length === 0) {
				nextOrphans.add(key);
			}
		}
		if (passes === 1) {
			firstPassOrphans = new Set(nextOrphans);
		}
		orphanKeys = nextOrphans;

		let grew = false;
		for (const [module, keys] of exportsByModule) {
			if (deadModules.has(module)) {
				continue;
			}
			if (keys.every((key) => orphanKeys.has(key))) {
				deadModules.add(module);
				grew = true;
			}
		}
		if (!grew) {
			break;
		}
	}

	const newlyOrphanedByClosure = [...orphanKeys].filter((key) => !firstPassOrphans.has(key)).sort();

	return {
		orphanKeys,
		deadModules: [...deadModules].sort(),
		newlyOrphanedByClosure,
		passes,
		summary:
			newlyOrphanedByClosure.length === 0
				? `Closure adds nothing: ${orphanKeys.size} orphan(s) across ${deadModules.size} dead module(s) in ${passes} pass(es). Every wired symbol is wired to something live.`
				: `Closure found ${newlyOrphanedByClosure.length} symbol(s) that a one-level scan called WIRED but which are consumed only by dead code: ${newlyOrphanedByClosure.join(", ")}. ${deadModules.size} dead module(s), ${passes} pass(es).`,
	};
}
