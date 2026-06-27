// §5.AB: build the "ask a more capable model to analyze this stuck task" request — the user-chosen rescue option.
//
// When the AUTOMATIC ladder is exhausted (`isHardStuck`) and the user opts (a Layer-2 suggestion) to make a stronger
// model available, this turns the §5.AG "what was tried" escalation report into a compact, structured ANALYSIS prompt:
// it asks the analyst model for a root-cause read + a concrete remediation plan (steps/edits to try, what to avoid, how
// to verify) — explicitly NOT a finished patch (the implementing agent applies the guidance). Compact by design (the
// rendered attempt chain is capped) so it stays well within the ≥32k context floor even on long histories. Pure;
// mirrors the existing advisor-prompt builders (`{ title, prompt }`).
import type { TaskEscalationReport } from "./agent-attempt-ledger";

export interface StuckTaskAnalysisRequest {
	title: string;
	prompt: string;
}

/** Cap the rendered attempt chain so the analysis prompt stays bounded on long histories (most-recent kept). */
export const MAX_RENDERED_ANALYSIS_ATTEMPTS = 16;

export function buildStuckTaskAnalysisRequest(report: TaskEscalationReport): StuckTaskAnalysisRequest {
	const title = `Analyze stuck task ${report.taskId}`;

	if (report.totalAttempts === 0) {
		// Nothing recorded — still produce a usable prompt rather than an empty one.
		const prompt = [
			`Task "${report.taskId}" is stuck, but no attempt history was recorded.`,
			"",
			"As a more capable analyst model, infer the likely failure modes for a small local model on a coding task and",
			"return a concrete remediation plan: root-cause hypotheses, the specific steps/edits to try, what to avoid, and",
			"how to verify. Do NOT write the final patch — produce guidance the implementing agent will follow.",
		].join("\n");
		return { title, prompt };
	}

	const shown = report.attempts.slice(-MAX_RENDERED_ANALYSIS_ATTEMPTS);
	const omitted = report.totalAttempts - shown.length;
	const chain = shown.map((row) => {
		const quality = row.qualityScore !== null ? ` q=${row.qualityScore.toFixed(2)}` : "";
		const salvage = row.salvage ? ` salvage=${row.salvage}` : "";
		return `  - rung ${row.rung}: ${row.modelId} · ${row.approach} → ${row.outcome}${quality}${salvage}`;
	});

	const prompt = [
		`A small local-model agent is HARD-STUCK on task "${report.taskId}" — !Klein's automatic recovery is exhausted`,
		"(all approaches retried across every available loaded model). " +
			`It made ${report.totalAttempts} attempt(s) across ${report.modelsTried.length} model(s)` +
			`${report.modelsTried.length > 0 ? ` [${report.modelsTried.join(", ")}]` : ""}; ` +
			`final outcome: ${report.finalOutcome ?? "unknown"}.`,
		"",
		omitted > 0 ? `What was tried (most recent ${shown.length} of ${report.totalAttempts}):` : "What was tried:",
		...chain,
		"",
		"As a more capable analyst model, diagnose WHY this is stuck and return a concrete REMEDIATION PLAN:",
		"  1. Root-cause read — the most likely reason(s) the smaller model cannot get through.",
		"  2. The specific steps/edits to try next (ordered, concrete).",
		"  3. What to avoid (approaches already shown not to work, or likely dead ends).",
		"  4. How to verify the fix.",
		"",
		"Do NOT write the final patch — produce clear guidance the implementing agent will follow on its next turn.",
	].join("\n");

	return { title, prompt };
}
