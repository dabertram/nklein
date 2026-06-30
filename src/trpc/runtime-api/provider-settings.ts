import type {
	RuntimeNKleinAddProviderResponse,
	RuntimeNKleinProviderSettingsSaveResponse,
	RuntimeNKleinUpdateProviderResponse,
} from "../../core/api-contract";
import {
	parseNKleinAddProviderRequest,
	parseNKleinProviderSettingsSaveRequest,
	parseNKleinUpdateProviderRequest,
} from "../../core/api-validation";
import type { createNKleinProviderService } from "../../nklein-agent/nklein-provider-service";

interface ProviderSettingsDeps {
	nkleinProviderService: ReturnType<typeof createNKleinProviderService>;
	bumpNKleinSessionContextVersion?: () => void;
}

/**
 * Save provider settings (the runtime-api `saveNKleinProviderSettings` procedure handler, extracted
 * from the factory). Bumps the session context version so live sessions pick up the change. The
 * factory-local provider service is passed in, so the lift is behavior-preserving.
 */
export async function handleSaveNKleinProviderSettings(
	input: unknown,
	deps: ProviderSettingsDeps,
): Promise<RuntimeNKleinProviderSettingsSaveResponse> {
	const body = parseNKleinProviderSettingsSaveRequest(input);
	const response = await deps.nkleinProviderService.saveProviderSettings(body);
	deps.bumpNKleinSessionContextVersion?.();
	return response;
}

/** Add a custom provider (the runtime-api `addNKleinProvider` procedure handler). */
export async function handleAddNKleinProvider(
	input: unknown,
	deps: ProviderSettingsDeps,
): Promise<RuntimeNKleinAddProviderResponse> {
	const body = parseNKleinAddProviderRequest(input);
	const response = await deps.nkleinProviderService.addCustomProvider(body);
	deps.bumpNKleinSessionContextVersion?.();
	return response;
}

/** Update a custom provider (the runtime-api `updateNKleinProvider` procedure handler). */
export async function handleUpdateNKleinProvider(
	input: unknown,
	deps: ProviderSettingsDeps,
): Promise<RuntimeNKleinUpdateProviderResponse> {
	const body = parseNKleinUpdateProviderRequest(input);
	const response = await deps.nkleinProviderService.updateCustomProvider(body);
	deps.bumpNKleinSessionContextVersion?.();
	return response;
}
