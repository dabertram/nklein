import { ExternalLink, Info } from "lucide-react";
import type React from "react";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";

/**
 * The beta support / feedback footer for the project navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). Shows a "send feedback" action when the Featurebase widget is available,
 * otherwise links out to the GitHub issues page. Self-contained.
 */

const GITHUB_ISSUES_URL = "https://github.com/dabertram/nklein/issues";

export function ProjectSupportFooter({
	shouldShowFeaturebaseFeedback,
	featurebaseFeedbackState,
}: {
	shouldShowFeaturebaseFeedback: boolean;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
}): React.ReactElement {
	const isOpening = featurebaseFeedbackState?.authState === "loading";

	const handleAction = () => {
		if (shouldShowFeaturebaseFeedback) {
			void featurebaseFeedbackState?.openFeedbackWidget();
		} else {
			window.open(GITHUB_ISSUES_URL, "_blank");
		}
	};

	const actionLabel = shouldShowFeaturebaseFeedback ? (isOpening ? "Opening..." : "Send feedback") : "Report issue";

	return (
		<div style={{ padding: "4px 12px 12px" }}>
			<div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
				<Info size={14} className="mt-px shrink-0 text-text-tertiary" />
				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-xs text-text-secondary">
						!Klein is in beta. Help us improve by sharing your experience.
					</p>
					<button
						type="button"
						className="m-0 flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-xs font-semibold text-text-secondary hover:text-text-primary active:text-text-tertiary disabled:cursor-default disabled:opacity-50"
						disabled={shouldShowFeaturebaseFeedback && isOpening}
						onClick={handleAction}
					>
						{actionLabel} {!isOpening && <ExternalLink size={11} />}
					</button>
				</div>
			</div>
		</div>
	);
}
