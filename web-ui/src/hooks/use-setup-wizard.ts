import { useCallback, useEffect, useRef, useState } from "react";

import { fetchGlobalSetupPlan, fetchProjectSetupPlan, saveRuntimeConfig } from "@/runtime/runtime-config-query";
import type { RuntimeSetupPlanResponse, RuntimeSetupPlanStep } from "@/runtime/types";

export type SetupWizardKind = "global" | "project";

interface UseSetupWizardOptions {
	kind: SetupWizardKind;
	/**
	 * Workspace scope for the tRPC client. The global plan tolerates a null workspace (it uses the default client); the
	 * project plan is workspace-scoped, so it stays inert until a project is active (see {@link enabled}).
	 */
	workspaceId: string | null;
	/**
	 * Gate for whether this wizard may fetch/auto-fire at all. The project wizard MUST pass `false` until a project is
	 * actually active so it never auto-fires with no project selected.
	 */
	enabled: boolean;
	/**
	 * Suppress auto-fire (but still allow forceOpen). App.tsx uses this to enforce global-before-project precedence:
	 * the project wizard is held back while the global wizard would fire.
	 */
	autoFireSuppressed?: boolean;
	/** Called after a stamp is written so callers can refresh dependent runtime config. */
	onCompleted?: () => void;
}

export interface UseSetupWizardResult {
	isOpen: boolean;
	kind: SetupWizardKind;
	steps: RuntimeSetupPlanStep[];
	isSaving: boolean;
	completedAt: number | null;
	/** True while auto-fire criteria are met (plan loaded, never completed, not dismissed) — App reads this for precedence. */
	wouldAutoFire: boolean;
	open: () => void;
	complete: () => Promise<void>;
	skip: () => void;
}

function stampFieldForKind(kind: SetupWizardKind): "setupWizardCompletedAt" | "projectSetupWizardCompletedAt" {
	return kind === "global" ? "setupWizardCompletedAt" : "projectSetupWizardCompletedAt";
}

/**
 * §5.BA guided-setup wizard controller. One instance per {@link SetupWizardKind}. It fetches the resolved plan (global on
 * mount, project on active-project change), decides the AUTO-FIRE (open when the plan has never been completed and the
 * user hasn't dismissed it this session), and owns the complete/skip handlers. `complete` writes the config STAMP via the
 * existing saveRuntimeConfig; `skip` just closes for the session. `open` force-opens for the settings re-trigger buttons.
 */
export function useSetupWizard(options: UseSetupWizardOptions): UseSetupWizardResult {
	const { kind, workspaceId, enabled, autoFireSuppressed = false, onCompleted } = options;

	const [plan, setPlan] = useState<RuntimeSetupPlanResponse | null>(null);
	const [isForcedOpen, setIsForcedOpen] = useState(false);
	const [didDismissForSession, setDidDismissForSession] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	// Keep the latest onCompleted without retriggering the fetch effect.
	const onCompletedRef = useRef(onCompleted);
	onCompletedRef.current = onCompleted;

	// Fetch the plan. Global fetches once a client exists; project refetches on workspace change. Guard against races so a
	// slow response for a stale workspace can't clobber a newer one.
	useEffect(() => {
		if (!enabled) {
			setPlan(null);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const next =
					kind === "global" ? await fetchGlobalSetupPlan(workspaceId) : await fetchProjectSetupPlan(workspaceId);
				if (!cancelled) {
					setPlan(next);
				}
			} catch {
				if (!cancelled) {
					setPlan(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [enabled, kind, workspaceId]);

	// A change of workspace resets the per-session dismissal so a freshly opened project can auto-fire its own wizard.
	useEffect(() => {
		setDidDismissForSession(false);
		setIsForcedOpen(false);
	}, [workspaceId]);

	const completedAt = plan?.completedAt ?? null;
	const steps = plan?.steps ?? [];

	const wouldAutoFire = enabled && plan !== null && completedAt === null && !didDismissForSession;
	const isOpen = isForcedOpen || (wouldAutoFire && !autoFireSuppressed);

	const open = useCallback(() => {
		setDidDismissForSession(false);
		setIsForcedOpen(true);
	}, []);

	const skip = useCallback(() => {
		setIsForcedOpen(false);
		setDidDismissForSession(true);
	}, []);

	const complete = useCallback(async () => {
		setIsSaving(true);
		try {
			await saveRuntimeConfig(workspaceId, { [stampFieldForKind(kind)]: Date.now() });
			// Reflect completion locally so the wizard won't immediately re-fire before the next fetch.
			setPlan((current) => (current ? { ...current, completedAt: Date.now() } : current));
			setIsForcedOpen(false);
			setDidDismissForSession(true);
			onCompletedRef.current?.();
		} finally {
			setIsSaving(false);
		}
	}, [kind, workspaceId]);

	return {
		isOpen,
		kind,
		steps,
		isSaving,
		completedAt,
		wouldAutoFire,
		open,
		complete,
		skip,
	};
}
