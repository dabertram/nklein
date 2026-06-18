import { isClineProviderAuthenticated } from "@/runtime/native-agent";
import type {
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeClineReasoningEffort,
	RuntimeModelRoles,
} from "@/runtime/types";

const BUILT_IN_LOCAL_CLINE_PROVIDER_IDS = new Set(["ollama", "lmstudio", "lm-studio"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const FIRST_RUN_LOCAL_MODEL_ROLE_IDS = ["architect", "worker", "reviewer"] as const;

function normalizeHostname(hostname: string): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1");
}

function isPrivateIpv4(hostname: string): boolean {
	const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!match) {
		return false;
	}
	const octets = match.slice(1).map((part) => Number(part));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	const [first, second] = octets;
	return (
		first === 10 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168)
	);
}

export function isLocalClineProviderSettings(settings: RuntimeClineProviderSettings | null | undefined): boolean {
	const providerId = settings?.providerId?.trim().toLowerCase() ?? "";
	const modelId = settings?.modelId?.trim() ?? "";
	if (!providerId || !modelId) {
		return false;
	}
	if (BUILT_IN_LOCAL_CLINE_PROVIDER_IDS.has(providerId)) {
		return true;
	}
	const baseUrl = settings?.baseUrl?.trim();
	if (!baseUrl) {
		return false;
	}
	try {
		const hostname = normalizeHostname(new URL(baseUrl).hostname);
		return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || isPrivateIpv4(hostname);
	} catch {
		return false;
	}
}

export function buildFirstRunLocalModelRoles(input: {
	existingRoles: RuntimeModelRoles | undefined;
	providerId: string;
	modelId: string;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | "" | null;
}): RuntimeModelRoles | null {
	const providerId = input.providerId.trim();
	const modelId = input.modelId.trim();
	if (
		!isLocalClineProviderSettings({
			providerId,
			modelId,
			baseUrl: input.baseUrl?.trim() || null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		})
	) {
		return null;
	}
	const nextRoles: RuntimeModelRoles = { ...(input.existingRoles ?? {}) };
	let changed = false;
	for (const roleId of FIRST_RUN_LOCAL_MODEL_ROLE_IDS) {
		const role = nextRoles[roleId] ?? {};
		if (role.providerId?.trim() && role.modelId?.trim()) {
			continue;
		}
		nextRoles[roleId] = {
			...role,
			providerId,
			modelId,
			...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
		};
		changed = true;
	}
	return changed ? nextRoles : null;
}

export function isSelectedAgentAuthenticated(
	selectedAgentId: RuntimeAgentId | null | undefined,
	clineProviderSettings: RuntimeClineProviderSettings | null | undefined,
): boolean {
	if (selectedAgentId !== "cline") {
		return true;
	}
	return isClineProviderAuthenticated(clineProviderSettings);
}

export function shouldShowStartupOnboardingDialog(input: {
	hasShownOnboardingDialog: boolean;
	selectedAgentId?: RuntimeAgentId | null;
	clineProviderSettings?: RuntimeClineProviderSettings | null;
}): boolean {
	if (!input.hasShownOnboardingDialog) {
		return true;
	}
	if (input.selectedAgentId === "cline" && !isLocalClineProviderSettings(input.clineProviderSettings)) {
		return true;
	}
	return false;
}
