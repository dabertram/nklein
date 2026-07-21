/**
 * F4.4 live proof: seed a stale cited observation, run the production decomposition preflight through the real local
 * SearXNG → SSRF-guarded fetch loop, then repeat immediately and prove the fresh observation skips retrieval. Both
 * decisions must retain citations. This intentionally disables nested LLM synthesis: the preflight prepares the local
 * architect turn and must not consume an unadmitted model slot before that turn starts.
 *
 * Backend: docker compose -f docker/searxng/docker-compose.yml up -d
 * Run:     npx tsx scripts/verify-decomposition-freshness.mts
 */
import { buildResearchFreshnessEvent, type AgentLedgerEvent } from "../src/core/agent-attempt-ledger";
import {
	buildDecompositionResearchTopicKey,
	runDecompositionResearchPreflight,
} from "../src/core/decomposition-research-preflight";
import { createRetrievalToolsBuilder } from "../src/nklein-agent/nklein-retrieval-tools-builder";

const BACKEND = process.env.NKLEIN_VERIFY_SEARXNG?.trim() || "http://localhost:18888";
const QUERY =
	process.env.NKLEIN_VERIFY_QUERY?.trim() ||
	"Decompose support for the latest release of Node.js using site:nodejs.org official release notes.";
const NOW = new Date();
const WORKSPACE_HASH = "f4.4-live-proof";
const TASK_ID = "f4.4-live-decomposition";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

async function main(): Promise<void> {
	const ping = await fetch(`${BACKEND}/search?q=ping&format=json`, { signal: AbortSignal.timeout(5_000) });
	assert(ping.ok, `SearXNG is not reachable at ${BACKEND} (HTTP ${ping.status}).`);

	const events: AgentLedgerEvent[] = [
		buildResearchFreshnessEvent({
			workflowId: TASK_ID,
			taskId: TASK_ID,
			workspacePathHash: WORKSPACE_HASH,
			role: "architect",
			topicKey: buildDecompositionResearchTopicKey(QUERY),
			query: QUERY,
			action: "retrieve_online",
			verdict: "current",
			reason: "Live-proof stale seed.",
			knowledgeAtBefore: null,
			evidenceAt: NOW.getTime() - 46 * 24 * 60 * 60 * 1_000,
			searchAttempted: true,
			searchSucceeded: true,
			citations: ["https://example.invalid/stale-seed"],
			recordedAt: NOW.getTime() - 46 * 24 * 60 * 60 * 1_000,
		}),
	];

	const builder = createRetrievalToolsBuilder({
		getRetrievalConfig: () => ({ egressEnabled: true, agentWebResearchAllowed: true, searchBackendUrl: BACKEND }),
		resolveProviderId: () => "lmstudio",
		getModelId: () => "",
		getEndpoint: () => null,
	});
	const deps = {
		now: () => NOW,
		readLedger: async () => events,
		appendLedger: async (event: AgentLedgerEvent) => {
			events.push(event);
		},
		runResearch: (taskId: string, question: string) => builder.run(taskId, { question, synthesize: false }),
	};
	const input = { taskId: TASK_ID, workspacePathHash: WORKSPACE_HASH, taskText: QUERY, egressAvailable: true };

	const stale = await runDecompositionResearchPreflight(input, deps);
	assert(stale.verdict === "stale", `Expected stale verdict, got ${stale.verdict}.`);
	assert(stale.searchAttempted, "Stale knowledge did not trigger retrieval.");
	assert(stale.searchSucceeded, "The live retrieval returned no usable cited evidence.");
	assert(stale.citations.length > 0, "The stale/search decision has no citations.");
	const retrievalsAfterStale = events.filter((event) => event.kind === "retrieval").length;

	const fresh = await runDecompositionResearchPreflight(input, deps);
	assert(fresh.verdict === "current", `Expected current verdict after refresh, got ${fresh.verdict}.`);
	assert(!fresh.searchAttempted, "Fresh knowledge incorrectly repeated retrieval.");
	assert(fresh.citations.length > 0, "The fresh/skip decision lost its citations.");
	assert(
		events.filter((event) => event.kind === "retrieval").length === retrievalsAfterStale,
		"The fresh skip was incorrectly recorded as another retrieval.",
	);

	process.stdout.write(
		[
			"F4.4 LIVE PASS ✓",
			`stale: SEARCHED (${stale.verdict}) — ${stale.reason}`,
			`fresh: SKIPPED (${fresh.verdict}) — ${fresh.reason}`,
			"citations:",
			...fresh.citations.map((citation, index) => `  [${index + 1}] ${citation}`),
		].join("\n") + "\n",
	);
}

main().catch((error) => {
	process.stderr.write(`F4.4 LIVE FAIL ✗ ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
	process.exitCode = 1;
});
