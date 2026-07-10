# LLM Simulator — Build-vs-Buy Verdict

Decision date: 2026-07-10. Inputs: `existing-solutions.md` (19-candidate research) + `failure-catalog.md`
(80-mode catalog) + a hands-on spike against `@copilotkit/aimock@1.35.1` (scratchpad spike, probes below).

## Verdict: HYBRID — adopt `@copilotkit/aimock` as transport, build the !Klein semantics layer on top

The simulator ships as a SEPARATE package (`packages/llm-simulator/`, zero !Klein imports — product-separation
per David 2026-07-10) composed of: aimock (OpenAI-compatible HTTP + SSE + fixtures + chaos + record/replay)
+ our scenario/profile/quirk layer + an LM Studio `/api/v0` shim.

## Spike results (all four unverified claims verified live)

| claim | result |
|---|---|
| `reasoning_content` on the OpenAI chat surface | ✅ `response.reasoning` emits EXACTLY the DeepSeek/LM Studio shape: non-stream `message.reasoning_content` AND streamed `delta.reasoning_content` chunks |
| indefinite stall | ✅ `streamingProfile.ttft: 3_600_000` → no first byte (probe aborted at 1.5s); per-fixture |
| `/v1/models` | ✅ 200 with a canned list (custom ids TBD — our LM Studio shim owns model listings anyway) |
| strict fixture-miss | ✅ deterministic `no_fixture_match` error body — tests can assert no un-scripted call slipped through |
| tool calls | ✅ proper `tool_calls`; QUIRK: `function.arguments` is an OBJECT (spec says JSON string) — our layer normalizes or exploits it as a c-args variant |
| mid-stream truncation | ✅ `chunkSize` + `truncateAfterChunks` closes the socket mid-stream — `t-sse-drop-no-done` for free |

API notes (from the spike): fixtures register via `mock.addFixtures([...])` (constructor `fixtures` option is NOT
a thing); match is `{ userMessage, systemMessage }` (string/RegExp/AND-array); text responses use `content` (not
`text`); per-fixture knobs: `latency`, `chunkSize`, `truncateAfterChunks`, `disconnectAfterMs`,
`streamingProfile {ttft, tps, jitter}`, `chaos`, `replaySpeed`, `recordedTimings`.

## What we build (the layer nobody sells)

1. **Scenario engine** (`packages/llm-simulator/src/scenario/`): stateful multi-turn TRACKS keyed by
   failure-catalog ids (t-*/c-*/a-*), compiled to aimock fixtures + per-request context headers. Request
   CLASSIFICATION (decompose / worker edit / review / chat / acceptance) via systemMessage matchers — !Klein's
   prompt shells make these reliably distinguishable.
2. **Model-family quirk profiles**: DeepSeek-R1 (reasoning_content, empty content), Qwen/QwQ (`<think>` inline,
   missing opening tag), weak-model tool-JSON quirks (stringified arrays, mixed quotes, truncated args) — emitted
   through fixture content + the arguments-object quirk.
3. **Seeded scenario driver**: seeded PRNG resolves per-request which track/chaos applies → 100% deterministic
   replays AND reproducible "variance runs" (same seed = same misbehavior sequence).
4. **LM Studio `/api/v0` shim**: model list with load states/quant/ctx, `stats` on chat responses, load/unload/TTL
   + admission-wait timing emulation (zero coverage in any existing tool; !Klein's fleet logic needs it).
5. **Reflection loop** (David, must-have): aimock RECORD mode captures real LM Studio/Ollama sessions → a distill
   step files them as tracks keyed by catalog ids → the mock library grows with everything real usage surfaces.

## Risk + exit

aimock is young (2026-04) and CopilotKit-controlled; MIT + zero-dep + our thin compile-to-fixtures adapter keeps
exit cost low (tracks are our JSON; a bespoke server could consume them later). Complementary tiers stay available:
llm-d-inference-sim for load-latency realism; llama.cpp+stories260K as the real-server smoke tier.
