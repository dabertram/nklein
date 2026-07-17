/**
 * Air-gap posture assessment (F12.101 first slice) — PURE core.
 *
 * The trust-center's egress inventory names every class that can leave the machine; "air-gapped" means every one of
 * them is CLOSED. Until the one-switch profile exists, this assessor turns the CURRENT flag/config state into an
 * honest per-class OPEN/CLOSED report + an overall verdict — the manual posture check, mechanized. Pure: the caller
 * reads env/config/files and hands in facts.
 */

export interface AirGapPostureInput {
	/** KANBAN_ENABLE_WEB_RESEARCH === "1" (the web_research tool gate). */
	readonly webResearchEnabled: boolean;
	/** Auto-update NOT disabled (NKLEIN_NO_AUTO_UPDATE / KANBAN_NO_AUTO_UPDATE unset). */
	readonly autoUpdateEnabled: boolean;
	/** User-configured MCP servers (beyond the curated offline set). */
	readonly configuredMcpServers: number;
	/** The lmstudio provider base URL (egress if pointed off-machine). */
	readonly providerBaseUrl: string | null;
}

export interface AirGapClassStatus {
	readonly egressClass: string;
	readonly open: boolean;
	readonly detail: string;
}

export interface AirGapPosture {
	readonly classes: readonly AirGapClassStatus[];
	readonly airGapped: boolean;
	readonly summary: string;
}

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)/i;

export function assessAirGapPosture(input: AirGapPostureInput): AirGapPosture {
	const classes: AirGapClassStatus[] = [
		{
			egressClass: "web_research",
			open: input.webResearchEnabled,
			detail: input.webResearchEnabled
				? "KANBAN_ENABLE_WEB_RESEARCH=1 — the web_research tool can fetch allow-listed HTTPS sources."
				: "disabled (default) — no web fetches.",
		},
		{
			egressClass: "auto_update",
			open: input.autoUpdateEnabled,
			detail: input.autoUpdateEnabled
				? "auto-update enabled — set NKLEIN_NO_AUTO_UPDATE=1 to close."
				: "disabled via NKLEIN_NO_AUTO_UPDATE.",
		},
		{
			egressClass: "mcp_servers",
			open: input.configuredMcpServers > 0,
			detail:
				input.configuredMcpServers > 0
					? `${input.configuredMcpServers} user-configured MCP server(s) — each is a user-chosen egress/ingress channel.`
					: "none configured (the curated sandbox set runs --network none).",
		},
		{
			egressClass: "model_inference",
			open: input.providerBaseUrl !== null && !LOCAL_HOST.test(input.providerBaseUrl),
			detail:
				input.providerBaseUrl === null
					? "no provider base URL configured (defaults to localhost)."
					: LOCAL_HOST.test(input.providerBaseUrl)
						? `local endpoint (${input.providerBaseUrl}).`
						: `NON-LOCAL provider endpoint: ${input.providerBaseUrl} — prompts/code leave this machine!`,
		},
	];
	const openClasses = classes.filter((status) => status.open);
	return {
		classes,
		airGapped: openClasses.length === 0,
		summary:
			openClasses.length === 0
				? "AIR-GAPPED posture: every egress class is closed."
				: `NOT air-gapped: ${openClasses.length} class(es) open — ${openClasses.map((status) => status.egressClass).join(", ")}.`,
	};
}
