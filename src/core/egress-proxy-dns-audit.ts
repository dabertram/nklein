import { z } from "zod";

/**
 * A DNS query from the shared sandbox network namespace cannot be honestly assigned to one task or role. The stub
 * denies every query locally, so this separate trail records the attempted name and the attribution limitation
 * without contaminating the fully-attributed CONNECT audit schema.
 */
export interface EgressProxyDnsAuditRecord {
	schemaVersion: 1;
	id: string;
	queryName: string;
	sourceAddress: string;
	sourcePort: number;
	decision: "deny";
	reasonCode: "dns_blocked";
	taskId: null;
	attribution: "shared_network_namespace";
	recordedAt: number;
}

export const egressProxyDnsAuditRecordSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	queryName: z.string(),
	sourceAddress: z.string(),
	sourcePort: z.number().int().min(0).max(65_535),
	decision: z.literal("deny"),
	reasonCode: z.literal("dns_blocked"),
	taskId: z.null(),
	attribution: z.literal("shared_network_namespace"),
	recordedAt: z.number(),
}) satisfies z.ZodType<EgressProxyDnsAuditRecord>;

export function buildEgressProxyDnsAuditRecord(input: {
	id: string;
	queryName: string;
	sourceAddress: string;
	sourcePort: number;
	recordedAt: number;
}): EgressProxyDnsAuditRecord {
	return {
		schemaVersion: 1,
		...input,
		decision: "deny",
		reasonCode: "dns_blocked",
		taskId: null,
		attribution: "shared_network_namespace",
	};
}
