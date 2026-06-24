import { GitCompareArrows } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Loading + empty presentational states for the card detail view's workspace-changes (diff) panel, extracted from the
 * oversized `card-detail-view.tsx` (todo §5.U). Pure prop-driven skeletons — no state or data fetching — so the detail
 * view can render a placeholder while diffs load and a centered empty state when there are none.
 */

function SkeletonLine({ width, mb }: { width: string; mb?: boolean }): ReactElement {
	return <div className={cn("kb-skeleton h-[13px] rounded-sm", mb && "mb-[7px]")} style={{ width }} />;
}

function SkeletonFileRow({ width }: { width: string }): ReactElement {
	return (
		<div className="mb-0.5 flex items-center gap-2 px-2 py-1.5">
			<div className="kb-skeleton h-3 w-3 rounded-sm" />
			<div className="kb-skeleton h-[13px] rounded-sm" style={{ width }} />
		</div>
	);
}

export function WorkspaceChangesLoadingPanel({ panelFlex }: { panelFlex: string }): ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 bg-surface-0" style={{ flex: "1.6 1 0" }}>
			<div className="flex flex-1 flex-col border-r border-divider">
				<div className="px-2.5 pt-2.5 pb-1.5">
					<div className="mb-2.5 flex items-center gap-2">
						<div className="kb-skeleton h-3.5 rounded-sm" style={{ width: "62%" }} />
						<div className="kb-skeleton h-4 w-[42px] rounded-full" />
					</div>
					<SkeletonLine width="92%" mb />
					<SkeletonLine width="84%" mb />
					<SkeletonLine width="95%" mb />
					<SkeletonLine width="79%" mb />
					<SkeletonLine width="88%" mb />
					<SkeletonLine width="76%" />
				</div>
				<div className="flex-1" />
			</div>
			<div className="flex flex-col px-2 py-2.5" style={{ flex: panelFlex }}>
				<SkeletonFileRow width="61%" />
				<SkeletonFileRow width="70%" />
				<SkeletonFileRow width="53%" />
				<div className="flex-1" />
			</div>
		</div>
	);
}

export function WorkspaceChangesEmptyPanel({ title }: { title: string }): ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 bg-surface-0" style={{ flex: "1.6 1 0" }}>
			<div className="kb-empty-state-center flex-1">
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
					<GitCompareArrows size={40} />
					<h3 className="font-semibold text-text-secondary">{title}</h3>
				</div>
			</div>
		</div>
	);
}
