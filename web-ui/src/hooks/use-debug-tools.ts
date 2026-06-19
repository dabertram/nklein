import { useCallback, useState } from "react";

import { notifyError } from "@/components/app-toaster";
import { openFileOnHost, resetRuntimeDebugState } from "@/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/runtime/types";

interface UseDebugToolsParams {
	runtimeProjectConfig: RuntimeConfigResponse | null;
	settingsRuntimeProjectConfig: RuntimeConfigResponse | null;
	onOpenStartupOnboardingDialog: () => void;
}

interface UseDebugToolsResult {
	developerModeEnabled: boolean;
	isDebugDialogOpen: boolean;
	isResetAllStatePending: boolean;
	dataDirectoryPath: string | null;
	handleOpenDebugDialog: () => void;
	handleOpenDataDirectory: () => void;
	handleShowStartupOnboardingDialog: () => void;
	handleDebugDialogOpenChange: (nextOpen: boolean) => void;
	handleResetAllState: () => void;
}

function resolveRuntimeDataDirectoryPath(config: RuntimeConfigResponse | null): string | null {
	const globalConfigPath = config?.globalConfigPath?.trim() ?? "";
	if (!globalConfigPath) {
		return null;
	}
	if (globalConfigPath.endsWith("/config.json")) {
		return globalConfigPath.slice(0, -"/config.json".length);
	}
	if (globalConfigPath.endsWith("\\config.json")) {
		return globalConfigPath.slice(0, -"\\config.json".length);
	}
	return null;
}

export function useDebugTools({
	runtimeProjectConfig,
	settingsRuntimeProjectConfig,
	onOpenStartupOnboardingDialog,
}: UseDebugToolsParams): UseDebugToolsResult {
	const [isDebugDialogOpen, setIsDebugDialogOpen] = useState(false);
	const [isResetAllStatePending, setIsResetAllStatePending] = useState(false);
	const developerModeEnabled =
		(settingsRuntimeProjectConfig?.developerModeEnabled ?? runtimeProjectConfig?.developerModeEnabled ?? false) ===
		true;
	const dataDirectoryPath =
		resolveRuntimeDataDirectoryPath(settingsRuntimeProjectConfig) ??
		resolveRuntimeDataDirectoryPath(runtimeProjectConfig);

	const handleOpenDebugDialog = useCallback(() => {
		setIsDebugDialogOpen(true);
	}, []);

	const handleDebugDialogOpenChange = useCallback((nextOpen: boolean) => {
		setIsDebugDialogOpen(nextOpen);
	}, []);

	const handleShowStartupOnboardingDialog = useCallback(() => {
		setIsDebugDialogOpen(false);
		onOpenStartupOnboardingDialog();
	}, [onOpenStartupOnboardingDialog]);

	const handleOpenDataDirectory = useCallback(() => {
		if (!dataDirectoryPath) {
			notifyError("Could not determine the !Klein data directory.");
			return;
		}
		void openFileOnHost(null, dataDirectoryPath).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			notifyError(`Could not open !Klein data directory: ${message}`);
		});
	}, [dataDirectoryPath]);

	const handleResetAllState = useCallback(() => {
		if (isResetAllStatePending) {
			return;
		}
		void (async () => {
			setIsResetAllStatePending(true);
			try {
				await resetRuntimeDebugState(null);
				window.localStorage.clear();
				window.sessionStorage.clear();
				window.location.reload();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notifyError(`Could not reset all state: ${message}`);
				setIsResetAllStatePending(false);
			}
		})();
	}, [isResetAllStatePending]);

	return {
		developerModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		dataDirectoryPath,
		handleOpenDebugDialog,
		handleOpenDataDirectory,
		handleShowStartupOnboardingDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	};
}
