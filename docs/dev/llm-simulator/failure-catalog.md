# LLM Failure-Mode Catalog (simulator test scenarios)

Researched 2026-07-10 (web agent; every mode carries a real-world citation — see Sources). This is the scenario
inventory for the §13 LLM simulator: every `id` becomes a simulator track + an expected-harness-behavior assertion.

Cross-cutting findings that shape the simulator design:
- Production LLM calls fail 1–5%; a 10–20-call agent task almost always hits ≥1 failure → scenarios need BOTH
  per-call probability AND deterministic "fail call #N" scheduling.
- The two most frequent real-world agent failures are content/loop-level, not transport (MAST: step repetition
  17.1%, reasoning-action mismatch 14.0%) → the scripted-conversation layer matters more than the HTTP-error layer.
- Several modes only manifest as SEQUENCES (history poisoning, schema-bounce storms, oscillation) → the mock must
  support stateful multi-turn scripts, not just per-request overrides.
- Local-stack specifics are disproportionately relevant to !Klein: LM Studio model-unload/crash exit codes, Ollama
  silent num_ctx truncation + `reasoning` field quirk, llama.cpp tool-call-in-content regressions, vLLM prefix-cache
  staleness.

## Transport / API-level (t-*)

| id | mode | expected harness behavior |
|---|---|---|
| t-conn-refused | TCP refused/unreachable (APIConnectionError) | bounded retry w/ backoff+jitter; mark endpoint down after N |
| t-conn-reset | reset mid-request, response indeterminate | retry idempotently; cap retries |
| t-tls-error | TLS/cert failure | fail fast, non-retryable; surface as config error |
| t-timeout-connect | connect timeout | short deadline, retry |
| t-timeout-read | accepted, zero bytes until deadline (408/504) | retry w/ backoff; prefer streaming for long generations |
| t-timeout-idle-drop | idle conn silently dropped on long non-streaming | use streaming/keep-alive; retryable |
| t-400-validation | invalid_request_error | never retry unchanged; if caused by own history → repair history (a-history-poison) |
| t-401-auth / t-402-billing / t-403-permission / t-404-model | auth/billing/permission/unknown-model | non-retryable; surface specifically (404 → suggest model-list check/fallback) |
| t-413-too-large | request too large (CDN-level) | compact/truncate context, then retry |
| t-422-unprocessable | semantically invalid | treat like 400 |
| t-429-rate | transient rate limit (+retry-after) | honor retry-after, else backoff+jitter; failed calls still count |
| t-429-quota | quota exhausted — retry futile | distinguish by message/type; stop retrying, surface |
| t-429-miswrapped | gateway maps 429→connection error | classify on status code, not exception class |
| t-500 | provider internal error | retry ≤2 then fallback |
| t-502-html | 502/520 with HTML body | never JSON-parse blindly; content-type check; retryable 5xx |
| t-503-overload | overloaded / "Slow Down" | longer waits (5–30s); reduce concurrency, ramp gradually |
| t-504-timeout | generation exceeded window | switch to streaming; reduce max_tokens; retry |
| t-529-overloaded | Anthropic-style overload distinct from 429 | retryable, provider-side classification |
| t-empty-body-200 | 200 with empty body | validate non-empty; retry once; then error |
| t-wrong-content-type | 200 with text/html | defensive parse; log raw head |
| t-malformed-json-200 | 200 invalid JSON (non-stream) | retry once; never crash agent loop |
| t-sse-never-starts | stream accepted, no bytes ever | first-byte (TTFT) deadline separate from total; abort+retry |
| t-sse-stall-mid | events stop, conn open, no terminator | inter-chunk idle timeout (30–60s); abort, retry/resume |
| t-sse-drop-no-done | closes without [DONE]/finish chunk | treat accumulated text as PARTIAL, not final |
| t-sse-malformed-chunk | concatenated/truncated SSE chunks | robust incremental parser; clean abort + one retry |
| t-sse-error-event-mid | in-band error event after HTTP 200 | handle error events mid-stream; map to same taxonomy |
| t-sse-usage-trailing | usage in trailing empty-choices chunk after finish_reason | read until [DONE], not until finish_reason |
| t-sse-whole-not-delta | chunk carries full response, not delta | detect prefix-duplication; dedupe |
| t-sse-infinite | stream never terminates | hard cap tokens/bytes/duration; abort |
| t-slow-ttft | very slow first token (cold load/queue) | TTFT budget; distinguish "loading" from "dead" |
| t-slow-tokens | seconds/token crawl | token-rate watchdog; warn → abort+reroute |
| t-server-crash-mid | LM Studio-style crash mid-request (exit 1844…) | retryable but counted per host; quarantine after N |
| t-crash-on-ctx | crash instead of truncation when ctx exceeded | pre-flight token count; classify crash as ctx overflow → compact+retry |
| t-model-unload | "Model unloaded" between calls (JIT eviction) | detect message; trigger reload/admission wait, not generic retry |

## Content-level (c-*)

| id | mode | expected harness behavior |
|---|---|---|
| c-empty-completion | 200, content empty/null, no tools | check reasoning channel too; retry once w/ nudge; never persist empty assistant turn |
| c-reasoning-only | content empty, answer in reasoning_content/reasoning (R1/Gemma-style) | always read reasoning channel before declaring empty; extract or re-prompt |
| c-think-tags-inline | `<think>…</think>` in content; opening tag may be MISSING (Qwen) | strip/route think blocks incl. bare `</think>`; never reaches parsers/users |
| c-trunc-length | finish_reason=length truncation | always check finish_reason; continue-generation or raise cap; never apply half an edit |
| c-trunc-silent | truncated but finish_reason=stop | heuristics: unbalanced fences/braces, output≈limit → treat as truncated |
| c-cut-mid-json | cut mid-JSON/mid-code-fence | validate finish_reason before trusting tool_calls; parse-check; continuation/retry |
| c-trunc-tool-json | tool args truncated by token limit | DISTINCT feedback ("output truncated") — not a generic invalid-call bounce (doom loop) |
| c-repeat-token-loop | degenerate token/phrase repetition | n-gram repetition detector ON STREAM; abort early; retry w/ different sampling |
| c-repeat-tool-loop | identical tool call repeated within a response | dedupe within response; cross-turn → a-same-tool |
| c-runaway | runaway to max_tokens (EOS misconfig) | per-role max_tokens caps; exactly-at-cap output is suspect |
| c-off-format | markdown/prose when JSON asked | lenient extraction (strip fences) BEFORE bouncing; prefer constrained decoding |
| c-stringified-json | args as `"[{...}]"` string (weak-model classic — already recovered in decompose) | detect string-parses-as-expected-type; unwrap one level |
| c-bad-json-args | malformed tool JSON (ctrl chars, mixed quotes) | never crash: repair attempt, else schema-error tool result w/ parse text |
| c-args-empty | `{}` args from SSE fragmentation | validate required params before executing; missing-field bounce |
| c-args-missing-extra | missing/extra/wrong-typed fields | schema-validate; coerce trivial; one corrective bounce then fail step |
| c-hallucinated-tool | calls nonexistent tool (invented from prompt words) | reject w/ tool-list reminder as tool result; repeated → loop signal |
| c-tool-in-content | tool call as TEXT in content channel | fallback content-scan for tool-shaped JSON/XML; execute or channel-correct |
| c-fabricated-observation | fakes Thought→Action→Observation without executing | detect observations the harness never produced; reject turn |
| c-refusal | refusal (incl. structured-outputs `refusal` field) | check refusal field/patterns; surface distinctly; don't schema-parse |
| c-prompt-echo | echoes prompt/instructions (template mismatch) | similarity check vs prompt head; flag template misconfig |
| c-template-tokens-leak | raw `<|im_end|>`-style tokens in output | strip known special tokens; template misconfig signal |
| c-stop-ignored | stop sequences not respected | client-side stop enforcement on accumulated stream |
| c-wrong-language | answers in wrong language (DeepSeek CJK classic) | language detect on prose; retry w/ reminder; tolerate stray chars in code |
| c-unicode-garbage | mojibake/gibberish (broken quant) | entropy/printability heuristic; abort; quarantine model after repeats |
| c-identical-responses | same response to materially different requests (prefix-cache staleness) | duplicate detection; cache-busting retry |
| c-ctx-overflow-error | explicit context-overflow 400 | classify by message pattern too; compact + retry; enables fallback |
| c-ctx-silent-trunc | input silently truncated (Ollama num_ctx) | pre-count tokens; compare prompt_eval_count; set num_ctx explicitly |
| c-empty-finish-weird | empty content + unusual finish reason (MALFORMED_FUNCTION_CALL) | unknown finish + empty = retryable model failure w/ feedback, not crash |

## Agent-loop level (a-*)

| id | mode | expected harness behavior |
|---|---|---|
| a-same-question | re-asks the same clarifying question forever | fingerprint repeated near-identical questions; answer once → force-proceed or halt |
| a-oscillate | A/B/A/B between two answers/edits (OpenHands threshold: 6 cycles) | detect alternating normalized actions; break w/ state summary + directive |
| a-same-tool | same tool+args repeated (MAST #1 mode, 17.1%) | hash (tool,args); k repeats → cached result + "already done" feedback → halt |
| a-never-calls-tool | text-only turns forever on a tool-requiring task | after N tool-less turns inject tool directive; then fail over model |
| a-ignores-results | next action inconsistent with last observation | consistency check (e.g. re-reading unchanged file); short-circuit repeats |
| a-out-of-space | "solution outside allowed space" loop (the live *.js vs *.ts case) | detect repeated policy-rejected proposals; restate constraint once w/ rationale → hard-fail/reroute |
| a-partial-compliance | retries ALL edits when only some failed | per-edit status feedback ("3 applied, 1 failed: reason"); request only the remainder |
| a-schema-bounce-storm | same malformed output regenerated every bounce (5–11 retries seen) | cap validation retries (2–3), VARY the corrective prompt, then degrade |
| a-history-poison | malformed turn persisted → permanent 400s afterwards | sanitize/repair before persisting; on repeated 400s bisect history |
| a-zero-progress | valid but zero-progress turns (monologue) | progress metric (files/tests/diff); stall budget then intervene |
| a-goal-drift | drifts from objective over long horizons | periodic spec re-injection; verify against ORIGINAL goal |
| a-flip-flop | flips answer under naked challenge (46% flip rate) | verify with evidence (tests/lints), never opinion pressure |
| a-premature-stop | ends before objectives met | completion checklist gate; bounce with unmet criteria |
| a-no-termination | keeps working after success | harness-side done-detection forces stop |
| a-retry-amplification | multi-layer retries multiply (3^5=243 calls) | retry at ONE layer; jittered backoff; circuit breaker per model/host |
| a-conversation-reset | restarts dialogue from scratch mid-task | detect re-greeting/plan-from-scratch; restore condensed state |
| a-condensation-loop | compaction loses "already done" → redo loop | preserve action ledger verbatim across compaction |
| a-detector-false-positive | loop detector kills legitimate polling/waits | whitelist wait patterns; stuck-state must be recoverable, not terminal |

## Taxonomies & prior art (for citations + assertions)

- **MAST** (NeurIPS 2025, arxiv.org/abs/2503.13657): 14 modes / 3 categories — Specification 41.8%, Inter-agent
  misalignment 36.9%, Task verification 21.3%. Top modes: step repetition FM-1.3 (17.1%), reasoning-action mismatch
  FM-2.6 (14.0%).
- **TRAIL** (arxiv.org/abs/2505.08638): 841 span-level errors — Reasoning / System-Execution / Planning branches.
- **LiteLLM exception mapping** (docs.litellm.ai/docs/exception_mapping): the de-facto status→exception taxonomy.
- **OpenHands StuckDetector** (docs.openhands.dev/sdk/guides/agent-stuck-detector): 5 loop patterns w/ thresholds
  (identical×4, action-error×3, monologue×3, alternating×6, repeated ctx-errors) — reference for §12 loop detection.
- **agent-chaos** (github.com/deepankarm/agent-chaos): chaos injectors targeting specific tools/turns/call counts.
- **FlipFlop** (arxiv.org/html/2311.08596): 46% flip rate under challenge.
- **Repetition in production** (arxiv.org/pdf/2512.04419).
- Official error docs: developers.openai.com/api/docs/guides/error-codes · platform.claude.com/docs/en/api/errors
  (incl. 529, mid-stream SSE error events) · api-docs.deepseek.com (reasoning_content) · Qwen quickstart (think
  tags, missing opening tag) · Ollama num_ctx silent-truncation experiment (jangwook.net).

(The research agent transcript holds per-row GitHub-issue citations for every mode; ids here are stable.)
