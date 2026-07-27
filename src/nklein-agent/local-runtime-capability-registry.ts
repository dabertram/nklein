/**
 * P17.1 phase ① — the per-provider LOCAL RUNTIME capability record, replacing scattered `"lmstudio"` string
 * gates so a second local inference runtime (mlx-serve, P17.1a) can exist without threading its id through
 * every seam. The record answers the questions the gates used to hardcode:
 *
 *  - which spellings name this runtime (`aliases`),
 *  - do its models exist only LIVE at the endpoint, with no persisted catalog (`liveDiscoveryOnly` — drives
 *    the measured-context-window overlay in discovery),
 *  - does discovery merge the `lms ps` CLI roster (`mergesLmsRoster` — LM Studio only; the LM-Link
 *    multi-device view has no equivalent elsewhere),
 *  - does the runtime expose a load/unload API !Klein may drive on its DEV/opt-in paths (`supportsLoad` —
 *    `false` makes the standing "production never auto-loads" rule STRUCTURAL for that runtime: every load
 *    seam degrades to recommendation strings).
 *
 * `mlxserve` is registered here as the structural second id (P17.1 phase ② routes discovery through an
 * adapter; nothing consumes the id yet — registering it is deliberately behavior-neutral for existing ids).
 */

export interface LocalRuntimeCapability {
	/** Canonical provider id (lowercase). */
	readonly providerId: string;
	/** Accepted alternative spellings (lowercase). */
	readonly aliases: readonly string[];
	/** Models exist only live at the endpoint — no persisted credential/catalog (LM Studio semantics). */
	readonly liveDiscoveryOnly: boolean;
	/** Discovery merges the `lms ps` CLI roster (LM Studio's multi-device LM-Link view). */
	readonly mergesLmsRoster: boolean;
	/** The runtime has a load/unload API !Klein's dev/opt-in paths may drive. */
	readonly supportsLoad: boolean;
}

export const LOCAL_RUNTIME_CAPABILITIES: readonly LocalRuntimeCapability[] = [
	{
		providerId: "lmstudio",
		aliases: ["lm-studio"],
		liveDiscoveryOnly: true,
		mergesLmsRoster: true,
		supportsLoad: true,
	},
	{
		providerId: "ollama",
		aliases: [],
		liveDiscoveryOnly: false,
		mergesLmsRoster: false,
		supportsLoad: false,
	},
	{
		providerId: "mlxserve",
		aliases: ["mlx-serve"],
		liveDiscoveryOnly: true,
		mergesLmsRoster: false,
		supportsLoad: false,
	},
];

const CAPABILITY_BY_ID: ReadonlyMap<string, LocalRuntimeCapability> = new Map(
	LOCAL_RUNTIME_CAPABILITIES.flatMap((capability) => [
		[capability.providerId, capability] as const,
		...capability.aliases.map((alias) => [alias, capability] as const),
	]),
);

/** The capability record for a provider id (any registered spelling), or null for non-local-runtime ids. */
export function findLocalRuntimeCapability(providerId: string | null | undefined): LocalRuntimeCapability | null {
	const id = providerId?.trim().toLowerCase();
	return id ? (CAPABILITY_BY_ID.get(id) ?? null) : null;
}

/** Every registered local-runtime provider id and alias (the LOCAL_PROVIDER_IDS membership set). */
export function localRuntimeProviderIds(): ReadonlySet<string> {
	return new Set(CAPABILITY_BY_ID.keys());
}
