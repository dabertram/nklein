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
writes a create-only `aider_polyglot_v1` report.

The first Python affine-cipher calibration resolved the official example twice. A controlled single-pair smoke using
Qwen3.6-35B-A3B plus the same fleet review policy produced `unresolved` in plan mode (operator-attention park, empty
artifact) and `resolved` in no-plan mode (reviewed 4.6 KB patch). This proves that the lane has non-zero discriminating
signal and that failures survive capture. It is one task, so it cannot justify changing defaults. The current trusted
grader image is configured for Python; C++, Go, Java, JavaScript, and Rust toolchain images plus the 20–40-task repeated
tranche remain required before F11.3 closes.

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
