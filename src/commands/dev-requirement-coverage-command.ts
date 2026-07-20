/**
 * P15.7b — `nklein dev requirement-coverage`: do all the elements of a tracked requirement reach production?
 *
 * Reuses `dev unwired-cores`' scan rather than growing a second one. A requirement audit reading a
 * slightly-different orphan set than the orphan report would be worse than having neither, because the two would
 * disagree and there would be no way to tell which was right.
 */

import { sweepRequirementCoverage } from "../core/requirement-coverage-audit";
import { TRACKED_REQUIREMENTS } from "../core/tracked-requirements";
import { auditUnwiredCores } from "../core/unwired-core-audit";
import { scanCoreSymbolReferences } from "./dev-unwired-cores-command";

export async function runDevRequirementCoverageCommand(options: {
	json?: boolean;
	roots?: readonly string[];
}): Promise<void> {
	// EXCLUDE the tracked-requirement map: it names every symbol it audits, so counting its mentions would let the
	// audit manufacture the evidence that it passes. The first live run did exactly that — both requirements known
	// to be half-wired reported green, because the map itself was their only "consumer".
	const { symbols, referenceLines } = scanCoreSymbolReferences({
		roots: options.roots,
		excludeFiles: ["src/core/tracked-requirements.ts"],
	});
	const orphanKeys = new Set(
		auditUnwiredCores({ symbols, referenceLines }).orphans.map((orphan) => `${orphan.module}::${orphan.name}`),
	);

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

	process.stdout.write(
		"A FAIL here is compatible with a fully green test suite — that is the point of checking at this level.\n" +
			"'built_but_unwired' means the fix is a WIRE, not a new core. '?' means no provider is recorded, which is\n" +
			"absence of evidence (this map is hand-maintained), NOT proof the element is unbuilt.\n\n" +
			"⚠️ ORPHAN-NESS IS NOT TRANSITIVE in this scan: a symbol whose only consumer is ITSELF an orphan still\n" +
			"counts as wired. So a requirement can read green here while its chain dead-ends one level up.\n",
	);
}
