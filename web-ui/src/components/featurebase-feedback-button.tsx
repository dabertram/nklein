import { Button } from "@/components/ui/button";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import { isClineOauthAuthenticated, isNativeClineAgentSelected } from "@/runtime/native-agent";
import type { RuntimeAgentId, RuntimeClineProviderSettings } from "@/runtime/types";

interface FeaturebaseFeedbackVisibilityInput {
	cloudProviderSupportEnabled?: boolean;
	selectedAgentId?: RuntimeAgentId | null;
	clineProviderSettings?: RuntimeClineProviderSettings | null;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
}

export function canShowFeaturebaseFeedbackButton({
	cloudProviderSupportEnabled = false,
	selectedAgentId,
	clineProviderSettings,
	featurebaseFeedbackState,
}: FeaturebaseFeedbackVisibilityInput): boolean {
	if (!cloudProviderSupportEnabled) {
		return false;
	}
	const isClineAgent = isNativeClineAgentSelected(selectedAgentId);
	const isAuthenticated = isClineOauthAuthenticated(clineProviderSettings);
	return isClineAgent && isAuthenticated && featurebaseFeedbackState !== undefined;
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
	clineProviderSettings,
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
			clineProviderSettings,
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
