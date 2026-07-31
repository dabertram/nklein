/**
 * Transitive import reachability over the source tree. PURE, with file reads injected.
 *
 * ── WHY THIS EXISTS ──
 * Several backlog items express a capability boundary as *"X must be unreachable from Y"* rather than *"X should
 * not be called from Y"* — P25.3 phase 3 (model acquisition must be unreachable from the autonomous runtime) is
 * the first, and the distinction is the whole point: "nobody calls it" is a fact about today, and a refactor can
 * change it without anyone noticing. Reachability is a property of the graph, so it can be checked.
 *
 * ── THE FAILURE MODE THIS CORE IS SHAPED AROUND ──
 * A reachability test is only as good as its edge extraction, and **every way of getting it wrong makes the
 * closure SMALLER, which makes a "not reachable" assertion PASS.** A resolver that silently returns null for an
 * import style it does not understand turns the whole check green while measuring nothing — the same vacuous pass
 * a forgeable grader produces.
 *
 * Two deliberate consequences:
 *  - Unresolved RELATIVE specifiers are REPORTED, not skipped, so the caller can assert there are none. A relative
 *    import that does not resolve is a missing edge, and a missing edge is a hole in the guarantee.
 *  - Extraction deliberately OVER-approximates: a specifier inside a comment or a string still becomes an edge.
 *    Over-approximation can only add reachability, which can only make a "must not be reachable" assertion
 *    stricter. Under-approximation is the direction that produces false safety, so the bias is chosen on purpose.
 */

import { dirname, join, normalize } from "node:path/posix";

/**
 * Extract every module specifier that could create an edge.
 *
 * Covers `import … from "x"`, `export … from "x"`, bare `import "x"`, and dynamic `import("x")` — including the
 * `import type` forms, which are erased at runtime but are still a structural dependency and exactly how a
 * capability leaks back into a module's surface.
 */
export function parseImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/gu)) {
		specifiers.push(match[1] as string);
	}
	for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
		specifiers.push(match[1] as string);
	}
	for (const match of source.matchAll(/\bimport\s+["']([^"']+)["']/gu)) {
		specifiers.push(match[1] as string);
	}
	// Prose, not code. A comment reading `"why recalled / where from". */` matches the `from`-then-quote pattern
	// above and captures the rest of the file up to the next quote — found by this codebase, not imagined. A real
	// module specifier never contains whitespace, so dropping whitespace-bearing candidates removes the noise
	// without removing a single real edge, which keeps the over-approximation bias intact where it matters.
	return specifiers.filter((specifier) => !/\s/u.test(specifier));
}

/**
 * Relative imports that cannot extend the closure.
 *
 * A `.json` import (this codebase reads `../../package.json` for its version in four places) is a real edge to a
 * real file — but that file imports nothing, so it is a LEAF. Reporting it as unresolved would be a false alarm in
 * a list whose whole value is that it should be empty; following it would add nothing. Dropping a leaf cannot hide
 * reachability, which is why this is safe in a way that dropping an unrecognised `.ts` import would not be.
 */
const NON_SOURCE_EXTENSIONS = [".json", ".css", ".scss", ".svg", ".png", ".jpg", ".txt", ".md", ".wasm"];

export function isNonSourceSpecifier(specifier: string): boolean {
	return NON_SOURCE_EXTENSIONS.some((extension) => specifier.endsWith(extension));
}

/**
 * Resolve a relative specifier to a known file, or null if it is not relative.
 *
 * **The `.js` → `.ts` rewrite is load-bearing.** This codebase mixes extensionless imports with explicit `.js`
 * suffixes (`./null-agent-baseline.js`) for ESM output. Without the rewrite every such import resolves to nothing,
 * the edge vanishes, and the closure quietly shrinks — silently weakening exactly the assertions this exists to
 * make.
 */
export function resolveRelativeSpecifier(
	fromFile: string,
	specifier: string,
	knownFiles: ReadonlySet<string>,
): string | null {
	if (!specifier.startsWith(".")) {
		return null;
	}
	const base = normalize(join(dirname(fromFile), specifier));
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}/index.ts`,
		...(base.endsWith(".js") ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`] : []),
	];
	return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

export interface ImportClosureResult {
	/** Every file reachable from the entry points, including the entry points themselves. */
	readonly reached: ReadonlySet<string>;
	/**
	 * Relative specifiers that resolved to nothing — each one a MISSING EDGE.
	 *
	 * Non-empty means the closure is incomplete and any "not reachable" conclusion drawn from it is unsound.
	 * Callers should assert this is empty rather than inspect it.
	 */
	readonly unresolvedRelative: readonly { readonly from: string; readonly specifier: string }[];
}

/** Walk imports forward from `entryPoints`. Direction matters: A importing B does not make A reachable from B. */
export function computeImportClosure(input: {
	readonly entryPoints: readonly string[];
	readonly knownFiles: ReadonlySet<string>;
	readonly readSource: (file: string) => string | null;
}): ImportClosureResult {
	const reached = new Set<string>();
	const unresolvedRelative: { from: string; specifier: string }[] = [];
	const queue = input.entryPoints.filter((entry) => input.knownFiles.has(entry));

	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (reached.has(file)) {
			continue;
		}
		reached.add(file);
		const source = input.readSource(file);
		if (source === null) {
			continue;
		}
		for (const specifier of parseImportSpecifiers(source)) {
			if (!specifier.startsWith(".") || isNonSourceSpecifier(specifier)) {
				continue;
			}
			const resolved = resolveRelativeSpecifier(file, specifier, input.knownFiles);
			if (resolved === null) {
				unresolvedRelative.push({ from: file, specifier });
			} else if (!reached.has(resolved)) {
				queue.push(resolved);
			}
		}
	}

	return { reached, unresolvedRelative };
}
