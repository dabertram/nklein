// Local-only lockdown policy — the single source of truth for which providers !Klein may dispatch to.
//
// Decision (see plan.md "Phase L0 — LOCAL-ONLY LOCKDOWN"): !Klein runs on LOCAL models only. Cloud /
// paid providers are hard-disabled in code because they caused real harm (runaway 1M-token requests to
// a paid API, relentless retries against a $0 balance). Re-enabling cloud is a single, reviewed code
// change *here* (flip CLOUD_ENABLED), never a runtime setting, env var, or UI toggle.

/**
 * Flip to `true` — in a deliberate, reviewed code change — to allow cloud providers again.
 * Keep `false`. This is the one and only switch.
 */
export const CLOUD_ENABLED = false;

/** Providers that are inherently local, on-device inference servers. */
export const LOCAL_PROVIDER_IDS = new Set<string>(["ollama", "lmstudio", "lm-studio"]);

/** Managed Cline OAuth providers — keep in sync with web-ui/src/runtime/native-agent.ts cloud screen. */
const MANAGED_CLOUD_PROVIDER_IDS = new Set<string>(["cline", "oca", "openai-codex"]);

export class CloudProviderDisabledError extends Error {
	readonly providerId: string;

	constructor(providerId: string) {
		super(
			`Cloud models are disabled in this build (local-only mode). The provider "${providerId}" is a ` +
				`cloud/paid provider. Configure a local model (Ollama or LM Studio) in Settings → Providers, ` +
				`then try again.`,
		);
		this.name = "CloudProviderDisabledError";
		this.providerId = providerId;
	}
}

export function isCloudProviderDisabledError(error: unknown): error is CloudProviderDisabledError {
	return error instanceof CloudProviderDisabledError;
}

function normalizeHost(baseUrl: string | null | undefined): string | null {
	const value = baseUrl?.trim();
	if (!value) {
		return null;
	}
	try {
		const url = new URL(value.includes("://") ? value : `http://${value}`);
		return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	} catch {
		return null;
	}
}

/** True when a baseUrl points at the local machine or a private LAN/loopback address. */
export function isLocalBaseUrl(baseUrl: string | null | undefined): boolean {
	const host = normalizeHost(baseUrl);
	if (!host) {
		return false;
	}
	if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
		return true;
	}
	if (host.endsWith(".local") || host.endsWith(".localhost")) {
		return true;
	}
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const first = Number(ipv4[1]);
		const second = Number(ipv4[2]);
		if (first === 10 || first === 127) {
			return true; // private + loopback
		}
		if (first === 192 && second === 168) {
			return true; // private
		}
		if (first === 172 && second >= 16 && second <= 31) {
			return true; // private
		}
		if (first === 169 && second === 254) {
			return true; // link-local
		}
		if (first === 100 && second >= 64 && second <= 127) {
			return true; // CGNAT (tailscale et al.)
		}
	}
	return false;
}

/**
 * True when a provider may run under local-only mode. Default-deny: anything that isn't an explicit
 * local provider id and isn't pointed at a local/private endpoint is treated as cloud.
 */
export function isLocalProvider(providerId: string, baseUrl?: string | null): boolean {
	const id = providerId.trim().toLowerCase();
	if (!id) {
		return false;
	}
	if (MANAGED_CLOUD_PROVIDER_IDS.has(id)) {
		return false; // cline / oca / openai-codex always reach cloud
	}
	if (LOCAL_PROVIDER_IDS.has(id)) {
		return true; // ollama / lmstudio
	}
	// Custom / openai-compatible providers are local only when their endpoint is local.
	return isLocalBaseUrl(baseUrl);
}

export interface LocalProviderAssertionInput {
	providerId: string;
	baseUrl?: string | null;
}

/**
 * Throws {@link CloudProviderDisabledError} unless the provider is local (and cloud stays disabled).
 * This is the single guard every dispatch path funnels through.
 */
export function assertLocalProviderAllowed(input: LocalProviderAssertionInput): void {
	if (CLOUD_ENABLED) {
		return;
	}
	if (isLocalProvider(input.providerId, input.baseUrl)) {
		return;
	}
	throw new CloudProviderDisabledError(input.providerId.trim() || "unconfigured");
}
