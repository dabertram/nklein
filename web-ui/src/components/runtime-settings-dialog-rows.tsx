// The settings-dialog row/button building blocks (extracted from runtime-settings-dialog.tsx, §5.U — the dialog is
// the codebase's largest file). Self-contained presentational helpers + the agent-row view model shared with the dialog:
//   - AgentRow: a selectable agent entry (install status, native-NKlein vs external CLI).
//   - InlineUtilityButton: a compact inline action button.
//   - OverrideRow: a labelled per-project override toggle (override / revert-to-global) wrapping arbitrary children.

import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { Circle, CircleDot } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RuntimeAgentId } from "@/runtime/types";

export interface RuntimeSettingsAgentRowModel {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	command: string;
	installed: boolean | null;
}

export function AgentRow({
	agent,
	isSelected,
	onSelect,
	disabled,
}: {
	agent: RuntimeSettingsAgentRowModel;
	isSelected: boolean;
	onSelect: () => void;
	disabled: boolean;
}): React.ReactElement {
	const installUrl = getRuntimeAgentCatalogEntry(agent.id)?.installUrl;
	const isNativeNKlein = agent.id === "nklein";
	const isInstalled = agent.installed === true;
	const isInstallStatusPending = !isNativeNKlein && agent.installed === null;

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => {
				if (isInstalled && !disabled) {
					onSelect();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && isInstalled && !disabled) {
					onSelect();
				}
			}}
			className="flex items-center justify-between gap-3 py-1.5"
			style={{ cursor: isInstalled ? "pointer" : "default" }}
		>
			<div className="flex items-start gap-2 min-w-0">
				{isSelected ? (
					<CircleDot size={16} className="text-accent mt-0.5 shrink-0" />
				) : (
					<Circle
						size={16}
						className={cn("mt-0.5 shrink-0", !isInstalled ? "text-text-tertiary" : "text-text-secondary")}
					/>
				)}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-[13px] text-text-primary">{agent.label}</span>
						{!isNativeNKlein && isInstalled ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-status-green/10 text-status-green">
								Installed
							</span>
						) : isInstallStatusPending ? (
							<span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-surface-3 text-text-secondary">
								Checking...
							</span>
						) : null}
					</div>
					{agent.command ? (
						<p className="text-text-secondary font-mono text-xs mt-0.5 m-0">{agent.command}</p>
					) : null}
				</div>
			</div>
			{!isNativeNKlein && agent.installed === false && installUrl ? (
				<a
					href={installUrl}
					target="_blank"
					rel="noreferrer"
					onClick={(event: React.MouseEvent) => event.stopPropagation()}
					className="inline-flex items-center justify-center rounded-md font-medium duration-150 cursor-default select-none h-7 px-2 text-xs bg-surface-2 border border-border text-text-primary hover:bg-surface-3 hover:border-border-bright"
				>
					Install
				</a>
			) : !isNativeNKlein && agent.installed === false ? (
				<Button size="sm" disabled>
					Install
				</Button>
			) : null}
		</div>
	);
}

export function InlineUtilityButton({
	text,
	onClick,
	disabled,
	monospace,
	widthCh,
}: {
	text: string;
	onClick: () => void;
	disabled?: boolean;
	monospace?: boolean;
	widthCh?: number;
}): React.ReactElement {
	return (
		<Button
			size="sm"
			disabled={disabled}
			onClick={onClick}
			className={cn(monospace && "font-mono")}
			style={{
				fontSize: 10,
				verticalAlign: "middle",
				...(typeof widthCh === "number"
					? {
							width: `${widthCh}ch`,
							justifyContent: "center",
						}
					: {}),
			}}
		>
			{text}
		</Button>
	);
}

export function OverrideRow({
	label,
	inheritLabel,
	isOverridden,
	onOverride,
	onRevert,
	disabled,
	children,
}: {
	label: string;
	inheritLabel: string;
	isOverridden: boolean;
	onOverride: () => void;
	onRevert: () => void;
	disabled: boolean;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div className="grid gap-1">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[13px] text-text-primary">{label}</span>
				{isOverridden ? (
					<Button size="sm" variant="ghost" onClick={onRevert} disabled={disabled}>
						Revert to global
					</Button>
				) : (
					<Button size="sm" variant="default" onClick={onOverride} disabled={disabled}>
						Override for this project
					</Button>
				)}
			</div>
			{isOverridden ? (
				children
			) : (
				<p className="text-[12px] text-text-secondary m-0">Inherits global: {inheritLabel}</p>
			)}
		</div>
	);
}
