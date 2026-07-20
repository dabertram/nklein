/**
 * P15.7 — REQUIREMENT-level coverage: do all the elements of a requirement actually reach production? PURE core.
 *
 * This project already has three instruments for the "mechanisms have outrun proof" problem, and each answers a
 * different question:
 *  - `unwired-core-audit.ts` (P15.1) — *does this MODULE have a consumer?*
 *  - `mechanism-observation-audit.ts` (P15.1b) — *does this MECHANISM ever fire at runtime?*
 *  - `capability-index.ts` (P15.6) — *does a core already do X?* (duplication prevention)
 *
 * None of them catches the failure that turned up three separate times on 2026-07-20, because it is invisible at
 * module granularity:
 *  - **F4.8** — "retain objective, current focus, constraints, acceptance criteria". Two re-anchor cores split the
 *    requirement; the wired one carries the first two, the one carrying acceptance criteria has zero importers.
 *  - **F3.8** — the retry engine's per-outcome ladder has no consumer that acts on WHICH rung it returns; the one
 *    production caller pins its inputs and reads a boolean.
 *  - **P15.1** — 119 fully-orphaned modules, several of them the second half of something already shipped.
 *
 * The shape is always the same: **every module passes its own tests, every module is individually defensible, and
 * the REQUIREMENT is still unmet** — because requirements span modules and nothing was checking at that level.
 * A green suite is compatible with a half-connected feature, which is exactly the gap the project charter names.
 *
 * ── THE CLASSIFICATION IS THE WHOLE VALUE ──
 * "Not built" and "built but not connected" need different people doing different work, and merging them sends
 * someone to rebuild a core that already exists. So they stay separate, and a third bucket stays separate too:
 * an element with NO recorded provider is reported as `no_provider_recorded`, **never as "not built"**. This map is
 * hand-maintained; absence from it is absence of evidence. Claiming otherwise would make the tool confidently
 * wrong in the one direction that wastes the most work.
 */

/** `module::symbol`, matching `unwired-core-audit`'s key format. */
export type SymbolKey = string;

export interface ElementProvider {
	readonly module: string;
	readonly symbol: string;
}

export interface RequirementElementSpec {
	/** The named sub-requirement, e.g. "acceptance_criteria". */
	readonly element: string;
	/** Which exported symbol is supposed to deliver it, or `null` when nothing has been mapped yet. */
	readonly providedBy: ElementProvider | null;
}

export interface RequirementSpec {
	/** Backlog id, e.g. "F4.8". */
	readonly id: string;
	readonly elements: readonly RequirementElementSpec[];
}

export type ElementStatus = "satisfied" | "built_but_unwired" | "no_provider_recorded";

export interface ElementFinding {
	readonly element: string;
	readonly status: ElementStatus;
	readonly provider: ElementProvider | null;
	readonly detail: string;
}

export interface RequirementCoverage {
	readonly id: string;
	readonly findings: readonly ElementFinding[];
	readonly satisfied: readonly string[];
	readonly builtButUnwired: readonly string[];
	readonly noProviderRecorded: readonly string[];
	readonly passed: boolean;
	readonly summary: string;
}

/**
 * Audit one requirement against the set of symbols known to have no real consumer.
 *
 * `orphanKeys` should come from `auditUnwiredCores` — the wired/unwired judgement is COMPUTED from the source
 * rather than declared here, so the only hand-maintained part is the element→provider map. That matters: a
 * hand-maintained "wired: true" flag would rot silently into a false pass the first time someone deleted a caller.
 */
export function auditRequirementCoverage(
	spec: RequirementSpec,
	orphanKeys: ReadonlySet<SymbolKey>,
): RequirementCoverage {
	const findings: ElementFinding[] = spec.elements.map((element) => {
		if (element.providedBy === null) {
			return {
				element: element.element,
				status: "no_provider_recorded" as const,
				provider: null,
				detail: `no provider recorded for "${element.element}" — this map is hand-maintained, so that is absence of EVIDENCE, not evidence the element is unbuilt`,
			};
		}
		const key = `${element.providedBy.module}::${element.providedBy.symbol}`;
		if (orphanKeys.has(key)) {
			return {
				element: element.element,
				status: "built_but_unwired" as const,
				provider: element.providedBy,
				detail: `"${element.element}" is delivered by ${key}, which has NO consumer — the element is built and never connected, so the fix is a wire rather than a new core`,
			};
		}
		return {
			element: element.element,
			status: "satisfied" as const,
			provider: element.providedBy,
			detail: `"${element.element}" is delivered by ${key}, which has at least one real consumer`,
		};
	});

	const pick = (status: ElementStatus) => findings.filter((f) => f.status === status).map((f) => f.element);
	const satisfied = pick("satisfied");
	const builtButUnwired = pick("built_but_unwired");
	const noProviderRecorded = pick("no_provider_recorded");
	const passed = builtButUnwired.length === 0 && noProviderRecorded.length === 0;

	const parts: string[] = [];
	if (builtButUnwired.length > 0) {
		parts.push(`BUILT BUT UNWIRED: ${builtButUnwired.join(", ")} (fix = a wire)`);
	}
	if (noProviderRecorded.length > 0) {
		parts.push(`NO PROVIDER RECORDED: ${noProviderRecorded.join(", ")} (unknown, not proven absent)`);
	}

	return {
		id: spec.id,
		findings,
		satisfied,
		builtButUnwired,
		noProviderRecorded,
		passed,
		summary: passed
			? `${spec.id}: all ${satisfied.length} element(s) reach a live consumer.`
			: `${spec.id}: ${satisfied.length}/${spec.elements.length} element(s) reach production. ${parts.join("; ")}`,
	};
}

export interface CoverageSweep {
	readonly coverages: readonly RequirementCoverage[];
	readonly failing: readonly RequirementCoverage[];
	readonly summary: string;
}

/**
 * Sweep every tracked requirement.
 *
 * A requirement with ZERO elements is treated as failing rather than trivially passing — an empty spec asserts
 * nothing while looking green, the same hazard `resolvePack` refuses in N5.
 */
export function sweepRequirementCoverage(
	specs: readonly RequirementSpec[],
	orphanKeys: ReadonlySet<SymbolKey>,
): CoverageSweep {
	const coverages = specs.map((spec) =>
		spec.elements.length === 0
			? {
					id: spec.id,
					findings: [],
					satisfied: [],
					builtButUnwired: [],
					noProviderRecorded: [],
					passed: false,
					summary: `${spec.id}: NO elements declared — an empty requirement spec asserts nothing while appearing to pass.`,
				}
			: auditRequirementCoverage(spec, orphanKeys),
	);
	const failing = coverages.filter((coverage) => !coverage.passed);
	return {
		coverages,
		failing,
		summary:
			failing.length === 0
				? `All ${coverages.length} tracked requirement(s) fully reach production.`
				: `${failing.length}/${coverages.length} requirement(s) do NOT fully reach production — every one of them can still have a fully green test suite, which is the point of checking at this level. ${failing.map((f) => f.summary).join(" | ")}`,
	};
}
