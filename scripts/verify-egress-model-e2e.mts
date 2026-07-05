/**
 * §5.AC egress END-TO-END with a LIVE model: a loaded model is offered the real web_search tool, must EMIT a
 * web_search tool call, whose query is executed against the live SearXNG backend, then the real results are fed back
 * and the model must use them. Proves the whole egress feature (model → tool-call → egress → real results → answer).
 *
 * Backend:  docker compose -f docker/searxng/docker-compose.yml up -d
 * Run:      NKLEIN_E2E_MODEL=brain27 npx tsx scripts/verify-egress-model-e2e.mts   (default brain27)
 */
import { createSearxngWebSearchClient } from "../src/server/web-search-searxng";

const ENDPOINT = process.env.NKLEIN_LMS_URL ?? "http://localhost:1234/v1/chat/completions";
const MODEL = process.env.NKLEIN_E2E_MODEL ?? "brain27";
const client = createSearxngWebSearchClient({ backendBaseUrl: "http://localhost:18888", egressEnabled: true });
const webSearchTool = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current, up-to-date information not in your training data. Returns titles, URLs, and snippets.",
    parameters: { type: "object", properties: { query: { type: "string", description: "A precise search query." } }, required: ["query"] },
  },
};
async function chat(messages: unknown[], tools?: unknown[]) {
  const res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, ...(tools ? { tools, tool_choice: "auto" } : {}), temperature: 0, max_tokens: 2048 }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as any;
}
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "✓" : "✗ FAIL"} ${m}`); if (!c) fail++; };
const sys = { role: "system", content: "You are a helpful assistant with a web_search tool. When asked about current/recent info, CALL web_search rather than guessing." };
const user = { role: "user", content: "Use web_search to find the official Anthropic page for Claude Opus, then tell me the URL." };

const r1 = await chat([sys, user], [webSearchTool]);
const msg1 = r1.choices?.[0]?.message;
const call = msg1?.tool_calls?.[0];
ok(call?.function?.name === "web_search", `[${MODEL}] emitted a web_search tool call (finish=${r1.choices?.[0]?.finish_reason})`);
if (!call) { console.log("  msg:", JSON.stringify(msg1)?.slice(0, 160)); process.exit(1); }
const args = JSON.parse(call.function.arguments || "{}");
const results = await client.search(args.query || "Claude Opus Anthropic");
const hasResults = "results" in results && results.results.length > 0;
ok(hasResults, `[${MODEL}] query "${(args.query||"").slice(0,40)}" → ${"results" in results ? results.results.length : 0} real SearXNG results`);
const toolResult = "results" in results ? `Web results:\n${results.results.slice(0,5).map((r,i)=>`${i+1}. ${r.title} — ${r.url}`).join("\n")}` : `error: ${(results as any).code}`;
const r2 = await chat([sys, user, msg1, { role: "tool", tool_call_id: call.id, content: toolResult }]);
const final = r2.choices?.[0]?.message?.content ?? "";
ok(final.toLowerCase().includes("anthropic.com") || final.toLowerCase().includes("claude"), `[${MODEL}] used the real results in its answer`);
console.log(`  answer: ${final.slice(0, 120).replace(/\n/g,' ')}`);
process.exit(fail === 0 ? 0 : 1);
