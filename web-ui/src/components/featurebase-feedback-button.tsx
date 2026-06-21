import { Button } from "@/components/ui/button";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import { isNativeNKleinAgentSelected, isNKleinOauthAuthenticated } from "@/runtime/native-agent";
import type { RuntimeAgentId, RuntimeNKleinProviderSettings } from "@/runtime/types";

interface FeaturebaseFeedbackVisibilityInput {
	cloudProviderSupportEnabled?: boolean;
	selectedAgentId?: RuntimeAgentId | null;
	nkleinProviderSettings?: RuntimeNKleinProviderSettings | null;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
}

export function canShowFeaturebaseFeedbackButton({
	cloudProviderSupportEnabled = false,
	selectedAgentId,
	nkleinProviderSettings,
	featurebaseFeedbackState,
}: FeaturebaseFeedbackVisibilityInput): boolean {
	if (!cloudProviderSupportEnabled) {
		return false;
	}
	const isNKleinAgent = isNativeNKleinAgentSelected(selectedAgentId);
	const isAuthenticated = isNKleinOauthAuthenticated(nkleinProviderSettings);
	return isNKleinAgent && isAuthenticated && featurebaseFeedbackState !== undefined;
}

interface FeaturebaseFeedbackButtonProps extends FeaturebaseFeedbackVisibilityInput {
	size?: "sm" | "md";
	variant?: "default" | "primary" | "danger" | "ghost";
	className?: string;
	onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export function FeaturebaseFeedbackButton({
	cloudProviderSupportEnabled,
	selectedAgentId,
	nkleinProviderSettings,
	featurebaseFeedbackState,
	size = "sm",
	variant = "default",
	className,
	onClick,
}: FeaturebaseFeedbackButtonProps): React.ReactElement | null {
	if (
		!canShowFeaturebaseFeedbackButton({
			cloudProviderSupportEnabled,
			selectedAgentId,
			nkleinProviderSettings,
			featurebaseFeedbackState,
		})
	) {
		return null;
	}

	const isOpening = featurebaseFeedbackState?.authState === "loading";

	return (
		<Button size={size} variant={variant} className={className} onClick={onClick} disabled={isOpening}>
			{isOpening ? "Opening..." : "Send feedback"}
		</Button>
	);
}
