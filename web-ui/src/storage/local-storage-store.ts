const LEGACY_LOCAL_STORAGE_PREFIX = "kanban";

function buildPrefixedKey(prefix: string, suffix: string): string {
	return `${prefix}.${suffix}`;
}

export enum LocalStorageKey {
	TaskStartInPlanMode = "nklein.task-start-in-plan-mode",
	TaskAutoReviewEnabled = "nklein.task-auto-review-enabled",
	TaskAutoReviewMode = "nklein.task-auto-review-mode",
	AgentTipsDismissed = "nklein.agent-tips-dismissed",
	TaskCreatePrimaryStartAction = "nklein.task-create-primary-start-action",
	BottomTerminalPaneHeight = "nklein.bottom-terminal-pane-height",
	DetailAgentPanelRatio = "nklein.detail-agent-panel-ratio",
	DetailTaskCardsPanelRatio = "nklein.detail-task-cards-panel-ratio",
	DetailDiffFileTreePanelRatio = "nklein.detail-diff-file-tree-panel-ratio",
	DetailExpandedDiffFileTreePanelRatio = "nklein.detail-expanded-diff-file-tree-panel-ratio",
	ProjectNavigationPanelWidth = "kb-sidebar-width",
	ProjectNavigationPanelCollapsed = "nklein.project-navigation-panel-collapsed",
	GitHistoryRefsPanelWidth = "nklein.git-history-refs-panel-width",
	GitHistoryCommitsPanelWidth = "nklein.git-history-commits-panel-width",
	GitDiffFileTreePanelRatio = "nklein.git-diff-file-tree-panel-ratio",
	OnboardingDialogShown = "nklein.onboarding.dialog.shown",
	NotificationPermissionPrompted = "nklein.notifications.permission-prompted",
	PreferredOpenTarget = "nklein.preferred-open-target",
	NotificationBadgeClearEvent = "nklein.notification-badge-clear.v1",
	TabVisibilityPresence = "nklein.tab-visibility-presence.v1",
	Theme = "nklein.theme",
}

export const LAYOUT_CUSTOMIZATION_LOCAL_STORAGE_KEYS = [
	LocalStorageKey.BottomTerminalPaneHeight,
	LocalStorageKey.DetailAgentPanelRatio,
	LocalStorageKey.DetailTaskCardsPanelRatio,
	LocalStorageKey.DetailDiffFileTreePanelRatio,
	LocalStorageKey.DetailExpandedDiffFileTreePanelRatio,
	LocalStorageKey.ProjectNavigationPanelWidth,
	LocalStorageKey.ProjectNavigationPanelCollapsed,
	LocalStorageKey.GitHistoryRefsPanelWidth,
	LocalStorageKey.GitHistoryCommitsPanelWidth,
	LocalStorageKey.GitDiffFileTreePanelRatio,
] as const;

const LEGACY_LOCAL_STORAGE_KEY_BY_CURRENT_KEY: Partial<Record<LocalStorageKey, string>> = {
	[LocalStorageKey.TaskStartInPlanMode]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "task-start-in-plan-mode"),
	[LocalStorageKey.TaskAutoReviewEnabled]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "task-auto-review-enabled"),
	[LocalStorageKey.TaskAutoReviewMode]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "task-auto-review-mode"),
	[LocalStorageKey.AgentTipsDismissed]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "agent-tips-dismissed"),
	[LocalStorageKey.TaskCreatePrimaryStartAction]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"task-create-primary-start-action",
	),
	[LocalStorageKey.BottomTerminalPaneHeight]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"bottom-terminal-pane-height",
	),
	[LocalStorageKey.DetailAgentPanelRatio]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "detail-agent-panel-ratio"),
	[LocalStorageKey.DetailTaskCardsPanelRatio]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"detail-task-cards-panel-ratio",
	),
	[LocalStorageKey.DetailDiffFileTreePanelRatio]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"detail-diff-file-tree-panel-ratio",
	),
	[LocalStorageKey.DetailExpandedDiffFileTreePanelRatio]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"detail-expanded-diff-file-tree-panel-ratio",
	),
	[LocalStorageKey.ProjectNavigationPanelCollapsed]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"project-navigation-panel-collapsed",
	),
	[LocalStorageKey.GitHistoryRefsPanelWidth]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"git-history-refs-panel-width",
	),
	[LocalStorageKey.GitHistoryCommitsPanelWidth]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"git-history-commits-panel-width",
	),
	[LocalStorageKey.GitDiffFileTreePanelRatio]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"git-diff-file-tree-panel-ratio",
	),
	[LocalStorageKey.OnboardingDialogShown]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "onboarding.dialog.shown"),
	[LocalStorageKey.NotificationPermissionPrompted]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"notifications.permission-prompted",
	),
	[LocalStorageKey.PreferredOpenTarget]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "preferred-open-target"),
	[LocalStorageKey.NotificationBadgeClearEvent]: buildPrefixedKey(
		LEGACY_LOCAL_STORAGE_PREFIX,
		"notification-badge-clear.v1",
	),
	[LocalStorageKey.TabVisibilityPresence]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "tab-visibility-presence.v1"),
	[LocalStorageKey.Theme]: buildPrefixedKey(LEGACY_LOCAL_STORAGE_PREFIX, "theme"),
};

function getLocalStorage(): Storage | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.localStorage;
}

export function migrateLegacyLocalStorageKeys(): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		for (const [currentKey, legacyKey] of Object.entries(LEGACY_LOCAL_STORAGE_KEY_BY_CURRENT_KEY) as Array<
			[LocalStorageKey, string]
		>) {
			if (storage.getItem(currentKey) !== null) {
				continue;
			}
			const legacyValue = storage.getItem(legacyKey);
			if (legacyValue === null) {
				continue;
			}
			storage.setItem(currentKey, legacyValue);
			storage.removeItem(legacyKey);
		}
	} catch {
		// Ignore storage migration failures.
	}
}

export function readLocalStorageItem(key: LocalStorageKey): string | null {
	const storage = getLocalStorage();
	if (!storage) {
		return null;
	}
	try {
		const currentValue = storage.getItem(key);
		if (currentValue !== null) {
			return currentValue;
		}
		const legacyKey = LEGACY_LOCAL_STORAGE_KEY_BY_CURRENT_KEY[key];
		if (!legacyKey) {
			return null;
		}
		const legacyValue = storage.getItem(legacyKey);
		if (legacyValue === null) {
			return null;
		}
		storage.setItem(key, legacyValue);
		storage.removeItem(legacyKey);
		return legacyValue;
	} catch {
		return null;
	}
}

export function writeLocalStorageItem(key: LocalStorageKey, value: string): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.setItem(key, value);
	} catch {
		// Ignore storage write failures.
	}
}

export function removeLocalStorageItem(key: LocalStorageKey): void {
	const storage = getLocalStorage();
	if (!storage) {
		return;
	}
	try {
		storage.removeItem(key);
	} catch {
		// Ignore storage removal failures.
	}
}

export function resetLayoutCustomizationLocalStorageItems(): void {
	for (const key of LAYOUT_CUSTOMIZATION_LOCAL_STORAGE_KEYS) {
		removeLocalStorageItem(key);
	}
}
