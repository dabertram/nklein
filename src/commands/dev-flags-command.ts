/**
 * `nklein dev flags` — what each default-OFF flag DOES, and which ones N11's lane (b) may safely enable.
 *
 * Lane (b) is worded "all safe opt-ins ON (the dark flags shipped observe-first)". Reading every gate site showed
 * the population is mostly the opposite, so this prints the split rather than a reassuring list: the safe set is
 * small, and everything else changes what the product does for a card.
 */

import { auditFlagCoverage, FEATURE_FLAG_REGISTRY, safeObserveOnlyFlags } from "../core/feature-flag-registry";

export function runDevFlagsCommand(options: { json?: boolean } = {}): void {
	const report = auditFlagCoverage(FEATURE_FLAG_REGISTRY.map((spec) => spec.flag));
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...report, safe: safeObserveOnlyFlags() }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`${report.summary}\n\n`);
	process.stdout.write("SAFE FOR N11 LANE (b) — observe-only:\n");
	for (const flag of safeObserveOnlyFlags()) {
		const spec = FEATURE_FLAG_REGISTRY.find((entry) => entry.flag === flag);
		process.stdout.write(`  ${flag}${spec?.note ? `\n     ⚠️ ${spec.note}` : ""}\n`);
	}
	const unclassified = FEATURE_FLAG_REGISTRY.filter((spec) => spec.mode === "unclassified");
	if (unclassified.length > 0) {
		// Printed, because `unclassified` is the shrinkable number — and never counted as safe above.
		process.stdout.write("\nUNCLASSIFIED — never treated as safe; each needs one honest reading:\n");
		for (const spec of unclassified) {
			process.stdout.write(`  ${spec.flag} — ${spec.note ?? ""}\n`);
		}
	}
}
