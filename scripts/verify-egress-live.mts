/**
 * §5.AC egress LIVE validation — runs the REAL `createSearxngWebSearchClient` against a live SearXNG backend and
 * asserts: (1) a real search returns real internet results, (2) the fail-closed egress gate blocks when egress is
 * off (no request), (3) a null backend yields no_backend, (4) SearXNG payload fields map onto the contract.
 *
 * Backend:  docker compose -f docker/searxng/docker-compose.yml up -d   (binds 127.0.0.1:18888)
 * Run:      npx tsx scripts/verify-egress-live.mts
 */
import { createSearxngWebSearchClient } from "../src/server/web-search-searxng";

const BACKEND = process.env.NKLEIN_SEARXNG_URL ?? "http://localhost:18888";

// Preflight: is the backend up? (A verify script should say WHY it can't run, not throw a raw fetch error.)
try {
	const ping = await fetch(`${BACKEND}/search?q=ping&format=json`, { signal: AbortSignal.timeout(5000) });
	if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
} catch (error) {
	console.error(`✗ SearXNG backend not reachable at ${BACKEND} (${error instanceof Error ? error.message : error}).`);
	console.error("  Start it:  docker compose -f docker/searxng/docker-compose.yml up -d");
	process.exit(2);
}

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "✓" : "✗ FAIL"} ${m}`); if (!c) fail++; };

const live = createSearxngWebSearchClient({ backendBaseUrl: BACKEND, egressEnabled: true });
const r1 = await live.search("anthropic claude opus");
const hasResults = "results" in r1 && Array.isArray(r1.results) && r1.results.length > 0;
ok(hasResults, `live search returned ${"results" in r1 ? r1.results.length : 0} real results`);
if (hasResults) console.log(`   e.g. "${r1.results[0].title.slice(0, 60)}" — ${r1.results[0].url.slice(0, 55)}`);

const off = createSearxngWebSearchClient({ backendBaseUrl: BACKEND, egressEnabled: false });
const r2 = await off.search("should never fire");
ok("code" in r2 && r2.code === "blocked_by_egress", `egress OFF ⇒ blocked_by_egress (not fetched) — got ${"code" in r2 ? r2.code : "results"}`);

const nob = createSearxngWebSearchClient({ backendBaseUrl: null, egressEnabled: true });
const r3 = await nob.search("x");
ok("code" in r3 && r3.code === "no_backend", `null backend ⇒ no_backend — got ${"code" in r3 ? r3.code : "results"}`);

if (hasResults) {
	const first = r1.results[0];
	ok(typeof first.title === "string" && typeof first.url === "string", "result has title+url mapped from SearXNG payload");
}
console.log(fail === 0 ? "\nEGRESS LIVE-VALIDATED ✓" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
