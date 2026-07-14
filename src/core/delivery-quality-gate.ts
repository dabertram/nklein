/**
 * Delivery quality gate (pure) — the bridge that composes the opencode-swarm-ported diff scanners
 * ({@link scanForPlaceholders} + {@link assessQualityBudget}) into ONE hold decision the delivery seam can act on,
 * mirroring how {@link findWorkPackageBoundaryViolations} feeds `delivery_boundary_hold`. Given a card's changed files
 * WITH their added-line content, it decides whether the delivery should HOLD on quality grounds (stubs / oversized /
 * undertested / duplicated) and assembles the operator-facing reasons.
 *
 * Pure + deterministic: the effectful b-leaf parses the delivered diff into {@link DeliveryQualityFile}s (added lines
 * per file) and maps `hold === true` to a `delivery_quality_hold` ledger transition. Each sub-gate is independently
 * toggleable (a project can run stubs-only, or budget-only) but both default ON — the §4A "no built-but-not-wired"
 * stance made enforceable at delivery.
 */

import { type PlaceholderScanConfig, type PlaceholderScanResult, scanForPlaceholders } from "./placeholder-scan.js";
import {
	assessQualityBudget,
	DEFAULT_QUALITY_BUDGET_CONFIG,
	type QualityBudgetConfig,
	type QualityBudgetResult,
} from "./quality-budget.js";

export interface DeliveryQualityFile {
	readonly path: string;
	/** The lines this card ADDED for this file (diff `+` lines) — what both scanners inspect. */
	readonly addedLines: readonly string[];
	/** Whether this is a test file (forwarded to the quality budget; derived from path when omitted). */
	readonly isTest?: boolean;
}

export interface DeliveryQualityGateConfig {
	/** Run the placeholder/stub scan (default true). */
	readonly placeholderScanEnabled?: boolean;
	/** Run the quality budget (default true). */
	readonly qualityBudgetEnabled?: boolean;
	readonly placeholderScanConfig?: PlaceholderScanConfig;
	readonly qualityBudgetConfig?: QualityBudgetConfig;
}

export interface DeliveryQualityResult {
	/** True when any enabled sub-gate raised a finding — the delivery HOLD signal. */
	readonly hold: boolean;
	readonly placeholder: PlaceholderScanResult | null;
	readonly quality: QualityBudgetResult | null;
	/** Combined, operator-facing hold reasons (empty when clean). */
	readonly holdReasons: readonly string[];
}

export function assessDeliveryQuality(
	files: readonly DeliveryQualityFile[],
	config: DeliveryQualityGateConfig = {},
): DeliveryQualityResult {
	const placeholderEnabled = config.placeholderScanEnabled !== false;
	const qualityEnabled = config.qualityBudgetEnabled !== false;

	const placeholder = placeholderEnabled
		? scanForPlaceholders(
				files.map((file) => ({ path: file.path, content: file.addedLines.join("\n") })),
				config.placeholderScanConfig,
			)
		: null;

	const quality = qualityEnabled
		? assessQualityBudget(
				files.map((file) => ({ path: file.path, addedLines: file.addedLines, isTest: file.isTest })),
				config.qualityBudgetConfig ?? DEFAULT_QUALITY_BUDGET_CONFIG,
			)
		: null;

	const holdReasons: string[] = [];
	if (placeholder && placeholder.hasPlaceholders) {
		for (const finding of placeholder.findings) {
			holdReasons.push(`placeholder (${finding.kind}) at ${finding.path}:${finding.line} — ${finding.snippet}`);
		}
	}
	if (quality && !quality.withinBudget) {
		for (const violation of quality.violations) {
			holdReasons.push(
				`quality (${violation.kind})${violation.path ? ` at ${violation.path}` : ""} — ${violation.detail}`,
			);
		}
	}

	return {
		hold: holdReasons.length > 0,
		placeholder,
		quality,
		holdReasons,
	};
}
