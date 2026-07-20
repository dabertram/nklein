/**
 * P15.7b — `nklein dev requirement-coverage`: do all the elements of a tracked requirement reach production?
 *
 * Reuses `dev unwired-cores`' scan rather than growing a second one. A requirement audit reading a
 * slightly-different orphan set than the orphan report would be worse than having neither, because the two would
 * disagree and there would be no way to tell which was right.
 */

import { sweepRequirementCoverage } from "../core/requirement-coverage-audit";
import { TRACKED_REQUIREMENTS } from "../core/tracked-requirements";
import { computeTransitiveOrphanClosure } from "../core/transitive-orphan-closure";
import { isCommentMention } from "../core/unwired-core-audit";
import { scanCoreSymbolReferences } from "./dev-unwired-cores-command";

export async function runDevRequirementCoverageCommand(options: {
	json?: boolean;
	roots?: readonly string[];
}): Promise<void> {
	// EXCLUDE the tracked-requirement map: it names every symbol it audits, so counting its mentions would let the
	// audit manufacture the evidence that it passes. The first live run did exactly that — both requirements known
	// to be half-wired reported green, because the map itself was their only "consumer".
	const { symbols, referenceSites } = scanCoreSymbolReferences({
		roots: options.roots,
		excludeFiles: ["src/core/tracked-requirements.ts"],
	});
	// P15.7c: use the TRANSITIVE closure, not the one-level scan. "Has a consumer" is not "reaches production" —
	// a symbol whose only consumer is itself dead reaches nothing, and the one-level answer reported it satisfied.
	// Comment-only sites are dropped first: a docblock mention is not consumption.
	const codeSites = new Map(
		[...referenceSites].map(([key, sites]) => [key, sites.filter((site) => !isCommentMention(site.line))]),
	);
	const closure = computeTransitiveOrphanClosure({ symbols, referenceSites: codeSites });
	const orphanKeys = closure.orphanKeys;

	const sweep = sweepRequirementCoverage(TRACKED_REQUIREMENTS, orphanKeys);

	if (options.json) {
		process.stdout.write(`${JSON.stringify(sweep, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${sweep.summary}\n\n`);
	for (const coverage of sweep.coverages) {
		const mark = coverage.passed ? "OK  " : "FAIL";
		process.stdout.write(`${mark} ${coverage.id}\n`);
		for (const finding of coverage.findings) {
			const label = finding.status === "satisfied" ? "  ✓" : finding.status === "built_but_unwired" ? "  ✗" : "  ?";
			process.stdout.write(`${label} ${finding.element}: ${finding.detail}\n`);
		}
		process.stdout.write("\n");
	}

	if (closure.newlyOrphanedByClosure.length > 0) {
		process.stdout.write(`${closure.summary}\n\n`);
	}
	process.stdout.write(
		"A FAIL here is compatible with a fully green test suite — that is the point of checking at this level.\n" +
			"'built_but_unwired' means the fix is a WIRE, not a new core. '?' means no provider is recorded, which is\n" +
			"absence of evidence (this map is hand-maintained), NOT proof the element is unbuilt.\n\n" +
			"Orphan-ness IS transitive here (P15.7c): a symbol consumed only by dead code counts as unwired.\n" +
			"⚠️ REMAINING LIMIT: a CYCLE of dead modules keeps itself alive — reference counting cannot detect\n" +
			"cycles, only mark-and-sweep from roots can. So this count is a FLOOR on the orphan set, never a ceiling.\n",
	);
}
