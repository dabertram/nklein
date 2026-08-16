// §5.BB S3 (2026-08-16 redesign): the MINIMAL card sheet — what Minimalistic/Clean show when a card is
// opened. Easy first: the card's essence (title, where it is, what's happening right now) plus ONE
// progressive-disclosure affordance into the full detail view. The sheet gates VISIBILITY only — every
// capability stays one tap away behind "Full detail", so nothing is reachable at high zoom that isn't
// reachable here.

import { ArrowLeft, Maximize2 } from "lucide-react";
import type React from "react";

import { Button } from "@/components/ui/button";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { CardSelection } from "@/types";

/** Human line for the session state — beginner-facing, so plain words over lane jargon. */
function sessionStateLine(state: RuntimeTaskSessionSummary["state"] | undefined): string | null {
	switch (state) {
		case "running":
			return "Working on it right now";
		case "queued":
			return "Queued — a worker will pick this up next";
		case "paused":
			return "Paused";
		case "awaiting_review":
			return "Finished a draft — waiting on review";
		case "failed":
			return "Hit a problem — open full detail to see what happened";
		case "interrupted":
			return "Stopped mid-way — open full detail to resume";
		default:
			return null;
	}
}

export function CardSheet({
	selection,
	session,
	reasoningSnippet,
	onOpenFullDetail,
	onBack,
}: {
	selection: CardSelection;
	session: RuntimeTaskSessionSummary | null;
	/** The latest live reasoning snippet for this card (same source the board cards show), if any. */
	reasoningSnippet?: string;
	/** Progressive disclosure: swap this sheet for the full CardDetailView (level stays put). */
	onOpenFullDetail: () => void;
	onBack: () => void;
}): React.ReactElement {
	const { card, column } = selection;
	const title = card.title?.trim() || card.prompt.trim().split("\n")[0] || "Untitled card";
	const promptExcerpt = card.prompt.trim();
	const stateLine = sessionStateLine(session?.state);
	const isLive = session?.state === "running";

	return (
		<div
			className="flex h-full min-h-0 w-full min-w-0 items-start justify-center overflow-y-auto bg-surface-0 px-4 py-8"
			data-testid="card-sheet"
		>
			<div className="flex w-full max-w-xl flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5 shadow-lg">
				<div className="flex items-center gap-2">
					<span
						className="inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] text-text-secondary"
						data-testid="card-sheet-column"
					>
						{column.title}
					</span>
					{isLive ? (
						<span className="inline-flex items-center gap-1.5 rounded-full border border-status-green/40 bg-status-green/10 px-2.5 py-0.5 text-[11px] text-status-green">
							<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-green" />
							live
						</span>
					) : null}
				</div>
				<h2 className="text-lg font-semibold leading-snug text-text-primary" data-testid="card-sheet-title">
					{title}
				</h2>
				{stateLine ? (
					<p className="text-[13px] text-text-secondary" data-testid="card-sheet-state">
						{stateLine}
					</p>
				) : null}
				{reasoningSnippet ? (
					<p
						className="line-clamp-3 border-l-2 border-divider pl-3 text-[12.5px] italic text-text-tertiary"
						data-testid="card-sheet-snippet"
					>
						{reasoningSnippet}
					</p>
				) : null}
				{promptExcerpt ? (
					<p className="line-clamp-6 whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
						{promptExcerpt}
					</p>
				) : null}
				<div className="mt-1 flex items-center justify-between border-t border-divider pt-3">
					<Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>
						Back
					</Button>
					<Button
						variant="primary"
						size="sm"
						icon={<Maximize2 size={14} />}
						onClick={onOpenFullDetail}
						data-testid="card-sheet-full-detail"
					>
						Full detail
					</Button>
				</div>
			</div>
		</div>
	);
}
