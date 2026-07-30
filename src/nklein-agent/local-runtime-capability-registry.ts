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

import type { ServedContextVerdict } from "../core/served-context-assertion";

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
	/**
	 * P17.6 — can !Klein get KV/prompt cache state that SURVIVES A MODEL UNLOAD out of this runtime?
	 *
	 * FAIL-CLOSED: `false` unless verified true against the running engine. A wrong `true` here would have
	 * !Klein skip prefill it actually still owes, so the default must be the pessimistic one.
	 *
	 * Why every entry is currently `false` (researched + verified 2026-07-30):
	 *  - **lmstudio** — BOTH of its engines discard it. Its MLX engine does disk-cache KV at 256-token
	 *    boundaries with LRU eviction, but LM Studio documents the store as scratch-only: the cache "will not
	 *    leave persistent files", and "On model unload, the cache store clears its in-memory index and closes
	 *    the scratch file." Its llama.cpp engine COULD persist — upstream supports `--slot-save-path` with
	 *    `POST /slots/<id>?action=save|restore` — but LM Studio does not pass that flag (verified against the
	 *    live `llama-server` argv, which carries ctx-size/n-gpu-layers/cache-type/flash-attn and no slot path).
	 *    So the capability exists in the engine and is switched off above it; !Klein cannot reach it through
	 *    this provider.
	 *  - **ollama / mlxserve** — NOT INVESTIGATED YET. They are `false` because that is the fail-closed default,
	 *    NOT because either was tested and found lacking. Flip only with a probe against a running instance.
	 *
	 * This field is deliberately a static capability claim, not a live probe: it answers "is it worth asking?"
	 * The actual save/restore round-trip must still be verified at runtime before any prefill is skipped.
	 */
	readonly persistsKvCacheAcrossUnload: boolean;
	/**
	 * P21.3 — is this runtime's ADVERTISED context window honestly SERVED, or does it silently discard the
	 * overflow? Shares `ServedContextVerdict`'s vocabulary (`served-context-assertion.ts`) so a probe result
	 * drops straight in.
	 *
	 * ── WHY THIS BECAME A PER-RUNTIME FIELD (2026-07-30) ──
	 * P21.3 exists because Ollama's 2k default *"silently discards context that exceeds the window"* — a failure
	 * that errors NOWHERE; the model just answers from half a prompt. P21.3b then probed the fleet live
	 * (2026-07-20) and found LM Studio does NOT have the trap: a fitting prompt was fully ingested and the needle
	 * recalled, and an OVER-window prompt failed LOUD rather than truncating. The conclusion recorded was
	 * "prime-directive #3's fear is unfounded" — but that conclusion is scoped to **LM Studio, which was then the
	 * whole fleet**. As a prose note it silently EXPIRES the moment P17.1a lands a second adapter: nothing would
	 * re-ask the question for mlx-serve, and the danger P21.3 was built for is exactly the kind that reports
	 * nothing when it bites. Recording it per-runtime is what keeps the measurement attached to the thing it
	 * measured.
	 *
	 * FAIL-CLOSED: `"unverified"` unless probed against a running engine — same direction as
	 * `persistsKvCacheAcrossUnload` and as `assessServedContext` itself, where absent evidence resolves to "no".
	 * A false `"verified"` costs a silent truncation in production; a false `"unverified"` costs one probe.
	 */
	readonly servedContextHonesty: ServedContextVerdict;
}

export const LOCAL_RUNTIME_CAPABILITIES: readonly LocalRuntimeCapability[] = [
	{
		providerId: "lmstudio",
		aliases: ["lm-studio"],
		liveDiscoveryOnly: true,
		mergesLmsRoster: true,
		supportsLoad: true,
		persistsKvCacheAcrossUnload: false,
		// PROBED LIVE 2026-07-20 (P21.3b): `qwen/qwen3-8b` at an 8192 window. A 3498-token prompt reported
		// `prompt_tokens: 3498` — fully ingested, not clamped — and the needle planted at position 0 was recalled
		// verbatim. A ~16.8k over-window prompt ERRORED LOUDLY rather than truncating. Honest on both sides.
		servedContextHonesty: "verified",
	},
	{
		providerId: "ollama",
		aliases: [],
		liveDiscoveryOnly: false,
		mergesLmsRoster: false,
		supportsLoad: false,
		persistsKvCacheAcrossUnload: false,
		// The runtime P21.3 was WRITTEN about: its 2k default silently discards the overflow. Still "unverified"
		// rather than "silently_truncated" because !Klein has never probed an actual instance — the trap is
		// documented upstream, not measured here, and this field records OUR evidence.
		servedContextHonesty: "unverified",
	},
	{
		providerId: "mlxserve",
		aliases: ["mlx-serve"],
		liveDiscoveryOnly: true,
		mergesLmsRoster: false,
		supportsLoad: false,
		persistsKvCacheAcrossUnload: false,
		// NOT PROBED. This is the entry that makes the field worth having: when P17.1a lands mlx-serve, its
		// context honesty is an OPEN question, and the fail-closed default says so instead of inheriting
		// LM Studio's verdict by silence.
		servedContextHonesty: "unverified",
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
