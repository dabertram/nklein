// The settings-dialog left-hand section nav (extracted from runtime-settings-dialog.tsx, §5.U — the dialog is
// the codebase's largest file). Self-contained presentational component: render the section buttons, highlight
// the active one, and report selection.
import type React from "react";
import { cn } from "@/components/ui/cn";

export type SettingsNavId =
	| "general"
	| "agents"
	| "tasks"
	| "nklein"
	| "code-intelligence"
	| "git-prompts"
	| "notifications"
	| "appearance"
	| "project";

export function SettingsNav({
	items,
	activeId,
	onSelect,
}: {
	items: ReadonlyArray<{ id: SettingsNavId; label: string; icon: React.ReactNode }>;
	activeId: SettingsNavId;
	onSelect: (id: SettingsNavId) => void;
}): React.ReactElement {
	return (
		<nav className="hidden md:flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-3 overflow-y-auto">
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={() => onSelect(item.id)}
					className={cn(
						"flex items-center gap-2.5 text-left px-3 py-2 rounded-md text-[13px] font-medium cursor-pointer",
						activeId === item.id
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:text-text-primary hover:bg-surface-2",
					)}
				>
					<span className="shrink-0 opacity-80">{item.icon}</span>
					<span>{item.label}</span>
				</button>
			))}
		</nav>
	);
}
