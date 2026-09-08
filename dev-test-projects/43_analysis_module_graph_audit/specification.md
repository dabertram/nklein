# Module-Graph Audit — analysis brief

## The job

`input/` is the `src/` tree of a small internal ESM package, lifted verbatim during a dead-code review. It is
READ-ONLY evidence. Your job is to derive its import graph and record the structural defects it contains. You are
not asked to fix anything, and you must not edit anything under `input/`.

The package uses named ESM imports only — `import { name } from "./other.mjs";` — with no default exports, no
namespace imports and no re-exports. `index.mjs` is the package entry point.

## The deliverable

`analysis/structure.json`, which already exists in a valid empty form:

```json
{ "schemaVersion": 1, "complete": false, "findings": [] }
```

Every entry in `findings` carries a `kind`, a `why` of at least twelve characters explaining the consequence, and
the fields its class requires:

| `kind` | Required fields |
|---|---|
| `import_cycle` | `modules` — every participant of the cycle, as an array of file names. Order does not matter; membership does. List each participant once. |
| `unused_export` | `module` and `symbol` — the file that exports the name, and the name. |
| `unimported_module` | `module` — the file name. |

Set `"complete": true` only when you believe every defect of these three classes is recorded.

## The three defect classes

These are the only classes that count. A real problem outside them is out of scope for this audit — do not report
it, because an unrecognised finding fails the check.

- **`import_cycle`** — a set of modules that import one another in a closed loop, so none of them can be loaded,
  tested or extracted without the others. Report each *elementary* cycle once, by its full membership: a cycle
  visits each of its participants exactly once. Two cycles that share a module are still two findings.
- **`unused_export`** — a name a module exports that no other module in the package imports. Two exclusions, and
  they are not judgement calls:
  - the entry module's exports are the package's public API and are never unused;
  - a module that is itself unimported is reported as `unimported_module`, not export by export.
- **`unimported_module`** — a file that no module in the package imports. The entry module is imported by the host
  application rather than by the package, so it never counts.

## How your work is checked

`npm test` runs a verifier that rebuilds the import graph from `input/` on every run and enumerates the cycles,
the unconsumed exports and the unimported files itself. It is a checker, not an answer key: it names no module,
no symbol and no cycle.

1. **Every finding you record is checked immediately and strictly.** An unknown `kind`, a file that is not part of
   the package, a `symbol` the named module does not actually export, a repeated participant in a `modules` list,
   a duplicate finding, a thin `why`, or a claim the graph does not support all fail the suite.
2. **Coverage is required only when you set `"complete": true`.** At that point every defect the verifier derives
   must be present, and the failure message names what is missing.

So the suite stays green while you work, breaks the moment you record something untrue, and breaks again if you
declare completion early. Recording a cycle you have not traced end to end is strictly worse than leaving it out.

## How to plan this

Build the graph before you judge it: a card that reads every module and writes down its import edges pays for
itself three times over, because all three classes fall out of the same table. Decompose by class — cycles, then
unconsumed exports, then unimported files — and let each card end with real findings recorded and the suite green.
Reserve the last card for the completeness pass: re-derive the graph, confirm nothing of the three classes is
missing, then set `"complete": true`.

## Acceptance

`npm test`, offline, with the fixture's own toolchain. Never add a dependency.
