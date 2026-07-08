/**
 * LIVE online-retrieval verification (§5.AC "make the knowledge-retrieval TESTS cover ONLINE too"): drives the REAL
 * retrieval loop — SearXNG search (localhost backend) → SSRF-guarded Playwright fetch → cited synthesis on the
 * resident local model — against a freshness-relevant question, and asserts: evidence was gathered online, the
 * answer carries [n] citation markers + a Sources list, and the freshness machinery ran (per-source verdicts /
 * publication dates threaded where the pages expose them).
 *
 * Run:  HOME=/tmp/nklein-verify PLAYWRIGHT_BROWSERS_PATH=$REAL_HOME/Library/Caches/ms-playwright \
 *         tsx scripts/verify-online-retrieval.mts
 *   (the isolated HOME hides the real Playwright browser cache — point PLAYWRIGHT_BROWSERS_PATH at it explicitly)
 *   env: NKLEIN_VERIFY_MODEL (default resident), NKLEIN_VERIFY_BASE_URL, NKLEIN_VERIFY_SEARXNG (default
 *        http://localhost:18888), NKLEIN_VERIFY_QUERY.
 */
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { buildSsrfGuardedPageFetcher } from "../src/chat/chat-browser-tool";
import { assertModelLoaded } from "../src/core/lmstudio-loaded-models";
import { browserFetchAdapter } from "../src/core/retrieval-fetch-adapter";
import { runRetrievalLoop } from "../src/core/retrieval-loop-driver";
import { searchHitsAdapter } from "../src/core/retrieval-search-adapter";
import { citedSynthesisAdapter } from "../src/core/retrieval-synthesis-adapter";
import { LocalLlmClient } from "../src/nklein-agent/nklein-local-llm-client";
import { createSearxngWebSearchClient } from "../src/server/web-search-searxng";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const SEARXNG_URL = process.env.NKLEIN_VERIFY_SEARXNG?.trim() || "http://localhost:18888";
const QUERY = process.env.NKLEIN_VERIFY_QUERY?.trim() || "current Node.js LTS version";

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function resolveModelId(): Promise<string> {
	const explicit = process.env.NKLEIN_VERIFY_MODEL?.trim();
	if (explicit) {
		return explicit;
	}
	const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "5", `${BASE_URL}/models`]);
	const payload = JSON.parse(stdout) as { data?: Array<{ id?: string }> };
	const id = payload.data?.find((model) => model.id?.includes("qwopus"))?.id ?? payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

async function main(): Promise<void> {
	const home = homedir();
	if (!home.includes("nklein-verify") && process.env.NKLEIN_VERIFY_ALLOW_REAL_HOME !== "1") {
		throw new Error(`Refusing to run against HOME=${home}. Use an isolated dir (e.g. /tmp/nklein-verify).`);
	}
	const modelId = await resolveModelId();
	await assertModelLoaded(BASE_URL, modelId); // never load — resident models only.
	log(`Model: ${modelId}  SearXNG: ${SEARXNG_URL}  Query: ${JSON.stringify(QUERY)}`);

	// The harness IS the deliberate egress opt-in (mirrors the runtime settings toggle): the operator's own
	// SearXNG instance is the backend, running by choice on this host.
	const searx = createSearxngWebSearchClient({ backendBaseUrl: SEARXNG_URL, egressEnabled: true });
	const llm = new LocalLlmClient({ providerId: "lmstudio", modelId, baseUrl: BASE_URL });

	const result = await runRetrievalLoop(
		QUERY,
		{
			search: searchHitsAdapter((query) => searx.search(query)),
			fetch: browserFetchAdapter(buildSsrfGuardedPageFetcher({ timeoutMs: 20_000 })),
			synthesize: citedSynthesisAdapter(async (prompt) => {
				const completion = await llm.complete({
					messages: [{ role: "user", content: prompt }],
					sampling: { temperature: 0.2, maxTokens: 4096 },
				});
				return completion.content;
			}),
			now: () => Date.now(),
		},
		{ minSources: 2 },
	);

	const evidenceCount = result.evidence.length;
	const datedEvidence = result.evidence.filter((item) => item.publishedAt).length;
	const answer = result.answer ?? "";
	const hasMarkers = /\[\d+\]/.test(answer);
	const hasSourcesList = answer.includes("Sources:");

	log("");
	log("=== Online retrieval result ===");
	log(`stoppedBecause: ${result.stoppedBecause}`);
	log(`evidence gathered: ${evidenceCount} (with publication dates: ${datedEvidence})`);
	log(`sufficiency: sufficient=${result.sufficiency.sufficient} fresh=${String(result.sufficiency.fresh)}`);
	log(`answer has [n] markers: ${hasMarkers ? "YES" : "NO"}   Sources list: ${hasSourcesList ? "YES" : "NO"}`);
	log("");
	log("--- Answer (first 800 chars) ---");
	log(answer.slice(0, 800));

	const ok = evidenceCount >= 2 && hasMarkers && hasSourcesList;
	log("");
	log(ok ? "PASS ✓ real search → fetch → cited synthesis completed online." : "INCOMPLETE — see above.");
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
