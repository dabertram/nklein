/**
 * §dsh#31 slice A3 — `dev request-log-divergence`: the CALIBRATED audit between the session request log (what
 * the model actually received; slice A2 taps) and the durable `.messages.json` snapshots (what the runtime
 * persists). Calibrated means both sides flatten through the SAME `agentMessageToEndpointText` the wire tap
 * used — the quick inline probe that preceded this CLI showed hand-rolled flatteners manufacture false
 * divergence on tool rows, which would poison the one number this audit exists to produce.
 *
 * Reads are tolerant and honest: a log session with no matching snapshot is reported as UNMATCHED (auxiliary
 * sessions are deleted after their bounded turn — that absence is itself the finding), never silently skipped.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@cline/shared";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { classifyInjectionKind } from "../core/session-injection-log";
import {
	computeRequestDivergence,
	type RequestDivergenceReport,
	type SessionRequestWireMessage,
	summarizeSessionDivergence,
} from "../core/session-request-log";
import { agentMessageToEndpointText } from "../nklein-agent/local-alternate-endpoint-model";
import { readSessionInjectionRecords } from "../state/session-injection-log-store";
import { listSessionRequestLogSessions, readSessionRequestRecords } from "../state/session-request-log-store";

interface SnapshotTranscript {
	sessionId: string;
	messages: SessionRequestWireMessage[];
}

/** Flatten one persisted snapshot with the SAME flattener the wire tap used — the calibration invariant. */
function snapshotToWireMessages(document: unknown): SessionRequestWireMessage[] {
	if (!document || typeof document !== "object") {
		return [];
	}
	const messages = (document as { messages?: unknown }).messages;
	if (!Array.isArray(messages)) {
		return [];
	}
	return messages
		.filter((message): message is AgentMessage => !!message && typeof message === "object" && "role" in message)
		.map((message) => ({
			role: String(message.role),
			content: agentMessageToEndpointText(message),
		}));
}

async function findSnapshotFiles(root: string): Promise<string[]> {
	const results: string[] = [];
	const queue = [root];
	while (queue.length > 0) {
		const dir = queue.pop() as string;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
		if (!entries) {
			continue;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				queue.push(path);
			} else if (entry.name.endsWith(".messages.json")) {
				results.push(path);
			}
		}
	}
	return results;
}

async function loadSnapshots(homeDir: string): Promise<SnapshotTranscript[]> {
	const roots = [join(homeDir, ".nklein", "data", "sessions"), join(homeDir, ".nklein", "evidence-session-snapshots")];
	const transcripts: SnapshotTranscript[] = [];
	for (const root of roots) {
		for (const file of await findSnapshotFiles(root)) {
			try {
				const document: unknown = JSON.parse(await readFile(file, "utf8"));
				const sessionId =
					document &&
					typeof document === "object" &&
					typeof (document as { sessionId?: unknown }).sessionId === "string"
						? ((document as { sessionId: string }).sessionId as string)
						: "";
				const messages = snapshotToWireMessages(document);
				if (sessionId && messages.length > 0) {
					transcripts.push({ sessionId, messages });
				}
			} catch {
				// Unreadable snapshot — skip; the log side will report the session as unmatched.
			}
		}
	}
	return transcripts;
}

/** Snapshot session ids are `<taskId>-<timestamp>-<suffix>`; log scopes use the task id. Prefer exact, then unique prefix. */
function matchSnapshot(logSessionId: string, snapshots: readonly SnapshotTranscript[]): SnapshotTranscript | null {
	const exact = snapshots.find((snapshot) => snapshot.sessionId === logSessionId);
	if (exact) {
		return exact;
	}
	const prefixed = snapshots.filter((snapshot) => snapshot.sessionId.startsWith(`${logSessionId}-`));
	return prefixed.length === 1 ? (prefixed[0] as SnapshotTranscript) : null;
}

export interface RequestLogDivergenceOptions {
	/** Request-log root (defaults to the store's own resolution incl. NKLEIN_SESSION_REQUEST_LOG_ROOT). */
	rootDir?: string;
	/** HOME whose .nklein session snapshots to audit against (defaults to the process home). */
	homeDir?: string;
	/** Restrict to one (sanitized) session id. */
	sessionId?: string;
	json?: boolean;
	write?: (text: string) => void;
}

export async function runRequestLogDivergence(options: RequestLogDivergenceOptions = {}): Promise<{
	sessions: Array<{
		sessionId: string;
		matched: boolean;
		requestCount: number;
		reconstructableCount: number;
		requestsWithWireOnly: number;
		wireOnlySamples: Array<{ role: string; contentPreview: string }>;
		explainedWireOnlyCount?: number;
		injectionRecordCount?: number;
	}>;
}> {
	const write = options.write ?? ((text: string) => process.stdout.write(text));
	const homeDir = options.homeDir ?? homedir();
	const storeOptions = options.rootDir ? { rootDir: options.rootDir } : undefined;
	const sessionIds = options.sessionId ? [options.sessionId] : await listSessionRequestLogSessions(storeOptions);
	const snapshots = await loadSnapshots(homeDir);

	const sessions: Array<{
		sessionId: string;
		matched: boolean;
		requestCount: number;
		reconstructableCount: number;
		requestsWithWireOnly: number;
		wireOnlySamples: Array<{ role: string; contentPreview: string }>;
		explainedWireOnlyCount?: number;
		injectionRecordCount?: number;
	}> = [];
	for (const sessionId of sessionIds) {
		const records = await readSessionRequestRecords(sessionId, storeOptions);
		if (records.length === 0) {
			continue;
		}
		const snapshot = matchSnapshot(sessionId, snapshots);
		if (!snapshot) {
			sessions.push({
				sessionId,
				matched: false,
				requestCount: records.length,
				reconstructableCount: 0,
				requestsWithWireOnly: 0,
				wireOnlySamples: [],
			});
			continue;
		}
		const reports: RequestDivergenceReport[] = records.map((record) =>
			computeRequestDivergence(record.messages, snapshot.messages),
		);
		const summary = summarizeSessionDivergence(reports);
		// §dsh#31 B1: a wire-only row EXPLAINED by the write-ahead injection log is model-visible AND logged —
		// the invariant number is the UNEXPLAINED remainder. (Injection contents are matched by containment:
		// merge-normalization may have folded an injected rail into a larger wire row.) Injection files are
		// keyed by the FULL SDK session id (`<taskId>-<ts>-<suffix>`) while request-log scopes use the task id —
		// resolve exact-then-unique-prefix, like snapshots.
		const injectionRoot = join(resolveNkleinRuntimeHomePath(homeDir), "session-injection-log");
		const injectionFiles = (await readdir(injectionRoot).catch(() => [] as string[]))
			.filter((entry) => entry.endsWith(".jsonl"))
			.map((entry) => entry.slice(0, -".jsonl".length));
		const injectionSessionId =
			injectionFiles.find((entry) => entry === sessionId) ??
			(() => {
				const prefixed = injectionFiles.filter((entry) => entry.startsWith(`${sessionId}-`));
				return prefixed.length === 1 ? prefixed[0] : undefined;
			})();
		const injectionRecords = injectionSessionId
			? await readSessionInjectionRecords(injectionSessionId, { rootDir: injectionRoot })
			: [];
		// Two explanation tiers: VERBATIM (byte containment) and KIND-level — post-injection transforms
		// legitimately prepend/rewrite rails (live-measured: the read-files nudge prefixes the repo-map rail and
		// nets a 5-char rewrite), so byte equality is the wrong bar for "was this injection logged?". A wire-only
		// row whose classified kind has a same-kind record in this session's injection log is explained.
		const explained = summary.wireOnlySamples.filter((sample) => {
			const verbatim = injectionRecords.some(
				(record) => sample.content.includes(record.content) || record.content.includes(sample.content),
			);
			if (verbatim) {
				return true;
			}
			const kind = classifyInjectionKind({ role: sample.role, content: sample.content });
			return kind !== "other" && injectionRecords.some((record) => record.kind === kind);
		});
		sessions.push({
			sessionId,
			matched: true,
			requestCount: summary.requestCount,
			reconstructableCount: summary.reconstructableCount,
			requestsWithWireOnly: summary.requestsWithWireOnly,
			wireOnlySamples: summary.wireOnlySamples,
			explainedWireOnlyCount: explained.length,
			injectionRecordCount: injectionRecords.length,
		});
	}

	const result = { sessions };
	if (options.json) {
		write(`${JSON.stringify(result, null, 2)}\n`);
		return result;
	}
	write("session-request-log divergence (wire vs durable .messages.json, same flattener both sides)\n\n");
	for (const session of sessions) {
		if (!session.matched) {
			write(`  [${session.sessionId}] ${session.requestCount} request(s) — NO matching durable snapshot\n`);
			continue;
		}
		write(
			`  [${session.sessionId}] requests=${session.requestCount} reconstructable=${session.reconstructableCount} withWireOnly=${session.requestsWithWireOnly} wireOnlyExplainedByInjectionLog=${session.explainedWireOnlyCount ?? 0}/${session.wireOnlySamples.length} (injectionRecords=${session.injectionRecordCount ?? 0})\n`,
		);
		for (const sample of session.wireOnlySamples.slice(0, 6)) {
			write(`      wire-only ${sample.role}: ${sample.contentPreview.slice(0, 110).replaceAll("\n", " ")}\n`);
		}
	}
	const matched = sessions.filter((session) => session.matched);
	const totalRequests = matched.reduce((sum, session) => sum + session.requestCount, 0);
	const totalReconstructable = matched.reduce((sum, session) => sum + session.reconstructableCount, 0);
	write(
		`\n  rollup: ${matched.length}/${sessions.length} sessions matched; ${totalReconstructable}/${totalRequests} requests reconstructable from durable state\n`,
	);
	return result;
}
