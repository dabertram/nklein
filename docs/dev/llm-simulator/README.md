# LLM simulator — the simulated fast path (todo §13)

`packages/llm-simulator` is a standalone, !Klein-free mock-LLM engine (scenario tracks + seeded RNG compiled onto
[@copilotkit/aimock](https://www.npmjs.com/package/@copilotkit/aimock) as transport, plus an LM Studio `/api/v0`
catalog shim). !Klein consumes it only through its OpenAI-compatible HTTP surface — point the provider `baseUrl`
at it and the full runtime (decompose → workers → acceptance → review → delivery) runs at memory speed with zero
LLM compute. Research trail: [existing-solutions.md](existing-solutions.md) (build-vs-buy → hybrid on aimock),
[failure-catalog.md](failure-catalog.md) (the 80-mode failure taxonomy scenario tracks cite by id),
[build-vs-buy.md](build-vs-buy.md).

## Daily commands

| What | How |
|---|---|
| Package unit tests (wire truths, compiler, shim, distiller, all checked-in sets) | `npm run test:simulator` |
| Full-chain smoke: real runtime + inline 2-card scenario → Completed | `npm run test:simulated-flows` |
| Drive a real dev-test project with its generated set | `HOME=$(mktemp -d /tmp/nklein-simflow-XXXX) NKLEIN_SIMFLOW_SCENARIO=02 npx tsx scripts/verify-simulated-flow.mts` |
| Same, flaky variant (catalog failure injections + recovery) | `… NKLEIN_SIMFLOW_RUN=flaky …` |
| ≥3-model swarm role-routing verification (todo §5 ★) | `… NKLEIN_SIMFLOW_MULTI_MODEL=1 …` |
| Per-machine pools plumbing (fake `lms` two-machine feed) | `… NKLEIN_SIMFLOW_POOLS=1 …` |
| Regenerate the lower-20 scenario sets from the specs | `npx tsx scripts/generate-scenario-sets.mts [NN…]` |
| Capture real-LLM traffic (reflection loop, §13d) | `npx tsx scripts/run-record-proxy.mts --upstream http://127.0.0.1:1234 --out captures/<name>` |
| Distill a capture into scenario tracks | `npx tsx scripts/distill-capture.mts captures/<name>` |

The harness (`scripts/verify-simulated-flow.mts`) refuses `HOME=/Users/david`, provisions an isolated HOME,
boots the runtime on :3986, seeds via `dev test-project --preset <registry-id>` (any `dev-test-projects/` folder
id is a valid preset), dumps the simulator request journal + `journal.json`/`runtime.log` into the HOME, and — in
scenario perfect-run mode — FAILS unless the board fully drains to Completed.

## Scenario sets (packages/llm-simulator/scenarios/)

One directory per lower-20 dev-test project: `perfect-run.json`, `flaky-run.json`, `README.md`. Set 01 is
hand-authored (deep domain content); 02–20 come from `scripts/generate-scenario-sets.mts` (tier-ramped 18–50
cards; zero-dependency ESM + `node:test` card content so `npm test` acceptance is genuinely green offline).
`packages/llm-simulator/test/scenario-sets.test.ts` walks every set through the real compiler and enforces the
wire truths below — run it before trusting an edited set.

## The wire truths (hard-won; encoded in request-classifier.test.ts + scenario-sets.test.ts)

1. **System prompts are identical** generic text across decompose/worker/review sessions — classification lives
   in USER text scaffolds ("Leaf scope:" → worker, "second-opinion reviewer" → review), checked BEFORE tool names.
2. **The full ~30-tool registry rides along on every kanban session** (incl. `decompose_project`) — tool presence
   is NOT a decompose signal. `submit_review` (review's distinct 17-tool list) is the only class-exclusive tool.
3. **A plan seed is wire-identical to a worker card** (same Leaf-scope scaffold) ⇒ no universal decompose signal
   exists. Decompose tracks are class `any` keyed on their own project's seed phrase (the "I want to build a real
   …, not a fake MVP" product line).
4. **`submit_review` requires a non-empty `summary`** (`feedback` only for request_changes) — feedback-only
   verdicts bounce (`ok:false`) and the review ends `no_verdict`.
5. **Turns are conditioned on transcript shape** — the request's assistant-message count IS the per-session turn
   index (aimock's own recorder stores the same count as `turnIndex`). Never use aimock `sequenceIndex`: its
   occurrence counting is global per fixture, so concurrent sessions and !Klein's redrives desynchronize ladders.
   Restarted sessions (fresh transcript) deterministically restart at turn 0 — restart-idempotent.
6. **Needle exclusivity** — !Klein embeds the decompose `spec` into every card prompt AND the context focus brief
   enumerates merged workspace paths. A worker needle must exist in EXACTLY ONE card prompt and nowhere shared:
   use the per-card `Files for THIS card: src/<slug>.mjs` phrase — never titles, spec bullets, or bare paths.
7. **Close every tool ladder with a text turn** (the runner re-prompts until a non-tool turn) and set
   `repeatLastTurn` so nudges/redrives never strict-miss; per-card review tracks, `any`-class fallback per set.

## Reflection loop (§13d)

Capture: `run-record-proxy.mts` starts aimock in record mode (NOTE: aimock's `proxyOnly: true` means proxy
WITHOUT saving — capture needs it `false`, the default in our `createRecordProxy`). Point !Klein's provider
`baseUrl` at the proxy and work normally against the real model. Each interaction lands as a fixture file that
keeps `match { userMessage (last user text), model, turnIndex, hasToolResult }` + response (+ SSE timings) —
NOT the full request (only system/tools hashes survive).

Distill: `distill-capture.mts` → `distillCampaign` classifies each capture (request class from the recorded user
text; failure id conservatively from the response — `t-<status>`, `c-empty-completion`, `c-reasoning-only`,
`c-bad-json-args`, `c-trunc-length`, else `perfect-observed`) and emits tracks pinned to their recorded turn via
`atAssistantCount`. Merge the interesting ones into scenario sets, keyed by the failure catalog.

## Product bugs already found by this layer

- **Planning-freeze dispatch stall** (2026-07-10, simulated project-02): the deferred-retry trailing timer was
  silently swallowed by the terminal-retry sweep debounce → 11 dep-ready cards frozen with an idle fleet. Fixed
  (timer-fired sweeps bypass the debounce; swallowed sweeps re-arm the timer) — one confirmed mechanism behind
  the §12 "fleet under-utilization" observations.
