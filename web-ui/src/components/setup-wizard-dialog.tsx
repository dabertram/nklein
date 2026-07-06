import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NKleinMark } from "@/components/ui/nklein-mark";
import { ZOOM_LEVELS, type ZoomLevel } from "@/hooks/use-zoom-level";
import type { RuntimeSetupPlanStep } from "@/runtime/types";

/**
 * §5.BA guided-setup wizard — a controlled, presentational stepper over a resolved {@link RuntimeSetupPlanStep} list.
 *
 * This is NOT a form: it is the detect→recommend→confirm walkthrough. Each step explains a recommendation (headline +
 * detail paragraph); the deep values live in the existing settings dialog. State (which plan, auto-fire, completion) is
 * owned by {@link useSetupWizard} so this component is testable without tRPC — drive it entirely via props.
 *
 * §5.BB zoom onboarding: the GLOBAL wizard appends one interactive "How much do you want to see?" step (the zoom
 * chooser) when the caller supplies `zoomChooser` — a client-side preference, so it lives here rather than in the
 * server-resolved plan.
 */

const KIND_COPY: Record<"global" | "project", { title: string; footer: string }> = {
	global: { title: "Guided setup", footer: "You can re-run this anytime from Settings." },
	project: { title: "Project setup", footer: "Re-run from this project's settings." },
};

/** Per-level one-liners for the zoom chooser step (plain language, no jargon walls). */
const ZOOM_LEVEL_DESCRIPTIONS: Record<ZoomLevel, string> = {
	0: "Just a conversation — tell !Klein what you want, it handles the rest.",
	1: "Chat plus a live activity map — see where work is happening at a glance.",
	2: "A lean board — Doing / Review / Done, without the deep controls.",
	3: "The full board — every lane, control, and detail panel.",
	4: "Everything, including the model fleet strip — the operator cockpit.",
};

export function SetupWizardDialog({
	open,
	kind,
	steps,
	onComplete,
	onSkip,
	isSaving = false,
	completedAt = null,
	zoomChooser,
}: {
	open: boolean;
	kind: "global" | "project";
	steps: RuntimeSetupPlanStep[];
	onComplete: () => void;
	onSkip: () => void;
	isSaving?: boolean;
	/** Prior completion stamp (epoch millis); null = never completed. Surfaced as a "re-running" affordance. */
	completedAt?: number | null;
	/** §5.BB: when supplied, appends the interactive "How much do you want to see?" zoom step (global wizard). */
	zoomChooser?: { zoom: ZoomLevel; onPick: (zoom: ZoomLevel) => void };
}): ReactElement {
	const [stepIndex, setStepIndex] = useState(0);
	// The zoom chooser rides as one extra step AFTER the server-resolved plan steps.
	const stepCount = steps.length + (zoomChooser ? 1 : 0);
	const isFirstStep = stepIndex === 0;
	const isLastStep = stepCount === 0 || stepIndex >= stepCount - 1;
	const isZoomStep = zoomChooser !== undefined && stepIndex >= steps.length && stepCount > 0;
	const activeStep = isZoomStep ? null : (steps[Math.min(stepIndex, Math.max(steps.length - 1, 0))] ?? null);
	const copy = KIND_COPY[kind];

	// Reset to the first step whenever the wizard (re)opens or the plan changes underneath it.
	useEffect(() => {
		if (!open) {
			return;
		}
		setStepIndex(0);
	}, [open]);

	const handleBack = useCallback(() => {
		setStepIndex((current) => Math.max(current - 1, 0));
	}, []);

	const handleNext = useCallback(() => {
		if (isLastStep) {
			onComplete();
			return;
		}
		setStepIndex((current) => Math.min(current + 1, Math.max(stepCount - 1, 0)));
	}, [isLastStep, onComplete, stepCount]);

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) {
					onSkip();
				}
			}}
		>
			<DialogHeader title={copy.title} icon={<NKleinMark size={18} accent="var(--color-accent)" />}>
				{stepCount > 0 ? (
					<span className="ml-auto mr-1 text-[12px] font-medium text-text-tertiary tabular-nums">
						Step {Math.min(stepIndex + 1, stepCount)} of {stepCount}
					</span>
				) : null}
			</DialogHeader>
			<DialogBody className="px-5 py-5">
				{isZoomStep && zoomChooser ? (
					<div className="flex flex-col gap-3" data-testid="setup-wizard-zoom-step">
						<h3 className="m-0 text-lg font-semibold text-text-primary">How much do you want to see?</h3>
						<p className="m-0 text-[13px] leading-relaxed text-text-secondary">
							Pick a starting view — you can change it anytime with the zoom buttons above the main panel. It
							only changes what's shown, never what !Klein can do.
						</p>
						<div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Starting view">
							{ZOOM_LEVELS.map((entry) => (
								<button
									key={entry.level}
									type="button"
									role="radio"
									aria-checked={zoomChooser.zoom === entry.level}
									data-testid={`setup-wizard-zoom-${entry.level}`}
									onClick={() => zoomChooser.onPick(entry.level)}
									className={
										zoomChooser.zoom === entry.level
											? "flex items-start gap-2.5 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-left"
											: "flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left hover:border-border-bright"
									}
								>
									<span className="mt-0.5 shrink-0 rounded border border-current px-1 text-[9px] text-text-tertiary">
										{entry.short}
									</span>
									<span className="min-w-0">
										<span className="block text-[13px] font-medium text-text-primary">{entry.label}</span>
										<span className="block text-[12px] text-text-secondary">
											{ZOOM_LEVEL_DESCRIPTIONS[entry.level]}
										</span>
									</span>
								</button>
							))}
						</div>
					</div>
				) : activeStep ? (
					<div className="flex flex-col gap-3">
						{completedAt !== null ? (
							<p className="text-[12px] text-text-tertiary m-0">
								You've completed this before — re-run to review the current recommendations.
							</p>
						) : null}
						<h3 className="m-0 text-lg font-semibold text-text-primary">{activeStep.title}</h3>
						<p className="m-0 text-[15px] font-medium text-accent">{activeStep.recommendation}</p>
						<p className="m-0 whitespace-pre-line text-[13px] leading-relaxed text-text-secondary">
							{activeStep.detail}
						</p>
					</div>
				) : (
					<p className="m-0 text-[13px] text-text-secondary">No setup steps to review right now.</p>
				)}
				{stepCount > 0 ? (
					// Progress dots — one per step (incl. the zoom step), the active one filled cyan.
					<div className="mt-4 flex items-center gap-1.5" aria-hidden>
						{Array.from({ length: stepCount }, (_, index) => (
							<span
								key={index}
								className={
									index === stepIndex
										? "h-1.5 w-5 rounded-full bg-accent"
										: "h-1.5 w-1.5 rounded-full bg-surface-4"
								}
							/>
						))}
					</div>
				) : null}
				<p className="mt-5 mb-0 border-t border-border pt-3 text-[12px] text-text-tertiary">{copy.footer}</p>
			</DialogBody>
			<DialogFooter>
				<Button size="sm" variant="ghost" onClick={onSkip} disabled={isSaving} className="mr-auto">
					Skip setup
				</Button>
				<Button size="sm" onClick={handleBack} disabled={isFirstStep || isSaving} icon={<ChevronLeft size={14} />}>
					Back
				</Button>
				<Button
					size="sm"
					variant="primary"
					onClick={handleNext}
					disabled={isSaving}
					icon={isLastStep ? <Check size={14} /> : undefined}
					iconRight={isLastStep ? undefined : <ChevronRight size={14} />}
				>
					{isLastStep ? "Finish" : "Next"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
