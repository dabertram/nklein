import { z } from "zod";

/**
 * §5.U — the kanban-access policy extracted from `nklein-provider-service`: the remote-config value schema/parse plus the
 * pure "is the kanban board enabled for this account?" decision. Kanban is open by default; it's gated shut only for an
 * enterprise customer whose remote config does not explicitly opt in (`kanbanEnabled: true`). No I/O — the caller fetches
 * the remote config + org data and hands the parsed values here. Independently testable.
 */

export const NKLEIN_REMOTE_CONFIG_SCHEMA = z.object({
	kanbanEnabled: z.boolean().optional(),
});

export type NKleinRemoteConfig = z.infer<typeof NKLEIN_REMOTE_CONFIG_SCHEMA>;

/** Parse a raw remote-config JSON string into the typed config (throws on malformed JSON / shape). */
export function parseNKleinRemoteConfigValue(value: string): NKleinRemoteConfig {
	const parsed = JSON.parse(value) as unknown;
	return NKLEIN_REMOTE_CONFIG_SCHEMA.parse(parsed);
}

/**
 * Whether the kanban board is enabled: always for non-enterprise accounts (and when there is no parsed config); for an
 * enterprise customer, only when the remote config explicitly sets `kanbanEnabled: true`.
 */
export function computeKanbanEnabled(
	parsedRemoteConfig: NKleinRemoteConfig | null,
	isEnterpriseCustomer: boolean,
): boolean {
	return !parsedRemoteConfig || !isEnterpriseCustomer || parsedRemoteConfig.kanbanEnabled === true;
}
