import type { JSX } from "react";
import type { RuntimeModelTuningResponse } from "@/runtime/types";

function formatTokens(value: number | null): string {
	if (value === null || !Number.isFinite(value)) {
		return "—";
	}
	return Math.round(value).toLocaleString();
}

/** Drop the `provider:` prefix so the table stays readable (mirrors the dialog's shortModelId). */
function shortModelId(modelId: string): string {
	const parts = modelId.split(":");
	return parts[1] ?? modelId;
}

/**
 * Presentational model-tuning table: the three learned per-model budgets — context cap (F4.9), answer budget (F4.10),
 * and retry budget (F3.30) — that `dev context-recommendations` / `dev answer-budgets` / `dev retry-budgets` expose on
 * the CLI. Pure/data-in (the dialog owns fetching), so it render-tests without mocking the runtime. Renders nothing
 * until there is at least one model row (an empty fleet history has no budgets to show).
 */
export function ModelTuningPanel({ tuning }: { tuning: RuntimeModelTuningResponse | null }): JSX.Element | null {
	if (!tuning || tuning.models.length === 0) {
		return null;
	}
	return (
		<div className="mb-3 overflow-x-auto rounded-md border border-border" data-testid="model-tuning-recommendations">
			<div className="bg-surface-0 px-2 py-1 font-semibold text-[12px] text-text-primary">
				Model tuning — learned budgets from real history (context F4.9 / answer F4.10 / retry F3.30)
			</div>
			<table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
				<thead className="bg-surface-0 text-text-secondary">
					<tr>
						<th className="px-2 py-1 font-medium">Model</th>
						<th className="px-2 py-1 font-medium">Context cap (tok)</th>
						<th className="px-2 py-1 font-medium">Answer budget (tok)</th>
						<th className="px-2 py-1 font-medium">Retry budget</th>
						<th className="px-2 py-1 font-medium">Samples</th>
					</tr>
				</thead>
				<tbody>
					{tuning.models.map((row) => (
						<tr
							key={row.modelId}
							className="border-t border-border bg-surface-2 text-text-primary"
							data-testid="model-tuning-row"
						>
							<td className="px-2 py-1">{shortModelId(row.modelId)}</td>
							<td className="px-2 py-1">{formatTokens(row.contextCapTokens)}</td>
							<td className="px-2 py-1">
								{row.answerBudgetTokens === null ? (
									"—"
								) : (
									<span className={row.answerBudgetConfident ? undefined : "text-text-tertiary"}>
										{formatTokens(row.answerBudgetTokens)}
										{row.answerBudgetConfident ? "" : " (low)"}
									</span>
								)}
							</td>
							<td className="px-2 py-1">{row.retryBudget === null ? "—" : String(row.retryBudget)}</td>
							<td className="px-2 py-1">{formatTokens(row.sampleCount)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
