# Running the full SWE-bench suite through !Klein

*P1.SWEBENCHFULL, 2026-09-15.* The N8 tranche (`docs/benchmarks/swebench-tranche-2026-09.md`) grades ten
hand-proven instances. This is the path to Lite (300), Verified (500) and the full test split (2,294): every step
that touches the network is an explicit operator command, everything after it is hermetic, and every receipt
names the environment it was graded in.

## The pipeline

| step | command | network | what it produces |
|---|---|---|---|
| 1. spec table | `tsx scripts/swebench-specs.mts fetch` | ⚠ once | `.nklein-bench/swebench/specs.json` — upstream `MAP_REPO_VERSION_TO_SPECS` (python, pre_install, packages, install, pip_packages, test_cmd per repo+version) with the package version and sha256 it came from |
| 2. index | `tsx scripts/swebench-fetch.mts index --all --datasets=lite,verified` | ⚠ once per dataset | `index.json` + `staging/<id>.json` (no gold patch, ever) |
| 3. mirrors | `tsx scripts/swebench-fetch.mts mirror --from-index` | ⚠ once per repo | one bare `git clone --mirror` per repo under `mirrors/` |
| 4. materialize | `tsx scripts/swebench-fetch.mts materialize <id…>` | none once mirrored | `repos/<id>.tar.gz` archived from the mirror, sha-pinned in `pins.json`, `instances/<id>.json` |
| 5. env images | `tsx scripts/swebench-grade.mts build-env <id…>` | ⚠ once per image | `nklein/swebench-base:<python>` (slim + C toolchain) or `nklein/swebench-env:<repo>__<version>` when the spec has pre-install shell |
| 6. wheel caches | `tsx scripts/swebench-grade.mts prepare <id…>` | ⚠ once per instance | `wheels/<id>/` — the repo's closure, the spec's packages/pins, the offline build toolchain |
| 7. control | `tsx scripts/swebench-grade.mts control <id>` | none | the UNFIXED workspace must grade unresolved — proves the env before any model runs |
| 8. run | `run.sh` / `scripts/swebench-tranche-run.mts --instances dataset:verified --parallel 4 …` | none (sandbox egress per the arm's allowlist) | receipts, `summary.*` |

`resolveSwebenchEnv` picks the environment for an instance: a hand-proven `SWEBENCH_TRANCHE` entry wins (its facts
were probed on the sealed grader), else the spec row for (repo, version), else a named refusal. The grader runs the
spec's `test_cmd` with the runner's own selection shape (pytest node ids; django dotted labels; sympy test files
from the test patch) and reads the runner's own output (pytest `-rA` PASSED lines; django `… ok`; sympy `test_x
ok`); a test missing from the output is a failure, never a pass.

## What is approximated, and how it is checked

- **conda specs by pip.** Upstream installs several repos (astropy, matplotlib, xarray, scikit-learn…) from a conda
  `environment.yml`; the grader reads that file into pip pins (`parseCondaEnvironmentYml`) and builds from source
  where no aarch64 wheel exists. The negative control (step 7) is the proof per instance — an env that cannot even
  run the unfixed tests is caught there, not in a model's score.
- **Internet-bound graded tests** are declared per instance (`sealedFailToPassExclusions`, with cause) and named on
  the receipt; an instance whose gradable set would empty stays "not resolvable" (finding 7 of the campaign doc).
- **Parallel runs** (`--parallel N`) need the arm HOME's `maxConcurrentTasks ≥ N` and a seat that answers
  concurrently (the Claude responders do; local LM Studio hosts serve one request at a time).
- **The agent's own toolchain** resolves from the same wheels the grader installs: `prepare` flattens every cached
  wheel into `wheels/_flat`, and an arm launcher that finds that directory exports `NKLEIN_AGENT_SANDBOX_WHEELHOUSE`
  — the runtime mounts it read-only at `/opt/nklein/wheelhouse` and points `UV_FIND_LINKS` / `PIP_FIND_LINKS` at it.
  Anything not in the wheelhouse still goes through the arm's egress allowlist (`ecosystem:python`).

## Scale and cost (measured on the tranche, 2026-09-15)

| seat | minutes per instance | cost per instance via the Claude CLI |
|---|---|---|
| Opus 5 | 9 | ~$4 |
| Fable 5.1 | 14 | ~$12 |
| Sonnet 5 | 20 | ~$5 |
| Haiku 4.5 | 15 | ~$1.2 |
| qwen3.8 27b on the m5max | 41 | local |
| qwen3.6-35b-a3b on the Legion, qwen3.8 IQ4_XS on the m4 mini | 33–42 | local |

Verified (500) on one Claude arm at `--parallel 4`: roughly 20–40 hours and Opus ≈ $2k, Fable ≈ $6k, Sonnet ≈ $2.5k,
Haiku ≈ $0.6k. A local seat at one instance at a time: ~14 days per 500. Enabling is not running — runs are an
explicit decision with those numbers in front of it.
