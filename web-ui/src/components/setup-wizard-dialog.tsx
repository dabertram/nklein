import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NKleinMark } from "@/components/ui/nklein-mark";
import type { RuntimeSetupPlanStep } from "@/runtime/types";

/**
 * §5.BA guided-setup wizard — a controlled, presentational stepper over a resolved {@link RuntimeSetupPlanStep} list.
 *
 * This is NOT a form: it is the detect→recommend→confirm walkthrough. Each step explains a recommendation (headline +
 * detail paragraph); the deep values live in the existing settings dialog. State (which plan, auto-fire, completion) is
 * owned by {@link useSetupWizard} so this component is testable without tRPC — drive it entirely via props.
 */

const KIND_COPY: Record<"global" | "project", { title: string; footer: string }> = {
	global: { title: "Guided setup", footer: "You can re-run this anytime from Settings." },
	project: { title: "Project setup", footer: "Re-run from this project's settings." },
};

export function SetupWizardDialog({
	open,
	kind,
	steps,
	onComplete,
	onSkip,
	isSaving = false,
	completedAt = null,
}: {
	open: boolean;
	kind: "global" | "project";
	steps: RuntimeSetupPlanStep[];
	onComplete: () => void;
	onSkip: () => void;
	isSaving?: boolean;
	/** Prior completion stamp (epoch millis); null = never completed. Surfaced as a "re-running" affordance. */
	completedAt?: number | null;
}): ReactElement {
	const [stepIndex, setStepIndex] = useState(0);
	const stepCount = steps.length;
	const isFirstStep = stepIndex === 0;
	const isLastStep = stepCount === 0 || stepIndex >= stepCount - 1;
	const activeStep = steps[Math.min(stepIndex, Math.max(stepCount - 1, 0))] ?? null;
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
				{activeStep ? (
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
						{/* Progress dots — one per step, the active one filled cyan. */}
						<div className="mt-2 flex items-center gap-1.5" aria-hidden>
							{steps.map((step, index) => (
								<span
									key={step.stepId}
									className={
										index === stepIndex
											? "h-1.5 w-5 rounded-full bg-accent"
											: "h-1.5 w-1.5 rounded-full bg-surface-4"
									}
								/>
							))}
						</div>
					</div>
				) : (
					<p className="m-0 text-[13px] text-text-secondary">No setup steps to review right now.</p>
				)}
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
