import { toast } from "sonner";

/**
 * F12.52 layered-notification POLICY (anti cry-wolf) — this module is the single toast choke point; every call
 * site must fit one of these tiers, in this order of interruption budget:
 *
 *  1. Errors/warnings from the USER'S OWN action (a save failed, an import broke) — always toast; the user is
 *     mid-action and waiting on the outcome.
 *  2. Cards that NEED A DECISION (approvals, escalations, conflicts) — the "Needs you" queue chip/popover is the
 *     canonical surface (a pull, always visible); toast ONLY when something genuinely cannot wait.
 *  3. Agent PROGRESS and COMPLETIONS — NEVER toast. They stay ambient: cards move lanes, live-agent chips update,
 *     the Merged counter ticks. Milestone pings (25/50/75%) train users to ignore alerts — do not add them.
 *
 * Audited 2026-07-18: every existing call site is tier 1 (user-action feedback/errors); the codebase carries no
 * lifecycle interrupt toasts. Keep it that way — add a tier-3 toast and the tier-1/2 ones stop being heard.
 */

interface AppToastProps {
	intent?: "danger" | "warning" | "success" | "primary" | "none";
	icon?: string;
	message: string;
	timeout?: number;
}

interface NotifyErrorOptions {
	key?: string;
	timeout?: number;
}

export function showAppToast(props: AppToastProps, key?: string): void {
	const options: Parameters<typeof toast>[1] = {
		id: key,
		duration: props.timeout ?? 5000,
	};

	if (props.intent === "danger") {
		toast.error(props.message, options);
	} else if (props.intent === "warning") {
		toast.warning(props.message, options);
	} else if (props.intent === "success") {
		toast.success(props.message, options);
	} else {
		toast(props.message, options);
	}
}

export function notifyError(message: string | null | undefined, options?: NotifyErrorOptions): void {
	const normalized = message?.trim();
	if (!normalized) {
		return;
	}
	showAppToast(
		{
			intent: "danger",
			icon: "warning-sign",
			message: normalized,
			timeout: options?.timeout ?? 7000,
		},
		options?.key ?? `error:${normalized}`,
	);
}

export function notifyWarning(message: string | null | undefined, options?: NotifyErrorOptions): void {
	const normalized = message?.trim();
	if (!normalized) {
		return;
	}
	showAppToast(
		{
			intent: "warning",
			icon: "warning-sign",
			message: normalized,
			timeout: options?.timeout ?? 6000,
		},
		options?.key ?? `warning:${normalized}`,
	);
}
