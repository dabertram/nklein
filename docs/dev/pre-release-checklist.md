# Pre-release checklist

The steps that must pass before a release, and — more usefully — **what each one does not prove.** A checklist
that only lists what to run teaches people to run it; one that states the limits teaches them to read the output.

## 1. Fast suite

```sh
npm run test:fast
```

Unit and runtime tests. **Does not typecheck** — `vitest` executes without `tsc`, so a green run is compatible
with type errors. That has caught people out repeatedly; run the typecheck separately.

## 2. Typecheck

```sh
npm run typecheck
```

Or run `sh .husky/pre-commit` to get biome, typecheck and the fast suite in the order CI applies them.

## 3. Nightly cells

```sh
npm run test:nightly:dry   # what would run, in order
npm run test:nightly       # the real drain, sequential, hours
```

Each cell drains a dev-test project through the simulator with a recorded aimock set.

**What it currently proves, stated honestly (2026-07-20):**

- the drain completes without erroring
- **zero unmatched aimock requests** — the recording covered what the run actually did (F11.4c)
- no orphan sessions, worktrees or leases survive teardown

**What it does NOT yet prove.** The runner subscribes to no board lanes and no gate/guard signals, so the
invariant packs report `indeterminate` for anything beyond the above. That is deliberate: `indeterminate` is
never a pass, and the output says how little is checked rather than implying more. Signals join a pack when the
collector can genuinely observe them — see N5b.

**A failing cell prints a report designed to be actionable without a re-run**, because a re-run is usually
impossible: the failure was intermittent and the state is gone. Undebuggable failures are listed *first and
separately* — a run with 12 failures where 3 cannot be investigated has two problems, and the second one costs a
morning every run.

**⚠️ The drain seed is fixed at 7 — but the run is NOT deterministic.** Measured 2026-07-20: two runs of the
identical cell produced `completed: 30` and `completed: 28`. So repeat runs are **neither independent samples nor
identical replays** — the worst of both. They cannot estimate variance (nothing is resampled deliberately) and
they cannot confirm a fix (the same input gives different output).

Until N7d explains what varies, **treat a single nightly verdict as weak evidence in both directions**: a pass may
not reproduce, and a failure may not either. Widening coverage still means adding *cells* rather than repeating
runs — see P20.6.

## 4. Web UI

```sh
npm --prefix web-ui run build && npm run web:test
```

The pre-commit hook covers backend `tsc` only. Web UI and desktop type errors slip past it, so check them here.

## 5. Wiring audits

```sh
npx tsx src/cli.ts dev requirement-coverage   # do requirements reach production?
npx tsx src/cli.ts dev unwired-cores          # shipped-but-never-wired
npx tsx src/cli.ts dev env-gated              # deliverables that may not RUN by default
npx tsx src/cli.ts dev mechanism-registry     # do shipped mechanisms actually fire?
npx tsx src/cli.ts dev tracking-coverage      # what does !Klein record about a card?
```

A **FAIL from `requirement-coverage` is compatible with a fully green test suite** — that is the point of
checking at that level. `built_but_unwired` means the fix is a wire, not a new core.

Note the known limits rather than reading a clean run as proof: orphan-ness is transitive but **a cycle of dead
modules keeps itself alive** (reference counting cannot detect cycles), and the element→provider map is
hand-maintained, so an unmapped element reports `no_provider_recorded` — absence of evidence, not evidence of
absence.

**The three added 2026-07-20 each answer a question the first two structurally cannot, and each states its own
blind spot in its output:**

- **`env-gated`** — `requirement-coverage` proves a module is *imported*; F4.8 proved that is the weaker claim. A
  complete import chain to the session runtime meant nothing because the injection site was behind a default-OFF
  flag, and every audit still read "satisfied." This finds deliverables whose consumers are all env-gated. It
  reports **suspicion, never a verdict** — it matches the `isTruthyEnv(process.env.X)` idiom and cannot prove a
  guard *wraps* a call, so a clean result means "nothing found," not "every path runs."
- **`mechanism-registry`** — distinguishes a mechanism that was *never enabled* (zero is correct) from one that
  was *enabled and silent* (the real smell). It cannot report on a mechanism nobody added to the registry —
  which is precisely how the goal re-anchor stayed invisible — so pair it with `env-gated`, whose registry-coverage
  line names the flags the registry has never heard of. `too_new_to_judge` means a mechanism's emission site
  postdates the telemetry; never read it as a pass.
- **`tracking-coverage`** — verifies every claimed card-lifecycle emitter against a real symbol in the source, so
  a renamed emitter turns the table red rather than letting it keep promising coverage. A `partial` entry names
  its own remaining gap; read those, don't just count the greens.

## 6. Release integrity

Signing and notarisation remain blocked on Apple/Windows credentials (F12.102). The manifest generator and
integrity round-trip work without them; **do not describe a build as signed until they are applied.**
