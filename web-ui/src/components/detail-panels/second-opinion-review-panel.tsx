import type React from "react";
import { cn } from "@/components/ui/cn";
import type { RuntimeCardReview } from "@/runtime/types";
import type { CardSelection } from "@/types";

/**
 * The card detail view's second-opinion review panel (todo §5.K), extracted from the oversized `card-detail-view.tsx`
 * (§5.U). Surfaces the reviewer's verdict (status + round) plus the relevant detail for that status — summary,
 * requested changes, sign-off, parked reason, and any insight. Renders nothing until a review has run. Self-contained:
 * reads only `selection.card.review`.
 */

const REVIEW_STATUS_META: Record<RuntimeCardReview["status"], { label: string; className: string }> = {
	in_review: { label: "In review", className: "text-status-blue" },
	changes_requested: { label: "Changes requested", className: "text-status-orange" },
	approved: { label: "Approved", className: "text-status-green" },
	parked: { label: "Parked", className: "text-status-red" },
};

export function SecondOpinionReviewPanel({ selection }: { selection: CardSelection }): React.ReactElement | null {
	const review = selection.card.review;
	if (!review) {
		return null;
	}
	const meta = REVIEW_STATUS_META[review.status];
	return (
		<div className="rounded-lg border border-border bg-surface-1 px-4 py-3">
			<div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
				<span>Second-opinion review</span>
				<span className={cn("font-medium", meta.className)}>{meta.label}</span>
				<span className="font-normal text-text-tertiary">round {review.round}</span>
			</div>
			{review.lastSummary ? (
				<p className="mt-2 mb-0 whitespace-pre-line text-[13px] text-text-primary">{review.lastSummary}</p>
			) : null}
			{review.status === "changes_requested" && review.lastFeedback ? (
				<div className="mt-2">
					<div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
						Requested changes
					</div>
					<p className="mt-1 mb-0 whitespace-pre-line text-[13px] text-text-secondary">{review.lastFeedback}</p>
				</div>
			) : null}
			{review.status === "approved" && review.signOff ? (
				<div className="mt-2">
					<div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Sign-off</div>
					<p className="mt-1 mb-0 whitespace-pre-line text-[13px] text-text-secondary">{review.signOff}</p>
				</div>
			) : null}
			{review.status === "parked" && review.parkedReason ? (
				<p className="mt-2 mb-0 text-[13px] text-status-red">{review.parkedReason}</p>
			) : null}
			{review.lastInsight ? (
				<p className="mt-2 mb-0 whitespace-pre-line text-[12px] text-text-tertiary">
					Insight: {review.lastInsight}
				</p>
			) : null}
		</div>
	);
}
