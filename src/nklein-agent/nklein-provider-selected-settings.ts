// F1.30 (§5.U) — the selected-provider resolution shared by every provider-service cluster: which provider the
// kanban currently points at, resolved to SDK settings, with the local-only filter applied (a cloud selection
// resolves to null so every downstream path fails closed). Extracted verbatim from nklein-provider-service.ts.

import { toErrorMessage as formatErrorMessage } from "../core/error-message";
import { isLocalProvider } from "./nklein-local-only-policy";
import { healMissingProviderSelection } from "./nklein-provider-selection-heal";
import { readKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import { getSdkProviderSettings, type SdkProviderSettings } from "./sdk-provider-boundary";

export const DEFAULT_NKLEIN_API_BASE_URL = "https://api.nklein.bot";

function isLocalProviderSettings(settings: Pick<SdkProviderSettings, "provider" | "baseUrl"> | null): boolean {
	if (!settings) {
		return false;
	}
	return isLocalProvider(settings.provider, settings.baseUrl);
}

export function getSelectedProviderSettings(): SdkProviderSettings | null {
	const resolvedProviderId = readKanbanSelectedProviderId();
	if (!resolvedProviderId) {
		// 2026-09-06: a vanished selection file (temp-folder sweep) is healed from the runtime home's own evidence
		// instead of refusing every start until a human opens Settings — still local-only, still fail-closed.
		const healed = healMissingProviderSelection();
		return healed && isLocalProviderSettings(healed.settings) ? healed.settings : null;
	}
	const settings = getSdkProviderSettings(resolvedProviderId) ?? { provider: resolvedProviderId };
	return isLocalProviderSettings(settings) ? settings : null;
}

export function toProviderServiceErrorMessage(error: unknown): string {
	return formatErrorMessage(error, "An unexpected error occurred.");
}
