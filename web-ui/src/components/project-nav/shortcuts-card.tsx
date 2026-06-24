import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform, modifierKeyLabel } from "@/utils/platform";

/**
 * The keyboard-shortcuts cheatsheet card for the project navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). Shows the essential shortcuts always, with a collapsible "All shortcuts"
 * section for the rest. Platform-aware modifier glyphs (⌘ / Ctrl, ⌥ / Alt). Purely presentational.
 */

const MOD = isMacPlatform ? "⌘" : modifierKeyLabel;
const ALT = isMacPlatform ? "⌥" : "Alt";

const ESSENTIAL_SHORTCUTS = [
	{ keys: ["C"], label: "New task" },
	{ keys: [MOD, "B"], label: "Start backlog tasks" },
	{ keys: [MOD, "Shift", "S"], label: "Settings" },
	{ keys: ["Click", MOD], label: "Hold to link tasks" },
	{ keys: [MOD, "G"], label: "Toggle git view" },
	{ keys: [MOD, "J"], label: "Toggle terminal" },
];

const MORE_SHORTCUTS = [
	{ keys: [MOD, "Shift", "A"], label: "Toggle plan / act" },
	{ keys: [ALT, "Shift", "Enter"], label: "Start and open task" },
	{ keys: [MOD, "M"], label: "Expand terminal" },
	{ keys: ["Esc"], label: "Close / back" },
];

function ShortcutHint({ keys, label }: { keys: string[]; label: string }): React.ReactElement {
	return (
		<div className="flex justify-between items-center py-px">
			<span className="text-text-tertiary text-xs">{label}</span>
			<span className="inline-flex items-center gap-0.5">
				{keys.map((key, i) => (
					<Kbd key={`${key}-${i}`}>{key}</Kbd>
				))}
			</span>
		</div>
	);
}

export function ShortcutsCard(): React.ReactElement {
	const [expanded, setExpanded] = useState(false);

	return (
		<div style={{ padding: "8px 12px" }}>
			<div style={{ padding: "0 8px" }}>
				<div className="flex flex-col gap-0.5">
					{ESSENTIAL_SHORTCUTS.map((s) => (
						<ShortcutHint key={s.label} keys={s.keys} label={s.label} />
					))}
				</div>
				<Collapsible.Root open={expanded} onOpenChange={setExpanded}>
					<Collapsible.Content>
						<div className="flex flex-col gap-0.5">
							{MORE_SHORTCUTS.map((s) => (
								<ShortcutHint key={s.label} keys={s.keys} label={s.label} />
							))}
						</div>
					</Collapsible.Content>
					<Collapsible.Trigger asChild>
						<button
							type="button"
							className="flex items-center gap-1 mt-1.5 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none p-0"
						>
							{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
							{expanded ? "Less" : "All shortcuts"}
						</button>
					</Collapsible.Trigger>
				</Collapsible.Root>
			</div>
		</div>
	);
}
