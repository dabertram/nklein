import { Bug, FolderPlus, GitBranch, ListStart, Plus, Settings } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogHeader } from "@/components/ui/dialog";

interface CommandPaletteAction {
	id: string;
	label: string;
	icon: ReactNode;
	disabled?: boolean;
	onRun: () => void;
}

export function CommandPalette({
	open,
	onOpenChange,
	hasProject,
	showDebugCommands,
	onCreateTask,
	onAddProject,
	onOpenSettings,
	onOpenDebugTools,
	onToggleGitHistory,
	onStartAllTasks,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	hasProject: boolean;
	showDebugCommands: boolean;
	onCreateTask: () => void;
	onAddProject: () => void;
	onOpenSettings: () => void;
	onOpenDebugTools?: () => void;
	onToggleGitHistory: () => void;
	onStartAllTasks: () => void;
}): ReactElement {
	const runCommand = (action: CommandPaletteAction): void => {
		if (action.disabled) {
			return;
		}
		onOpenChange(false);
		action.onRun();
	};
	const actions: CommandPaletteAction[] = [
		{
			id: "new-task",
			label: "New task",
			icon: <Plus size={14} />,
			disabled: !hasProject,
			onRun: onCreateTask,
		},
		{
			id: "add-project",
			label: "Add project",
			icon: <FolderPlus size={14} />,
			onRun: onAddProject,
		},
		{
			id: "settings",
			label: "Settings",
			icon: <Settings size={14} />,
			onRun: onOpenSettings,
		},
		{
			id: "git-history",
			label: "Toggle git history",
			icon: <GitBranch size={14} />,
			disabled: !hasProject,
			onRun: onToggleGitHistory,
		},
		{
			id: "start-backlog",
			label: "Start all backlog tasks",
			icon: <ListStart size={14} />,
			disabled: !hasProject,
			onRun: onStartAllTasks,
		},
	];
	if (showDebugCommands && onOpenDebugTools) {
		actions.push({
			id: "developer-tools",
			label: "Developer Tools",
			icon: <Bug size={14} />,
			onRun: onOpenDebugTools,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange} contentClassName="max-w-md">
			<DialogHeader title="Command Palette" />
			<DialogBody className="p-2">
				<div className="grid gap-1">
					{actions.map((action) => (
						<Button
							key={action.id}
							variant="ghost"
							size="md"
							icon={action.icon}
							disabled={action.disabled}
							onClick={() => runCommand(action)}
							fill
							className="justify-start"
						>
							{action.label}
						</Button>
					))}
				</div>
			</DialogBody>
		</Dialog>
	);
}
