import { AlertTriangle, X } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";

export function WorkspaceConflictNotice({
	onDismiss,
	onRefresh,
	onRestoreLocalEdit,
}: {
	onDismiss: () => void;
	onRefresh: () => void;
	onRestoreLocalEdit?: () => void;
}): ReactElement {
	return (
		<div className="border-b border-border bg-status-orange/10 px-4 py-3">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 shrink-0 text-status-orange">
					<AlertTriangle size={16} />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-[13px] font-medium text-text-primary">Board changed elsewhere</p>
					<p className="mt-1 text-[13px] text-text-secondary">
						The latest board state was synced, but your last edit could not be safely replayed automatically. Your
						local edit was preserved, so you can review the refreshed board and restore your version if you still
						want it.
					</p>
					<div className="mt-3 flex items-center gap-2">
						{/* Refresh is the SAFE default: most conflicts are the runtime's own progress racing a viewer,
						    and "restoring" would silently roll agent-made moves back (live-found 2026-07-10). */}
						<Button size="sm" variant="primary" onClick={onRefresh}>
							Refresh board
						</Button>
						{onRestoreLocalEdit ? (
							<Button size="sm" variant="default" onClick={onRestoreLocalEdit}>
								Restore my edit
							</Button>
						) : null}
						<Button size="sm" variant="ghost" onClick={onDismiss}>
							Dismiss
						</Button>
					</div>
				</div>
				<button
					type="button"
					aria-label="Dismiss workspace conflict notice"
					className="shrink-0 rounded-md p-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
					onClick={onDismiss}
				>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
