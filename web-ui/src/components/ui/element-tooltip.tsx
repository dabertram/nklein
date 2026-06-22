import type { ReactNode } from "react";
import { ELEMENT_TOOLTIPS, type ElementTooltipId } from "./element-tooltips";
import { Tooltip, TooltipProvider } from "./tooltip";

/**
 * Wraps a control with a hover/focus tooltip showing its name + a short description, looked up from the
 * {@link ELEMENT_TOOLTIPS} registry by a stable id. Use this for discoverability on every meaningful control
 * (icon-only buttons first). The id is typed, so a missing registry entry is a compile error.
 *
 * It carries its own {@link TooltipProvider} so it is drop-in anywhere — including components rendered in
 * isolation in tests — without each call site needing a provider ancestor. Radix permits nested providers, so
 * this composes fine under the app-root provider; the only effect is that ElementTooltips don't share the
 * cross-tooltip "skip delay" warm-up group, which is irrelevant for discovery tooltips.
 */
export function ElementTooltip({
	id,
	side,
	children,
}: {
	id: ElementTooltipId;
	side?: "top" | "right" | "bottom" | "left";
	children: ReactNode;
}): React.ReactElement {
	const copy = ELEMENT_TOOLTIPS[id];
	return (
		<TooltipProvider>
			<Tooltip
				side={side}
				content={
					<div className="flex max-w-[260px] flex-col gap-0.5">
						<span className="font-medium text-text-primary">{copy.name}</span>
						<span className="text-text-secondary">{copy.description}</span>
					</div>
				}
			>
				{children}
			</Tooltip>
		</TooltipProvider>
	);
}
