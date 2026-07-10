# Scenario set: 01_clinical_medication_safety_platform

Design-time mock-LLM scripts (Claude-authored flawless baseline, 2026-07-10) conforming to `packages/llm-simulator/src/scenario/track-types.ts`. To be hardened later with real local-model telemetry via the record→distill loop.

**perfect-run.json** (seed 101, chaos 0) — 85 tracks: 1 decompose emitting a 41-card graph (s00–s40: the spec's S01–S22 slice split per-rule plus breadth recipes — class breadth, audit projections, LASA, FHIR-shaped import, knowledge-debt ledger, README), 41 worker tracks (one per card, 2–4 turns: `read_files`/`list_files` → `write_files`/`editor`/`apply_patch` with real compact TypeScript → optional `run_commands ["npm test"]` → text summary), 41 review tracks (37 approve; 4 request_changes-then-approve on s03/s15/s20/s28 with critiques mirroring the spec's pitfalls), 2 chat tracks.

**flaky-run.json** (seed 102, chaos 0) — 13 tracks: decompose reduced to the 10 reused cards (deps trimmed to the subset so every decomposed card has a scripted worker), 7 failure tracks + 3 perfect control workers, catch-all approve reviewer, 1 chat. Failure modes (each track's `provenance` cites the catalog id from `docs/dev/llm-simulator/failure-catalog.md`):

- `c-stringified-json` (s03) — `write_files.files` arrives as a JSON string that parses to the array
- `c-trunc-tool-json` (s05) — `files` is a truncated, unparseable JSON string; corrected write follows
- `c-reasoning-only` (s08) — empty content, plan in `reasoning`; recovery next turn
- `a-same-question` (s12) — one clarifying question looped via `repeatLastTurn`
- `t-429-rate` (s15) — 429 + `retryAfterSeconds: 15`, then the normal flow
- `t-sse-stall-mid` (s20) — 90 s stall, then recovery
- `c-empty-completion` (s22) — `empty_completion`, then recovery

Tool shapes were confirmed from source: `decompose_project` args per `src/nklein-agent/decomposition/plan-task-schemas.ts` (deps are inline `dependsOn` task-id arrays — no separate edge channel); `read_files {paths}`, `write_files {files:[{path,content}]}`, `editor {path, edits:[{search,replace}]}`, `apply_patch {input}`, `run_commands {commands}` per the kanban tool registrations; review verdicts as `submit_review {verdict: approve|request_changes, summary, feedback}` tool calls (how !Klein actually parses reviews — not prose).

**Assumptions to verify when the compiler/driver lands:** (1) the driver prefers the most specific `userMessageIncludes` match within a request class — worker/review tracks key on exact card titles (unique strings; the review seed prompt embeds the title); (2) `t-sse-stall-mid` is approximated with the `stall` behavior (TTFT-style dead stream) because the behavior union has no mid-stream-stall knob yet; (3) `c-trunc-tool-json` is expressed as a truncated string argument value, since `tool_calls.arguments` is parsed JSON by construction.

Validated with a structural checker (JSON.parse + field asserts incl. behavior-union fields, unique ids, dep resolution, per-card worker/review coverage, complexity ≤ 75, filesLikelyTouched ≤ 3, failure-track shapes).
