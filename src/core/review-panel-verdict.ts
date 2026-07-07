/**
 * §5.AB parallel panel-of-judges — combine N diverse judges' verdicts into ONE merge/block decision (David 2026-07-07
 * decision: "3 diverse judges, MAJORITY + security VETO"). Distinct from {@link import("./review-panel-plan")} (which
 * decides how many LENSES one reviewer wears): this combines the verdicts of SEPARATE, base-family-diverse judge MODELS.
 *
 * The rule:
 *  - **Majority** approves: a merge needs strictly more than half the judges to pass.
 *  - **Security veto** overrides the majority: ANY single judge's HIGH/CRITICAL finding in a veto category
 *    (security / correctness by default) BLOCKS — the one-reviewer-caught-it case must not be outvoted. An UNCATEGORIZED
 *    high/critical finding vetoes too (conservative: a serious concern blocks unless it's explicitly a non-veto category).
 *
 * Pure + deterministic (no I/O, no clock): the orchestration spawns the diverse judges and feeds their verdicts here.
 */

export type PanelVerdictSeverity = "low" | "medium" | "high" | "critical";

export interface PanelJudgeFinding {
	severity: PanelVerdictSeverity;
	/** Optional category / lens (e.g. "security", "correctness", "style"). Governs whether a high finding VETOES. */
	category?: string;
}

export interface PanelJudgeVerdict {
	/** The judging model's stable key — for the audit trail / block reason. */
	judgeModelKey: string;
	/** The judge's overall verdict: pass (no blocking concern) vs fail. */
	pass: boolean;
	/** Findings the judge raised; a high/critical one in a veto category blocks the merge. */
	findings?: readonly PanelJudgeFinding[];
}

export interface PanelVerdictResult {
	decision: "merge" | "block";
	passes: number;
	total: number;
	/** The judge whose high-severity finding vetoed a would-be merge, or null (majority/no-veto path). */
	vetoedBy: string | null;
	reason: string;
}

export interface PanelVerdictOptions {
	/** Whether a single judge's high-severity finding can override a passing majority (default true — David's decision). */
	securityVeto?: boolean;
	/** Categories whose HIGH/CRITICAL findings veto (default security + correctness). Case-insensitive. */
	vetoCategories?: readonly string[];
}

const VETO_SEVERITIES: ReadonlySet<PanelVerdictSeverity> = new Set<PanelVerdictSeverity>(["high", "critical"]);
const DEFAULT_VETO_CATEGORIES: readonly string[] = ["security", "correctness"];

/** The first high/critical finding on a verdict that qualifies to veto (in a veto category, or uncategorized). */
function vetoingFinding(
	verdict: PanelJudgeVerdict,
	vetoCategories: ReadonlySet<string>,
): PanelJudgeFinding | undefined {
	return verdict.findings?.find(
		(finding) =>
			VETO_SEVERITIES.has(finding.severity) &&
			(finding.category === undefined || vetoCategories.has(finding.category.toLowerCase())),
	);
}

/**
 * Combine judge verdicts into a merge/block decision (majority + security veto). Pure. An empty panel BLOCKS (no
 * judgment ⇒ never auto-approve). A tie on an even panel is NOT a majority ⇒ block.
 */
export function combinePanelVerdicts(
	verdicts: readonly PanelJudgeVerdict[],
	options: PanelVerdictOptions = {},
): PanelVerdictResult {
	const total = verdicts.length;
	const passes = verdicts.filter((verdict) => verdict.pass).length;
	if (total === 0) {
		return {
			decision: "block",
			passes: 0,
			total: 0,
			vetoedBy: null,
			reason: "No judge verdicts — a merge is never auto-approved without judgment.",
		};
	}

	const securityVeto = options.securityVeto ?? true;
	if (securityVeto) {
		const vetoCategories = new Set(
			(options.vetoCategories ?? DEFAULT_VETO_CATEGORIES).map((category) => category.toLowerCase()),
		);
		for (const verdict of verdicts) {
			const finding = vetoingFinding(verdict, vetoCategories);
			if (finding) {
				return {
					decision: "block",
					passes,
					total,
					vetoedBy: verdict.judgeModelKey,
					reason: `Blocked by ${verdict.judgeModelKey}: a ${finding.severity} ${finding.category ?? "severity"} finding vetoes the merge — any single judge's high-severity concern blocks, even against a ${passes}/${total} passing majority.`,
				};
			}
		}
	}

	const majority = passes * 2 > total;
	return majority
		? {
				decision: "merge",
				passes,
				total,
				vetoedBy: null,
				reason: `Approved: ${passes}/${total} judges passed (majority), no vetoing finding.`,
			}
		: {
				decision: "block",
				passes,
				total,
				vetoedBy: null,
				reason: `Blocked: only ${passes}/${total} judges passed — no majority.`,
			};
}
