// The settings-dialog left-hand section nav (extracted from runtime-settings-dialog.tsx, §5.U — the dialog is
// the codebase's largest file). Self-contained presentational component: render the section buttons, highlight
// the active one, and report selection.
import type React from "react";
import { cn } from "@/components/ui/cn";
import { ElementTooltip } from "@/components/ui/element-tooltip";

export type SettingsNavId =
	| "general"
	| "agents"
	| "tasks"
	| "guardrails"
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
	items: ReadonlyArray<{
		id: SettingsNavId;
		label: string;
		icon: React.ReactNode;
		/** §10c#9: optional count pill (e.g. active per-project overrides on the Project entry); title lists them. */
		badge?: { count: number; title: string };
		/** F1.29b: unsaved-edits indicator for this tab's slice (a dot before the count pill). */
		dirty?: boolean;
	}>;
	activeId: SettingsNavId;
	onSelect: (id: SettingsNavId) => void;
}): React.ReactElement {
	return (
		<nav className="hidden md:flex w-[180px] shrink-0 flex-col gap-0.5 border-r border-border bg-surface-1 p-3 overflow-y-auto">
			{items.map((item) => (
				// §5.L tooltip registry: every section is discoverable on hover — what lives inside it,
				// before clicking through. Ids are `settings-nav.<SettingsNavId>`, all present in the registry.
				<ElementTooltip key={item.id} id={`settings-nav.${item.id}`} side="right">
					<button
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
						{item.dirty ? (
							<span
								data-testid={`settings-nav-dirty-${item.id}`}
								role="img"
								title="Unsaved changes in this section"
								// Accessible name deliberately avoids the substring "save" — non-exact getByRole("button",
								// {name:"Save"}) queries would otherwise match this dirty tab's button ("unsaved" contains "save").
								aria-label="Section edited"
								className={cn("ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-accent", item.badge ? "mr-1" : "")}
							/>
						) : null}
						{item.badge && item.badge.count > 0 ? (
							<span
								data-testid={`settings-nav-badge-${item.id}`}
								title={item.badge.title}
								className="ml-auto shrink-0 rounded-full bg-accent/20 text-accent text-[10px] font-semibold px-1.5 py-0.5 leading-none"
							>
								{item.badge.count}
							</span>
						) : null}
					</button>
				</ElementTooltip>
			))}
		</nav>
	);
}
