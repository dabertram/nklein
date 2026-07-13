import { z } from "zod";
import { AGENT_RULESET_ROLES, type AgentRulesetRole, type SandboxNetworkPolicy } from "./agent-rulesets";
import type { EgressDecision, EgressDenyReasonCode } from "./egress-policy-decision";
import type { EgressProxyParsedTarget } from "./egress-proxy-protocol";
import {
	EGRESS_PROXY_LOCAL_REASON_CODES,
	type EgressProxyReasonCode,
	type EgressProxyVerdict,
} from "./egress-proxy-verdict";

/**
 * Egress-proxy per-attempt audit RECORD (docs/dev/egress-proxy-design.md §5 audit record; R5). PURE: the record
 * shape, a builder over an already-decided verdict (id + recordedAt INJECTED — no clock, no uuid), and the JSONL
 * line encoding. Structurally mirrors `chat-egress-attempt-audit-store.ts` (schemaVersion literal, zod-validated,
 * one JSON object per line for `parseValidatedJsonl` reads); the effectful STORE (append to the RW-mounted
 * `~/.nklein/sandbox-audit/` JSONL, newest-first reads) rides a later increment.
 */

export type EgressProxyAuditTransport = "connect" | "http" | "dns";

export interface EgressProxyAuditRecord {
	schemaVersion: 1;
	id: string;
	role: AgentRulesetRole;
	policy: SandboxNetworkPolicy;
	listenerPort: number;
	transport: EgressProxyAuditTransport;
	/** The attempted target as stated by the client (e.g. `api.example.com:443`), even when the parse failed. */
	target: string;
	host: string | null;
	port: number | null;
	decision: EgressDecision;
	reasonCode: EgressProxyReasonCode | null;
	reason: string;
	resolvedIps: readonly string[] | null;
	/** F2.5: the AUTHENTICATED task this attempt is attributed to, or null (no/invalid identity claim). */
	taskId: string | null;
	/** Whether bytes actually flowed (a tunnel was established) — always false for deny/confirm in v1. */
	executed: boolean;
	bytesIn: number;
	bytesOut: number;
	durationMs: number;
	recordedAt: number;
}

// The pure core's codes, restated as literals for the zod enum. `satisfies` pins each entry to a real member, so a
// rename upstream fails the build here; a NEWLY ADDED code must be appended (the audit tests exercise every path).
const PURE_DENY_REASON_CODES = [
	"no_egress_policy",
	"unparseable_target",
	"unsupported_scheme",
	"ip_literal",
	"private_or_lan_host",
	"not_on_allowlist",
] as const satisfies readonly EgressDenyReasonCode[];

export const EGRESS_PROXY_AUDIT_REASON_CODES = [
	...PURE_DENY_REASON_CODES,
	...EGRESS_PROXY_LOCAL_REASON_CODES,
] as const satisfies readonly EgressProxyReasonCode[];

export const egressProxyAuditRecordSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	role: z.enum(AGENT_RULESET_ROLES),
	policy: z.enum(["none", "allowlist", "full"]),
	listenerPort: z.number(),
	transport: z.enum(["connect", "http", "dns"]),
	target: z.string(),
	host: z.string().nullable(),
	port: z.number().nullable(),
	decision: z.enum(["allow", "deny", "confirm"]),
	reasonCode: z.enum(EGRESS_PROXY_AUDIT_REASON_CODES).nullable(),
	reason: z.string(),
	resolvedIps: z.array(z.string()).nullable(),
	taskId: z.string().nullable().optional().default(null),
	executed: z.boolean(),
	bytesIn: z.number(),
	bytesOut: z.number(),
	durationMs: z.number(),
	recordedAt: z.number(),
}) satisfies z.ZodType<EgressProxyAuditRecord>;

/** Everything the builder needs, injected — the proxy server owns ids, clocks, and byte counters. */
export interface EgressProxyAuditRecordInput {
	id: string;
	recordedAt: number;
	role: AgentRulesetRole;
	policy: SandboxNetworkPolicy;
	listenerPort: number;
	transport: EgressProxyAuditTransport;
	target: string;
	verdict: EgressProxyVerdict;
	resolvedIps?: readonly string[] | null;
	taskId?: string | null;
	executed?: boolean;
	bytesIn?: number;
	bytesOut?: number;
	durationMs: number;
}

/** Build the §5 audit record for one attempt (allow AND deny AND confirm — every attempt is recorded, R5). */
export function buildEgressProxyAuditRecord(input: EgressProxyAuditRecordInput): EgressProxyAuditRecord {
	return {
		schemaVersion: 1,
		id: input.id,
		role: input.role,
		policy: input.policy,
		listenerPort: input.listenerPort,
		transport: input.transport,
		target: input.target,
		host: input.verdict.host,
		port: input.verdict.port,
		decision: input.verdict.decision,
		reasonCode: input.verdict.reasonCode,
		reason: input.verdict.reason,
		resolvedIps: input.resolvedIps ?? null,
		taskId: input.taskId ?? null,
		executed: input.executed ?? false,
		bytesIn: input.bytesIn ?? 0,
		bytesOut: input.bytesOut ?? 0,
		durationMs: input.durationMs,
		recordedAt: input.recordedAt,
	};
}

/** One append-ready JSONL line (`JSON.stringify` emits no raw newlines, so one record is always one line). */
export function encodeEgressProxyAuditRecordLine(record: EgressProxyAuditRecord): string {
	return `${JSON.stringify(record)}\n`;
}

/** Map a parsed target's extraction path to the audit `transport` (the DNS-stub transport arrives with I2). */
export function egressProxyTransportForParsedKind(kind: EgressProxyParsedTarget["kind"]): EgressProxyAuditTransport {
	return kind === "connect" ? "connect" : "http";
}
