import { ChevronLeft, ChevronRight, Circle, CircleDot, X } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import {
	TASK_START_ONBOARDING_SLIDES,
	TaskStartAgentOnboardingCarousel,
} from "@/components/task-start-agent-onboarding-carousel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeNKleinProviderSettings,
} from "@/runtime/types";

export function StartupOnboardingDialog({
	open,
	onClose,
	selectedAgentId,
	agents,
	nkleinProviderSettings,
	onSelectAgent,
	workspaceId,
	runtimeConfig,
	onNKleinSetupSaved,
}: {
	open: boolean;
	onClose: () => void;
	selectedAgentId?: RuntimeAgentId | null;
	agents?: RuntimeAgentDefinition[];
	nkleinProviderSettings?: RuntimeNKleinProviderSettings | null;
	onSelectAgent?: (agentId: RuntimeAgentId) => Promise<{ ok: boolean; message?: string }>;
	workspaceId?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onNKleinSetupSaved?: () => void;
}): ReactElement {
	const [onboardingSlideIndex, setOnboardingSlideIndex] = useState(0);
	const [isCompletingOnboarding, setIsCompletingOnboarding] = useState(false);
	const [onboardingDoneAction, setOnboardingDoneAction] = useState<
		(() => Promise<{ ok: boolean; message?: string }>) | null
	>(null);
	const onboardingSlideCount = TASK_START_ONBOARDING_SLIDES.length;
	const isFirstOnboardingSlide = onboardingSlideIndex === 0;
	const isLastOnboardingSlide = onboardingSlideIndex === onboardingSlideCount - 1;

	useEffect(() => {
		if (!open) {
			return;
		}
		setOnboardingSlideIndex(0);
		setIsCompletingOnboarding(false);
		setOnboardingDoneAction(null);
	}, [open]);

	// F2.32 (live-caught by the flow spec): Radix's Escape handling sits on the dialog CONTENT, and when focus
	// never entered the trap the keydown went to <body> — the welcome dialog was undismissable by keyboard.
	// A window-level listener closes through the SAME persisting handler, so a keyboard dismissal is remembered
	// exactly like a completed tour (never re-annoy on the next visit).
	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	const handleOnboardingDoneActionChange = useCallback(
		(action: (() => Promise<{ ok: boolean; message?: string }>) | null) => {
			setOnboardingDoneAction(() => action);
		},
		[],
	);

	const handleAdvanceOnboarding = useCallback(() => {
		if (!isLastOnboardingSlide) {
			setOnboardingSlideIndex((current) => Math.min(current + 1, onboardingSlideCount - 1));
			return;
		}
		void (async () => {
			setIsCompletingOnboarding(true);
			try {
				const result = onboardingDoneAction ? await onboardingDoneAction() : { ok: true };
				if (result.ok) {
					onClose();
				}
			} finally {
				setIsCompletingOnboarding(false);
			}
		})();
	}, [isLastOnboardingSlide, onboardingDoneAction, onClose, onboardingSlideCount]);

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose();
			}}
		>
			<DialogHeader title="Get started">
				<button
					type="button"
					aria-label="Skip the tour"
					data-testid="onboarding-skip"
					onClick={onClose}
					className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-3 hover:text-text-primary"
				>
					<X size={16} />
				</button>
			</DialogHeader>
			<DialogBody className="px-4 pt-2 pb-4">
				<TaskStartAgentOnboardingCarousel
					open={open}
					workspaceId={workspaceId ?? null}
					runtimeConfig={runtimeConfig ?? null}
					selectedAgentId={selectedAgentId ?? null}
					agents={agents ?? []}
					nkleinProviderSettings={nkleinProviderSettings ?? null}
					activeSlideIndex={onboardingSlideIndex}
					onSelectAgent={onSelectAgent}
					onNKleinSetupSaved={onNKleinSetupSaved}
					onDoneActionChange={handleOnboardingDoneActionChange}
				/>
			</DialogBody>
			<DialogFooter>
				<Button
					size="sm"
					onClick={() => setOnboardingSlideIndex((current) => Math.max(current - 1, 0))}
					disabled={isFirstOnboardingSlide || isCompletingOnboarding}
				>
					<ChevronLeft size={14} />
					Back
				</Button>
				<div className="mx-auto flex items-center gap-1">
					{TASK_START_ONBOARDING_SLIDES.map((_, index) =>
						index === onboardingSlideIndex ? (
							<CircleDot key={index} size={14} className="text-accent-text" />
						) : (
							<button
								key={index}
								type="button"
								onClick={() => setOnboardingSlideIndex(index)}
								className="text-text-tertiary hover:text-text-secondary"
								aria-label={`Go to onboarding slide ${index + 1}`}
							>
								<Circle size={14} />
							</button>
						),
					)}
				</div>
				<Button size="sm" variant="primary" onClick={handleAdvanceOnboarding} disabled={isCompletingOnboarding}>
					{isLastOnboardingSlide ? "Done" : "Next"}
					{isLastOnboardingSlide ? null : <ChevronRight size={14} />}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
