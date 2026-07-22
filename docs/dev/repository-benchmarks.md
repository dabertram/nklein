# Repository benchmark harness

!Klein evaluates repository work through a source-agnostic adapter with two distinct official graders. SWE-bench 4.1.0
is the pinned legacy compatibility grader; it has hard-coded repository specifications and cannot evaluate arbitrary
SWE-bench-Live repositories. Live tasks use Microsoft's native SWE-bench-Live evaluator instead. Neither grader is the
measurement strategy. The current benchmark policy is:

- Aider polyglot for daily paired A/B signal;
- Terminal-Bench for harness quality;
- LiveCodeBench as the model-capability control;
- SWE-bench-Live Lite as a fresh quarterly repository check;
- legacy SWE-bench Lite/Verified only for paired comparisons, never absolute claims.

SWE-bench Pro is excluded: the local fleet has no useful score gradient and its task corpus is unsuitable for
redistribution. Candidate claims use resolved-set deltas and reliability (`pass^k`), never headline `pass@k`.

## One-time setup

```sh
npm run benchmark:setup
```

This creates an ignored Python 3.12 environment from `benchmark-harness/uv.lock`, then verifies that SWE-bench 4.1.0
still exports `get_eval_report` and `MAP_REPO_TO_PARSER`. It also clones Microsoft's native Live harness at commit
`70ec57e852e3f2d195790fe71f553e272c691833`, initializes RepoLaunch at
`7735b1e7363dd3bbc69bd0ef80db646a2ae391fd`, and probes both revisions before use. Grading remains outside the agent
workspace. The checkout is setup output, ignored by Git, and may not silently substitute another origin or revision.

## Explicit dataset egress

Dataset acquisition never happens in normal runtime commands. Pin the Hugging Face commit SHA and retain only a bounded
slice:

```sh
npm run benchmark:fetch -- \
  --dataset SWE-bench-Live/SWE-bench-Live \
  --revision <40-character-dataset-commit> \
  --split lite \
  --fresh-after 2025-01-01 \
  --limit 40 \
  --output .nklein/benchmarks/live-lite.jsonl
```

The private JSONL contains gold/test material and is mode `0600`; its sidecar records the revision, selected ids and
SHA-256. Legacy datasets additionally require `--allow-legacy`.

Repository mirrors are also an explicit operator egress step. Store each bare mirror as
`<owner>__<repo>.git` in a local cache. Runtime materialization accepts only that cache; it never clones the network.

## Repeatable flow

1. `nklein dev benchmark prepare` selects ids/difficulty/freshness and writes a manifest that structurally cannot carry
   gold patches, hints, test patches, or oracle test ids.
2. `nklein dev benchmark workspace` checks out `base_commit` from the local mirror inside the pinned sandbox image with
   `--network none`, hard resource limits and no shell. It removes upstream `.git` and creates one sealed baseline
   commit. The private test patch is never mounted, applied, committed, or exposed there; only the external official
   grader receives it.
3. `nklein dev benchmark run` verifies that exact one-commit baseline, registers the workspace with the selected live
   runtime, and starts the normal !Klein plan/decompose/review path. Completed, stalled, review-held, and
   needs-attention outcomes are all captured honestly; only runtime/infrastructure loss is inconclusive. Benchmark
   prompts remain tainted, so the host-delivery gate may correctly keep sealed HEAD unchanged. In that case capture
   reads exactly one durable reviewed `refs/nklein/evidence/<task>-*` commit and pins it under a separate immutable
   benchmark ref—there is no security bypass or manual sandbox copy. It writes an exclusive run receipt before
   atomically updating official prediction JSONL. `--runtime-host`/`--runtime-port` select a dedicated server, and
   `--no-plan` is available for an explicit single-card ablation. The private acceptance oracle is never run in the
   agent workspace.
4. Run the source-appropriate official grader with `predictions=gold` at least twice. Legacy runs use
   `--dataset-name` and the explicit `--split` recorded by acquisition. Live runs use `--source swebench_live`, the
   pinned local `--dataset`, and the native Live harness; do not route them through SWE-bench 4.x. Persist the result
   with `benchmark calibrate --reports <r1>,<r2> --output <calibration.json>`. Any failure, error, missing repeat, or
   flip-flop is quarantined, and the calibration path is create-only evidence. Grader execution also requires a fresh
   report directory so an interrupted or reused run cannot inherit an old instance result.
5. `benchmark plan --execute` refuses candidate work without a calibration file covering every selected instance.
   Legacy Apple Silicon runs pass an empty image namespace to force local native builds. The official Live Linux images
   are x86_64-only: an ARM Docker daemon can emulate them for plumbing smoke tests, but the plan marks that result
   QEMU-tainted and it must not enter a regression baseline. Use a native x86_64 Docker runner for Live measurements.
6. `benchmark gate` compares status maps and fails only a calibrated resolved→unresolved transition. Missing or
   infrastructure-error results are `inconclusive`, never silently green or false regressions.

Use `nklein dev benchmark --help` for exact arguments. Full external runs remain expensive and egress-bearing; the
adapter, safety invariants, and report transforms are covered by the fast local test suite.

## Aider daily paired lane

Acquire `https://github.com/Aider-AI/polyglot-benchmark.git` explicitly and check out
`7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`. `benchmark prepare --source aider_polyglot --corpus <checkout>` refuses
another origin, revision, or dirty tree. Its public manifest contains instructions and solution paths only. Workspace
materialization copies only those solution files into a fresh one-commit repository; tests, examples, docs, and
metadata never enter agent-visible storage or history. `benchmark grade --source aider_polyglot` reconstructs the full
exercise in a separate networkless directory after capture, applies either the model patch or official example, and
writes a create-only `aider_polyglot_v1` report. Build the versioned C++/Java/JavaScript dependency images explicitly
with `npm run benchmark:aider-images`; Go uses a digest-pinned upstream toolchain, Rust uses a versioned image with a
locked offline crate cache, and Python uses the versioned agent sandbox. Every grading container is read-only,
networkless, capability-dropped, resource-bounded, and
uses preloaded dependencies. Candidate patches are filtered to declared solution paths before they enter the trusted
grader, so a model cannot replace a reconstructed private test.

Candidate execution itself requires the immutable gold calibration (passing a path is not advisory). Each Aider card
also carries a public `Acceptance check:` that runs `git diff --check` and verifies the declared solution files remain
non-empty. This gives the normal production reviewer a machine-runnable contract without exposing the private oracle;
passing it is never reported as semantic resolution. The external grader remains authoritative.

The first Python affine-cipher calibration resolved the official example twice. A controlled single-pair smoke using
Qwen3.6-35B-A3B plus the same fleet review policy produced `unresolved` in plan mode (operator-attention park, empty
artifact) and `resolved` in no-plan mode (reviewed 4.6 KB patch). This proves that the lane has non-zero discriminating
signal and that failures survive capture. It is one task, so it cannot justify changing defaults. The fixed stratified
grader tranche now resolves two independent gold repeats for 24 tasks—four each in C++, Go, Java, JavaScript, Python,
and Rust—with no quarantines. That calibrates the six offline toolchains and task set, not model quality; the repeated
paired model runs remain required before F11.3 closes.

Run the repeated tranche with the resumable paired campaign runner:

```sh
npm run benchmark:aider-campaign -- .nklein/benchmarks/aider-campaign.json
```

The JSON file contains the core pre-registration fields (`schemaVersion: 1`, a filesystem-safe `campaignId`,
`repeats >= 2`, `declaredMdePoints`, and one `{instanceId, modelId, modelNameOrPath}` assignment per task) plus
`manifestPath`, `corpusPath`, `calibrationPath`, `outputRoot`, the complete `residentModelIds` set, and optional runtime/
poll/deadline values. The current 24-task × two-repeat design can only detect about 29.5 percentage points, so its honest
pre-registered threshold is at least 30 points; claiming a smaller effect fails before the first candidate call.

Pairs run sequentially on the same forced model, while plan-first/no-plan-first order alternates across task and repeat.
The runner refuses a model below 32k context, an added/disappeared/resized resident, a changed campaign file, or an
interrupted workspace without a receipt. Completed receipts/reports resume without rerunning; final config, fleet
baseline, reports, receipts, and summary are immutable. Infrastructure-tainted pairs are excluded from the delegated
McNemar/default-flip gate and remain visibly inconclusive.

Before creating the first workspace it also requires a clean !Klein worktree and queries the selected runtime's
pre-initialization build identity. Runner and runtime must report the same clean full Git commit; an old, dirty, packaged,
or unverifiable runtime fails closed. The resulting `harness-baseline.json` pins both identities, and a resume under
different orchestration/runtime code or a different runtime process is refused. Completed campaigns emit immutable
`regression-plan.json` and `regression-no-plan.json` snapshots that collapse both repeats per instance: mixed outcomes
are quarantined and missing/error attempts remain infrastructure-inconclusive.

The checkout and runtime identity are re-verified at every attempt boundary, after candidate execution, after grading,
and before finalization. A mid-campaign edit, dirty file, commit switch, runtime restart, or replacement process stops
the root rather than letting later evidence silently mix with the pinned baseline.

Cleanliness is evaluated inside both the runner and the isolated runtime home. Per-machine checkout files must be
covered by the repository's `.gitignore`; relying on a developer-global excludes file makes the two provenance views
disagree and correctly blocks evidence generation.

Wire the selected production arm into the daily delta gate with:

```sh
npm run benchmark:aider-regression-gate -- \
  /absolute/baseline/regression-plan.json \
  /absolute/current/regression-plan.json \
  --output /absolute/evidence/aider-regression-gate.json
```

Only a stable resolved→stable unresolved transition exits non-zero. Missing, errored, or unstable current evidence is
reported as inconclusive rather than being mislabeled as a product regression.

Example after materialization:

```sh
nklein dev benchmark run \
  --dataset .nklein/benchmarks/live-lite.jsonl \
  --source swebench_live \
  --instance <instance-id> \
  --workspace-parent .nklein/benchmarks/workspaces/run-01 \
  --model nklein/fleet-profile-2026-07 \
  --run-id live-01-<instance-id> \
  --output .nklein/benchmarks/runs/live-01/predictions.jsonl \
  --receipt .nklein/benchmarks/runs/live-01/receipts/<instance-id>.json
```

The receipt contains the exact baseline/result commits, durable evidence ref, workflow outcome, card count, duration,
and delivered patch. It is create-only: rerunning requires a new run id and fresh materialized workspace rather than
silently replacing evidence.

## Terminal-Bench 2.1 preflight

Terminal-Bench uses Harbor's task container as the mutable work artifact; it is not a repository-patch dataset. Run the
non-pulling compatibility check before installing or fetching task images:

```sh
nklein dev benchmark terminal-preflight \
  --report-dir /absolute/evidence/terminal-bench-2-1 \
  --storage-path /existing/docker-backing-filesystem \
  --required-free-gb <operator-selected-pull-headroom> \
  --limit 5 --json
```

The check pins Harbor 0.5.0 and the official `terminal-bench/terminal-bench-2-1` dataset, reports Docker architecture,
measures the explicitly selected filesystem rather than guessing from the output directory, keeps reclaimable cache
separate from actually-free bytes, and prints the bounded official oracle command without executing it. Use selected
task-image manifest sizes when available, then apply the operator's risk tolerance; the adapter deliberately has no
universal image-size guess or hidden hard-coded floor.

The !Klein agent path is ready only when its tool executor can run inside Harbor's already-owned container, mutate that
container's root filesystem, exchange bounded artifacts, preserve state across turns, and leave verification with
Harbor. The ordinary `AgentSandboxManager` does not meet that contract: it owns a different container with a read-only
root and a writable repository mount. The preflight exposes those as blockers rather than returning a false green.
