# Repository benchmark harness

!Klein evaluates repository work through a source-agnostic adapter. SWE-bench 4.1.0 is the pinned compatibility grader,
not the measurement strategy. The current benchmark policy is:

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
still exports `get_eval_report` and `MAP_REPO_TO_PARSER`. Grading remains outside the agent workspace.

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
   `--network none`, hard resource limits and no shell. It removes upstream `.git`, creates one sealed baseline commit,
   applies the private test patch, commits it, and destroys the temporary oracle mount.
3. Run !Klein on the manifest prompt and workspace. `nklein dev benchmark prediction` atomically adapts the delivered
   diff to official prediction JSONL.
4. Run the official grader with `predictions=gold` at least twice. `benchmark calibrate --reports <r1>,<r2>` quarantines
   any failure, error, missing repeat or flip-flop.
5. `benchmark plan --execute` refuses candidate work without a calibration file covering every selected instance. On
   Apple Silicon it passes an empty image namespace, forcing local native builds; Docker/host architecture mismatch is
   marked QEMU-tainted and must not enter a regression baseline.
6. `benchmark gate` compares status maps and fails only a calibrated resolved→unresolved transition. Missing or
   infrastructure-error results are `inconclusive`, never silently green or false regressions.

Use `nklein dev benchmark --help` for exact arguments. Full external runs remain expensive and egress-bearing; the
adapter, safety invariants, and report transforms are covered by the fast local test suite.
