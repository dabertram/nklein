import { createHash } from "node:crypto";
import {
	type AgentLedgerEvent,
	type AgentResearchFreshnessEvent,
	buildResearchFreshnessEvent,
	buildRetrievalEvent,
} from "./agent-attempt-ledger";
import { decideResearchFreshnessGate } from "./research-freshness-gate";
import type { RetrievalLoopResult } from "./retrieval-loop-driver";

const MAX_DECISION_CITATIONS = 5;
const MAX_DIAGNOSTIC_CHARS = 240;

export interface DecompositionResearchPreflightInput {
	taskId: string;
	workspacePathHash: string;
	taskText: string;
	egressAvailable: boolean;
}

export interface DecompositionResearchPreflightResult {
	action: "retrieve_online" | "use_local";
	verdict: AgentResearchFreshnessEvent["verdict"];
	reason: string;
	searchAttempted: boolean;
	searchSucceeded: boolean;
	knowledgeAtBefore: number | null;
	evidenceAt: number | null;
	citations: string[];
	/** Trusted runtime-authored block appended to the decomposition system prompt and shown in the transcript. */
	promptBlock: string;
}

export interface DecompositionResearchPreflightDeps {
	now(): Date;
	readLedger(workspacePathHash: string): Promise<readonly AgentLedgerEvent[]>;
	appendLedger(event: AgentLedgerEvent): Promise<void>;
	runResearch(taskId: string, question: string): Promise<RetrievalLoopResult>;
}

/** Stable identity for semantically identical prompts without persisting an extra raw-text cache key. */
export function buildDecompositionResearchTopicKey(taskText: string): string {
	const normalized = taskText.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
	return createHash("sha256").update(normalized).digest("hex");
}

function latestCitedObservation(
	events: readonly AgentLedgerEvent[],
	topicKey: string,
): AgentResearchFreshnessEvent | null {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (
			event?.kind === "research_freshness" &&
			event.topicKey === topicKey &&
			event.evidenceAt !== null &&
			normalizeCitations(event.citations).length > 0
		) {
			return event;
		}
	}
	return null;
}

function normalizeCitation(raw: string): string | null {
	try {
		const parsed = new URL(raw.trim());
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return null;
		}
		parsed.username = "";
		parsed.password = "";
		return parsed.toString().slice(0, 2_000);
	} catch {
		return null;
	}
}

function normalizeCitations(citations: readonly string[]): string[] {
	return [
		...new Set(citations.map(normalizeCitation).filter((citation): citation is string => citation !== null)),
	].slice(0, MAX_DECISION_CITATIONS);
}

function evidenceCitations(result: RetrievalLoopResult): string[] {
	return normalizeCitations(result.evidence.map((evidence) => evidence.url?.trim() || evidence.id.trim()));
}

function safeDiagnostic(error: unknown): string {
	return [...(error instanceof Error ? error.message : String(error))]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? " " : character;
		})
		.join("")
		.slice(0, MAX_DIAGNOSTIC_CHARS);
}

function renderPromptBlock(result: Omit<DecompositionResearchPreflightResult, "promptBlock">): string {
	const disposition = result.searchAttempted
		? result.searchSucceeded
			? "SEARCHED online before decomposition"
			: "ATTEMPTED online refresh before decomposition, but no usable cited evidence was returned"
		: "SKIPPED online retrieval before decomposition";
	const citations =
		result.citations.length > 0
			? result.citations.map((citation, index) => `[${index + 1}] ${citation}`).join("\n")
			: "(no cited online evidence available)";
	return [
		"Decomposition freshness preflight (trusted runtime decision):",
		`- Decision: ${disposition}. Freshness verdict: ${result.verdict}.`,
		`- Basis: ${result.reason}`,
		"- Decision evidence:",
		citations,
		result.citations.length > 0
			? "When the decomposition mentions whether current knowledge was refreshed or reused, cite the numbered source URL(s) above. Do not repeat the same research call."
			: "State explicitly that no cited online evidence was available; do not imply that a refresh succeeded.",
	].join("\n");
}

/**
 * Deterministic decomposition preflight: consult the last cited observation for this exact topic, apply the shared
 * volatility/TTL gate, force the existing retrieval loop only on a stale decision, and ledger both branches. A failed
 * refresh is visible and remains stale; it is never promoted into a fresh cache entry.
 */
export async function runDecompositionResearchPreflight(
	input: DecompositionResearchPreflightInput,
	deps: DecompositionResearchPreflightDeps,
): Promise<DecompositionResearchPreflightResult> {
	const now = deps.now();
	const nowMs = now.getTime();
	const topicKey = buildDecompositionResearchTopicKey(input.taskText);
	// With egress unavailable the gate is a deterministic no-network skip and there is no refresh decision to make.
	// Avoid a ledger read on that path: startup remains cheap/default-off, and a corrupt observational ledger can never
	// interfere with the fail-closed decision. The skip itself is still appended below for auditability.
	const ledger = input.egressAvailable ? await deps.readLedger(input.workspacePathHash) : [];
	const previous = latestCitedObservation(ledger, topicKey);
	const knowledgeAtBefore = previous?.evidenceAt ?? null;
	const decision = decideResearchFreshnessGate({
		taskText: input.taskText,
		knowledgeAt: knowledgeAtBefore,
		now,
		egressAvailable: input.egressAvailable,
	});

	let searchAttempted = false;
	let searchSucceeded = false;
	let evidenceAt = previous?.evidenceAt ?? null;
	let citations = normalizeCitations(previous?.citations ?? []);
	let reason = decision.reason;

	if (decision.action === "retrieve_online") {
		searchAttempted = true;
		try {
			const research = await deps.runResearch(input.taskId, input.taskText);
			const refreshedCitations = evidenceCitations(research);
			searchSucceeded = refreshedCitations.length > 0;
			if (searchSucceeded) {
				evidenceAt = nowMs;
				citations = refreshedCitations;
			} else {
				reason = `${reason} The refresh returned no usable cited evidence, so prior knowledge remains stale.`;
			}
			await deps.appendLedger(
				buildRetrievalEvent({
					workflowId: input.taskId,
					taskId: input.taskId,
					workspacePathHash: input.workspacePathHash,
					role: "architect",
					query: input.taskText,
					hitsConsidered: research.evidence.length,
					citations: refreshedCitations,
				}),
			);
		} catch (error) {
			reason = `${reason} The refresh failed (${safeDiagnostic(error)}), so prior knowledge remains stale.`;
		}
	}

	const event = buildResearchFreshnessEvent({
		workflowId: input.taskId,
		taskId: input.taskId,
		workspacePathHash: input.workspacePathHash,
		role: "architect",
		topicKey,
		query: input.taskText,
		action: decision.action,
		verdict: decision.verdict,
		reason,
		knowledgeAtBefore,
		evidenceAt,
		searchAttempted,
		searchSucceeded,
		citations,
	});
	await deps.appendLedger(event);

	const partial = {
		action: decision.action,
		verdict: decision.verdict,
		reason,
		searchAttempted,
		searchSucceeded,
		knowledgeAtBefore,
		evidenceAt,
		citations,
	};
	return { ...partial, promptBlock: renderPromptBlock(partial) };
}
