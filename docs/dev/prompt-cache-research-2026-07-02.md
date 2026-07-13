# Prompt-cache optimization for the !Klein swarm — deep research (2026-07-02)

> Maintained research reference, not a task list. Remaining local measurements and implementation are tracked only in
> `todo.md` H7.14 and H7.19–H7.32 (with the feature-level prompt layout in F4.37–F4.40).
>
> Adversarially-verified deep-research run (107 agents; every claim below survived 3-vote refutation; refuted claims listed at the end). Question: how does a local multi-agent swarm (LM Studio, llama.cpp + MLX backends, 3 machines) maximize throughput by making prefill cache-efficient — measured baseline ~8% byte-prefix reuse between same-model session starts.

## Summary
!Klein's ~8% byte-prefix reuse is fully explained by mechanics: every viable local backend reuses KV cache only for exact contiguous token prefixes — llama.cpp's default per-slot cache_prompt re-prefills everything past the first divergent token (chunked --cache-reuse is off by default), and MLX prompt caching is likewise strictly prefix-based — so divergent per-session-kind system prompts guarantee near-full re-prefill. The highest-leverage fix is therefore (e) byte-stable static prompt shells per model/session-kind with task content appended late, then (a) cache-affinity routing onto warm slots (llama.cpp ships -sps similarity routing across -np slots; LM Studio 0.4.0 serves 4 parallel slots with unified KV via continuous batching), then (d) session-kind batching, for which SGLang's longest-prefix-first scheduler and KVFlow's 1.83x–2.91x workflow-aware-eviction gains are direct precedent that interleaving agent kinds thrashes LRU caches. KV save/restore (f) exists natively on both backends — llama.cpp /slots save/restore (~43 ms documented restore) and LM Studio mlx-engine ≥1.8.5 disk checkpoints at 256-token boundaries — but is gated by surface access (LM Studio's API hides /slots) and model residency. Migrating to vLLM/SGLang for radix caching should be rejected (CUDA-centric, poor quantized-GGUF/Apple-Silicon fit); and because no quantified evidence of multi-project cache dilution survived adversarial verification, single-card fan-out vs card-level parallelism (c) must be settled by local measurement rather than literature.

## Verified findings
### [HIGH] llama.cpp server prompt caching is ON by default but strictly exact-contiguous-prefix, per slot: with cache_prompt=true (default) the incoming prompt is compared to the slot's previous completion and only the non-matching suffix is prefilled; chunked non-contiguous reuse via KV shifting (--cache-reuse N) is OFF by default (0). This is the direct mechanical explanation for !Klein's ~8% byte-prefix reuse — any early divergence in the system prompt forces effectively full re-prefill.

**Evidence:** README (verified live on master 2026-07-02): "if `cache_prompt` is `true`, the prompt is compared to the previous completion and only the 'unseen' suffix is evaluated... Default: `true`"; "--cache-reuse N | min chunk size to attempt reusing from the cache via KV shifting... (default: 0)" = disabled. Maintainer tutorial (discussion #13606) confirms the server logs `kv cache rm [N, end)` and discards everything past the first divergent token. Caveats: matching is token-level and per-slot; sliding-window-attention models (Gemma-family, gpt-oss — including !Klein's gpt-oss-120b throughput model) can defeat partial reuse without --swa-full; open issue #15082 reports regressions in the optional --cache-reuse path.
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://github.com/ggml-org/llama.cpp/discussions/13606
- verification vote: 3-0, 3-0 (2 claims merged)

### [HIGH] llama.cpp server has built-in cache-affinity routing across parallel slots — strategy (a) exists natively: -np/--parallel sets slot count (default -1 = auto) and -sps/--slot-prompt-similarity (default 0.10) routes each request to the idle slot whose cached prompt best matches it, so a swarm can keep several distinct warm prompt contexts alive per loaded model, one per slot.

**Evidence:** README verbatim: "-sps, --slot-prompt-similarity SIMILARITY | how much the prompt of a request must match the prompt of a slot in order to use that slot (default: 0.10, 0.0 = disabled)"; PR #7728 implemented longest-common-prefix slot selection explicitly to reduce prompt reprocessing in multi-user scenarios. Caveats confirmed by verifier: routing considers only IDLE slots (a busy best-match slot means cold prefill, issue #22942); context budget is shared/split across slots; the -np auto default is recent and version-dependent.
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://github.com/ggml-org/llama.cpp/pull/7728
- verification vote: 3-0

### [HIGH] Strategy (f) on the CUDA/GGUF path: llama.cpp per-slot KV cache can be persisted to and restored from disk — with --slot-save-path set, POST /slots/{id}?action=save|restore round-trips a slot's prompt cache as a file; the documented example restores a 1745-token / ~14.3 MB cache in ~43 ms, enabling warm-context save/restore between agent sessions.

**Evidence:** README documents --slot-save-path and both endpoints with example response `"n_restored": 1745, "n_read": 14309796, "timings": {"restore_ms": 42.937}`. Hard scope limits verified: does NOT work in llama.cpp multi-model router mode (issue #18703, open); blocked when a vision mmproj is loaded (#21133, #19466); restore requires identical model/context config; LM Studio's OpenAI-compatible API does NOT expose /slots — exploiting this for !Klein requires running llama-server directly.
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- verification vote: 3-0

### [HIGH] LM Studio 0.4.0 (released 2026-01-28) lets a single loaded model serve parallel requests via llama.cpp's continuous batching instead of queueing, defaulting to 4 parallel slots with 'unified KV' (preallocated KV memory not hard-partitioned per concurrent request, vendor-claimed zero extra memory overhead). This determines how many warm per-slot prefix contexts a swarm can keep alive per LM-Studio-served model and makes one warm model concurrently hittable.

**Evidence:** Blog verbatim: "Parallel requests work thanks to llama.cpp's open-source continuous batching implementation"; "By default, parallel slots are set to 4 (with unified KV set to true, which should result in no additional memory overhead)... preallocated resources will not be hard-partitioned per concurrent request." Requires the GGUF runtime llama.cpp engine v2.0.0; Max Concurrent Predictions is a per-model-load setting. Known reliability caveats: crash when the shared KV pool fills (bug #1628); some architectures silently disable KV reuse (#1563).
- https://lmstudio.ai/blog/0.4.0
- https://lmstudio.ai/docs/app/advanced/parallel-requests
- verification vote: 3-0, 3-0 (2 claims merged)

### [HIGH] On Apple Silicon, LM Studio's mlx-engine v1.8.5 (blog 2026-06-05) natively implements strategy (f): it checkpoints KV tensors to disk at 256-token boundaries and restores the longest exact cached prefix on follow-up requests, recomputing only edited/never-computed/evicted suffixes — built specifically because sliding-window/hybrid-attention models (Gemma 4 sliding-window, Qwen 3.5 hybrid) have KV caches that are not arbitrarily rewindable, so agentic rewind-and-append would otherwise force full re-prefill on those architectures.

**Evidence:** Blog verbatim: "By saving and restoring prompt cache to disk, the KV cache for follow-up requests does not need to be recomputed"; "Copying and storing these KV caches at 256-token boundaries lets us restore exact cached prefixes... If part of the prompt was edited, never computed, or evicted from the disk cache, mlx-engine falls back to recomputing that suffix"; "These attention strategies... make the KV cache not arbitrarily rewindable." Cross-checked against mlx-lm #980 (prefix reuse broken for hybrid architectures) and llama.cpp's parallel --swa-full solution. Scope: cache is model-lifetime (cleared on unload — no persistence across JIT swaps), LRU-evicted on disk, restore granularity 256 tokens; vendor throughput figures (2.2x) unverified.
- https://lmstudio.ai/blog/mlx-engine-agentic-workloads
- https://github.com/ml-explore/mlx-lm/issues/980
- verification vote: 2-1, 3-0, 3-0 (3 claims merged)

### [HIGH] mlx-lm's own prompt caching is strictly prefix-based and is a designed-for 'warm rail' mechanism: the Python API (make_prompt_cache, canonical chat.py example) is explicitly intended for multi-turn dialogues and requests sharing the same context; mlx_lm.cache_prompt can persist a prompt's KV cache to a .safetensors file that a later mlx_lm.generate loads to skip re-prefill; and a saved cache is treated purely as a prefix of the new prompt — reuse pays off only when new content token-follows the cached context, which is exactly the byte-stable-prefix requirement of strategy (e).

**Evidence:** README verbatim (verified 2026-07-02): "The cached prompt is treated as a prefix to the supplied prompt"; "Prompt caching... is useful in multi-turn dialogues or across requests that use the same context"; documented cache_prompt → generate --prompt-cache-file workflow. Source-code checks: generate.py performs NO divergence check on a loaded cache file (non-following prompts silently produce wrong-context output); server.py's LRUPromptCache does longest-common-prefix matching; no radix/non-contiguous sharing exists anywhere in mlx-lm. Scope: file-based cache loading is an mlx-lm CLI/library feature, not exposed through LM Studio's API; broken for hybrid-architecture models per #980.
- https://github.com/ml-explore/mlx-lm
- verification vote: 3-0, 3-0, 3-0 (3 claims merged)

### [HIGH] MLX concurrent serving had a correctness-breaking KV/prompt-cache cross-contamination bug: mlx_lm.server v0.31.0 (M3 Ultra, 16+ concurrent requests — independently reproduced with only 2) leaked responses between prompts due to a Python late-binding bug in per-request cache checkpointing that extracted the LAST request's cache for all inputs; maintainer-fixed in PR #976, merged 2026-03-10 and shipped in 0.31.1+. Version floor for any concurrent MLX swarm serving: mlx-lm > 0.31.0.

**Evidence:** Issue #965 verbatim: "responses from one prompt leak into another"; PR #976 ("Late binding caused incorrect cache checkpoint", merged 2026-03-10T20:53Z) body: "we would always extract the last cache for all inputs"; verifier downloaded the 0.31.1 wheel and confirmed the _lazy_extract_cache fix present. Positive architectural fact: the server does keep per-request prompt-cache checkpoints (LRUPromptCache + checkpoint deque). Residual related issues (#980 hybrid prefix cache, #1097 BatchKVCache RoPE offsets) mean 'fully healthy concurrent cache path' should not be inferred.
- https://github.com/ml-explore/mlx-lm/issues/965
- https://github.com/ml-explore/mlx-lm/pull/976
- verification vote: 3-0, 3-0 (2 claims merged)

### [HIGH] LM Studio MLX-backend sessions that overflow context lose ALL prompt-cache benefit: when a context-overflow policy triggers past max_kv_size, the attempted trim fails and mlx-engine erases the entire KV cache, forcing full re-prefill of thousands to tens of thousands of tokens. Root cause is structural — mlx_lm's default RotatingKVCache circular buffer cannot trim from the end once generated tokens exceed max_kv_size (is_trimmable() = offset < max_size) — and the issue (#177) remains open with fix PR #188 unmerged as of 2026-07-02. Operational rule for !Klein: keep MLX sessions below max_kv_size or route long-running sessions to GGUF/llama.cpp.

**Evidence:** Issue #177 (authored by an LM Studio team member) verbatim: "_get_unprocessed_tokens attempts to trim the cache... fails because the cache rejects the trim request... falls back to erasing the entire cache, which requires usually thousands to tens of thousands of tokens to be unnecessarily recomputed at great expense." Verifier confirmed in current mlx_lm source that RotatingKVCache structurally cannot end-trim once wrapped, that issue #177 is still open (fix PR #188 open/unmerged, last activity 2026-06-30), and that users in-thread abandoned MLX for GGUF/ollama over this. The v1.8.5 disk-checkpoint feature does not claim to fix this overflow-trim path.
- https://github.com/lmstudio-ai/mlx-engine/issues/177
- https://github.com/lmstudio-ai/mlx-engine/pull/188
- verification vote: 3-0, 3-0 (2 claims merged)

### [HIGH] Interleaving session kinds (worker/reviewer/critic) on one model is a documented multi-agent anti-pattern: standard LRU KV eviction is workflow-unaware — under cache pressure it evicts an agent's prefix precisely because that agent hasn't run recently, right before the workflow loops back to it. KVFlow (NeurIPS 2025, built on SGLang v0.4.4) quantifies the cost of cache-oblivious scheduling: workflow-aware eviction + overlapped prefetch yields up to 1.83x over SGLang-with-HiCache and 2.91x over GPU-only SGLang on a 10-agent sequential workflow with 8192 fixed prompt tokens (Llama-3.1-8B, A10G). This is the strongest literature support for strategies (d) session-kind batching and (b) context rails.

**Evidence:** KVFlow verbatim: "the LRU policy identifies the Expresser's KV cache as the eviction candidate since it has not been accessed recently. This results in a cache miss when the workflow proceeds to the Expresser agent, despite its imminent reuse"; "under 8192/32/32 on A10G, KVFlow outperforms SGLang w/ HiCache by 1.83x, and the GPU-only SGLang baseline by 2.91x." Corroborated by vLLM's LRU-evictor RFC #23641 and an edge multi-agent paper measuring 15.7 s full re-prefill per evicted agent at 4K context. Transfer caveats: CUDA radix-cache stack, best-case 32-token outputs (gains shrink to ~1.28x at 4096 fixed tokens as decode dominates), and 'guaranteed miss' holds under memory pressure — the operative regime for few-slot llama.cpp with many session kinds.
- https://arxiv.org/html/2507.07400v1
- https://arxiv.org/abs/2603.04428
- verification vote: 3-0, 3-0 (2 claims merged)

### [HIGH] A production-proven mechanism for automatic cross-session multi-prefix reuse exists — but only on CUDA-class serving stacks: SGLang's RadixAttention retains KV caches of finished requests in a token-keyed radix tree with LRU leaf eviction, so any later request sharing a token prefix reuses the cached prefill automatically (unlike llama.cpp's per-slot single-prefix cache), and it pairs this with a cache-aware longest-shared-prefix-first scheduler that REORDERS requests to raise hit rate — the direct design precedent for !Klein's strategy (d), with a proof (Theorem 3.1) that longest-shared-prefix-first order is hit-rate optimal.

**Evidence:** Blog/paper verbatim: "our system retains the cache for prompts and generation results in a radix tree... LRU eviction policy that evicts the least recently used leaf first"; paper: "if the request scheduler frequently switches between different, unrelated requests, it can lead to cache thrashing and a low hit rate"; --schedule-policy lpm is still the 2026 default. Reuse requires token-exact prefixes (one changed upstream character invalidates downstream cache), so prompt-shell stabilization remains a prerequisite even there. SGLang/vLLM target CUDA/ROCm with limited quantized-GGUF/Apple-Silicon support — a design to borrow (scheduling, batching), not a stack to adopt for !Klein's fleet.
- https://www.lmsys.org/blog/2024-01-17-sglang/
- https://arxiv.org/pdf/2312.07104
- verification vote: 3-0, 3-0, 3-0 (3 claims merged)

### [MEDIUM] RANKED RECOMMENDATION for !Klein (synthesis across all verified findings): (1) FIRST implement strategy (e) — byte-stable static prompt shells per model+session-kind with all card/task-specific content appended as a late suffix; every verified mechanism on both backends is exact-token-prefix-only, so this is the prerequisite that converts the 8% baseline into high reuse and it multiplies every other option. (2) Strategy (a) cache-affinity routing — pin consecutive turns of a session (and same-shell session kinds) to the same endpoint; on raw llama-server exploit -np slots + -sps similarity routing; via LM Studio rely on 0.4.0's 4 unified-KV slots and orchestrator-side stickiness. (3) Strategy (d) session-kind batching — run all reviews/critics back-to-back per model instead of interleaving (SGLang LPM + KVFlow evidence); near-zero implementation cost in the kanban scheduler. (4) Strategy (b) context rails — reserve a loaded model per card/stream lifecycle across !Klein's 2-6 loaded models; natural once (a)+(d) exist, guards against cross-stream thrash. (5) Strategy (f) opportunistically — free on MLX with LM Studio mlx-engine >=1.8.5 while the model stays resident; on llama.cpp requires bypassing LM Studio to run llama-server with --slot-save-path. (6) Strategy (c) single-card fan-out vs card parallelism — plausible but unquantified by surviving evidence; run as a measured experiment. REJECT: adopting vLLM/SGLang for radix caching (CUDA-centric, poor GGUF/MLX/Apple-Silicon fit) and relying on --cache-reuse chunked reuse as a primary lever (off by default, open regressions, SWA-model hazards). VALIDATE with: byte-prefix-reuse % between consecutive same-model starts (existing metric), server-side prefill token counts (llama.cpp `kv cache rm` offsets / n_past, LM Studio prefill stats), TTFT per session kind, and end-to-end cards/hour.

**Evidence:** Derived ranking: each component strategy is grounded in the unanimous primary-source findings above (prefix-only reuse mechanics; -sps/-np slot affinity; LPM scheduling precedent; KVFlow LRU-thrash quantification; native save/restore on both backends), but the ORDERING and the fan-out judgment are inference — no source benchmarks these strategies against each other on !Klein's exact stack, and the two claims that would have quantified multi-project dilution and the serving-stack ceiling (HiCache 0.57x; SGLang 5x-vs-vLLM) were refuted 0-3 in verification.
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://lmstudio.ai/blog/mlx-engine-agentic-workloads
- https://lmstudio.ai/blog/0.4.0
- https://github.com/ml-explore/mlx-lm
- https://arxiv.org/html/2507.07400v1
- https://arxiv.org/pdf/2312.07104
- verification vote: synthesis (not independently voted)

## Open questions (need LOCAL measurement)
- Does the current LM Studio MLX engine support parallel requests / continuous batching (the 'llama.cpp-engine-only' restriction was refuted 0-3, but no positive evidence of MLX concurrency in LM Studio was verified), and does its unified-KV slot model apply there?
- What is the measured break-even between parallel cold sessions and serial warm sessions on !Klein's actual fleet (M-series prefill is compute-bound while decode is bandwidth-bound; no verified formula survived) — and how severe is multi-project cache dilution in practice, given the quantified HiCache degradation claim failed verification?
- Does LM Studio's llama.cpp engine internally use slot-prompt-similarity routing and per-conversation cache keying across its 4 default slots, or does the orchestrator need endpoint-level stickiness to avoid busy-slot cold prefills?
- How much reuse do !Klein's specific models retain in practice given SWA/hybrid attention (gpt-oss-120b on llama.cpp without --swa-full; Qwen 3.5/3.6 and Gemma on mlx-engine 1.8.5's 256-token disk checkpoints) — i.e., a per-model prefix-cache hit-rate sweep is needed before finalizing model-to-role assignments?

## Refuted during verification (do NOT cite these)
- Parallel-request/continuous-batching support in LM Studio 0.4.0 exists only for the llama.cpp engine; the MLX engine (the Apple Silicon-native backend) does not yet support concurrent requests, so MLX-served models on M-series machines serialize swarm sessions.
- llama.cpp-style chunked cache reuse for the MLX backend exists only as LM Studio PR #188 ('Cache reuse and cache fixes'), which as of 2026-07-02 is still open and unmerged (merged_at: null) — so shipped LM Studio MLX today has neither the overflow-trim fix nor cache reuse, a version-dependent fact critical for !Klein's backend choice on Apple Silicon.
- Running many concurrent independent workflows on one GPU causes severe cache thrash: LRU-based hierarchical caching (HiCache) degrades to 0.57x of the no-CPU-cache baseline at 64 concurrent workflows with 1024-token fixed prompts — direct quantified evidence that multi-project/multi-card parallelism on one endpoint can make caching net-NEGATIVE, supporting !Klein's expectation of severe cache dilution.
- On cache-shareable multi-call workloads, SGLang achieved up to 5x higher throughput than vLLM v0.2.5 and Guidance v0.1.8, quantifying the ceiling of what prefix-cache-aware serving can win for agentic workloads.

## Sources
- https://github.com/ggml-org/llama.cpp/discussions/13606
- https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- https://github.com/ggml-org/llama.cpp/discussions/20574
- https://github.com/ggml-org/llama.cpp/discussions/20572
- https://jessequinn.info/blog/llama-cpp-cache-ram-prompt-caching
- https://github.com/ggml-org/llama.cpp/discussions/8860
- https://lmstudio.ai/blog/mlx-engine-agentic-workloads
- https://lmstudio.ai/blog/0.4.0
- https://github.com/ml-explore/mlx-lm/issues/980
- https://github.com/ml-explore/mlx-lm/issues/965
- https://github.com/lmstudio-ai/mlx-engine/issues/177
- https://github.com/ml-explore/mlx-lm
- https://arxiv.org/html/2507.07400v1
- https://www.lmsys.org/blog/2024-01-17-sglang/
- https://arxiv.org/pdf/2312.07104
- https://arxiv.org/pdf/2605.26289
- https://arxiv.org/html/2601.19139v1
- https://github.com/ggml-org/llama.cpp/discussions/22354
- https://github.com/ggml-org/llama.cpp/issues/22942
- https://medium.com/@michael.hannecke/tuning-llama-server-on-apple-silicon-9b3e778ab100
- https://dev.to/marcuswwchen/prefix-caching-in-vllm-under-multi-tenant-agent-traffic-5e2j
- https://github.com/ggml-org/llama.cpp/discussions/4167
- https://yage.ai/share/mlx-apple-silicon-en-20260331.html
- https://arxiv.org/html/2603.04428v1
- https://github.com/ggml-org/llama.cpp/discussions/4130
