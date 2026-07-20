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
```

A **FAIL from `requirement-coverage` is compatible with a fully green test suite** — that is the point of
checking at that level. `built_but_unwired` means the fix is a wire, not a new core.

Note the known limits rather than reading a clean run as proof: orphan-ness is transitive but **a cycle of dead
modules keeps itself alive** (reference counting cannot detect cycles), and the element→provider map is
hand-maintained, so an unmapped element reports `no_provider_recorded` — absence of evidence, not evidence of
absence.

## 6. Release integrity

Signing and notarisation remain blocked on Apple/Windows credentials (F12.102). The manifest generator and
integrity round-trip work without them; **do not describe a build as signed until they are applied.**
