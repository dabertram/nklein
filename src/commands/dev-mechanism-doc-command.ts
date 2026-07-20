import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	auditMechanismObservations,
	MECHANISM_REGISTRY,
	type MechanismFinding,
} from "../core/mechanism-observation-audit";
import { auditUnwiredCores, type ExportedSymbol, extractExportedSymbols } from "../core/unwired-core-audit";
import { countSelfObservationsByCategory } from "../telemetry/self-observation-sink";

/**
 * P15.1d — generate `docs/dev/mechanism-registry.md` from BOTH scans.
 *
 * The two failure modes are distinct and are deliberately shown side by side, because mistaking one for the
 * other sends the fix in the wrong direction:
 *  - **UNWIRED**: nothing calls it. The code cannot run.
 *  - **SILENT**: it runs and records nothing. The code is reachable, the tests pass, and the feature still never
 *    happens — the subtler failure, and the one that survives a code review.
 *
 * Generated, never hand-maintained: a hand-written registry rots the moment someone ships without updating it,
 * which is exactly when it would matter most.
 */

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

function walkSources(dir: string, out: string[] = []): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry) || entry.startsWith(".")) {
			continue;
		}
		const path = join(dir, entry);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			walkSources(path, out);
		} else if ((path.endsWith(".ts") || path.endsWith(".tsx")) && !path.includes(".test.")) {
			out.push(path);
		}
	}
	return out;
}

function renderFinding(finding: MechanismFinding): string {
	return `| \`${finding.category}\` | ${finding.item} | ${finding.enabledBy ?? "_(always on)_"} | ${finding.expectation} | ${finding.observations} | **${finding.status}** |`;
}

export async function runDevMechanismDocCommand(options: { out?: string }): Promise<void> {
	const outPath = options.out ?? "docs/dev/mechanism-registry.md";

	// --- Scan 1: unwired cores (nothing calls it) -------------------------------------------------
	const coreDir = "src/core";
	const symbols: ExportedSymbol[] = [];
	for (const file of readdirSync(coreDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
		symbols.push(...extractExportedSymbols(file, readFileSync(join(coreDir, file), "utf8")));
	}
	const byName = new Map<string, ExportedSymbol[]>();
	for (const symbol of symbols) {
		const bucket = byName.get(symbol.name) ?? [];
		bucket.push(symbol);
		byName.set(symbol.name, bucket);
	}
	const referenceLines = new Map<string, string[]>();
	for (const file of ["src", "web-ui/src", "packages"].flatMap((root) => walkSources(root))) {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			for (const [name, defs] of byName) {
				if (!line.includes(name)) {
					continue;
				}
				for (const def of defs) {
					if (file === join(coreDir, def.module)) {
						continue;
					}
					const key = `${def.module}::${def.name}`;
					const bucket = referenceLines.get(key) ?? [];
					bucket.push(line);
					referenceLines.set(key, bucket);
				}
			}
		}
	}
	const unwired = auditUnwiredCores({ symbols, referenceLines });

	// --- Scan 2: silent mechanisms (it runs but records nothing) ----------------------------------
	const counts = await countSelfObservationsByCategory().catch(() => new Map<string, number>());
	const flagsOn = new Set<string>();
	for (const entry of MECHANISM_REGISTRY) {
		if (entry.enabledBy && process.env[entry.enabledBy]) {
			flagsOn.add(entry.enabledBy);
		}
	}
	const observed = auditMechanismObservations({
		registry: MECHANISM_REGISTRY,
		countsByCategory: counts,
		knownEnabledFlags: flagsOn,
		windowSaturated: false,
	});

	const totalObs = [...counts.values()].reduce((sum, n) => sum + n, 0);
	const fullyOrphanedModules = (() => {
		const total = new Map<string, number>();
		const orph = new Map<string, number>();
		for (const symbol of symbols) {
			total.set(symbol.module, (total.get(symbol.module) ?? 0) + 1);
		}
		for (const orphan of unwired.orphans) {
			orph.set(orphan.module, (orph.get(orphan.module) ?? 0) + 1);
		}
		return [...orph.entries()]
			.filter(([module, count]) => count === total.get(module))
			.sort((left, right) => right[1] - left[1]);
	})();

	const doc = [
		"# Mechanism registry",
		"",
		"> **GENERATED — do not edit by hand.** Regenerate with `nklein dev mechanism-doc`.",
		"> A hand-maintained registry rots the moment someone ships without updating it, which is exactly when it",
		"> would matter most.",
		"",
		"This report answers two DIFFERENT questions. Mistaking one for the other sends the fix in the wrong",
		"direction, so they are kept side by side:",
		"",
		"1. **Is it wired?** — does anything call it. An unwired core cannot run.",
		"2. **Does it fire?** — it runs and records nothing. Reachable, tests green, feature never happens. This is",
		"   the subtler failure: it survives code review, because the code is there and looks correct.",
		"",
		"## 1. Mechanism firing status",
		"",
		`Tallied **${totalObs}** observation(s) across **${counts.size}** categories — exhaustive, not a capped window.`,
		"",
		"| category | item | enabled by | expectation | observations | status |",
		"| --- | --- | --- | --- | ---: | --- |",
		...observed.findings.map(renderFinding),
		"",
		`**${observed.summary}**`,
		"",
		"Status meanings — note that only ONE of these is actionable:",
		"- `healthy` — demonstrably fires.",
		"- `never_enabled` — its flag was off. **Zero is the CORRECT result, not a smell.**",
		"- `silent_but_exceptional` — fires only on a breach/drift/override, so silence may be evidence of HEALTH.",
		"- `enabled_but_silent` — **actionable.** On, expected every run, recorded nothing.",
		"- `unknown_enablement` — flag history unprovable. Inconclusive, not an accusation.",
		"",
		"## 2. Unwired cores",
		"",
		unwired.summary,
		"",
		`### Modules where EVERY export is orphaned (${fullyOrphanedModules.length})`,
		"",
		...(fullyOrphanedModules.length === 0
			? ["_None._"]
			: fullyOrphanedModules.map(([module, count]) => `- \`${module}\` (${count} export(s))`)),
		"",
		"### Referenced ONLY from comments",
		"",
		"A plain `grep -c` reports these as wired. They are not — every reference is a docblock mention.",
		"",
		...(unwired.commentOnlyOrphans.length === 0
			? ["_None._"]
			: unwired.commentOnlyOrphans.map((orphan) => `- \`${orphan.module}\` :: \`${orphan.name}\``)),
		"",
		"---",
		"",
		"**An orphan is a QUESTION, not a verdict.** It may be a core awaiting its wire, a deliberate public API, or",
		"a core whose lesson was the point — the project's standard is learning value, not consumer count. The scan",
		"is text-level and can miss re-exports and dynamic lookups.",
		"",
	].join("\n");

	writeFileSync(outPath, doc, "utf8");
	process.stdout.write(
		`Wrote ${outPath} (${observed.findings.length} mechanisms, ${unwired.orphans.length} orphaned symbols).\n`,
	);
}
