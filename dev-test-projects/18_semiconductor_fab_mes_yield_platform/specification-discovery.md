# Semiconductor Fab MES — Route Algebra (DISCOVERY variant)

> **This is the P23.6 discovery variant of `specification.md`, and it is deliberately incomplete.**
> The prescriptive specification hands the agent a file map, per-module interfaces and numbered implementation
> steps — a valid test of faithful execution, retrieval and dependency extraction, but *not* of architecture
> discovery. This variant carries the vision, the invariants, the threats and the acceptance criteria, and
> nothing else. **How the system is structured is the work.**
>
> Both variants are graded by the **same held-out oracle**, and the delta between them is the measurement.
> Do not copy structure from the prescriptive spec: the point is what you choose when nobody tells you.

## Vision

A Manufacturing Execution System tracks silicon wafers through a fab. Wafers travel in **lots**, and a lot is
not a fixed thing: it is **split** when part of it takes a different path, **merged** when parts rejoin, and
**reworked** when wafers must revisit an earlier operation. Every one of these is routine and they compose
freely — a lot may be split, one child merged with a sibling, that result split again, and a subset reworked.

The system's job is to make that algebra trustworthy. Yield engineers later ask questions like *"this wafer went
through etch twice, the second time on a different chamber — did that cost us die?"*, and the answer only exists
if the genealogy was never corrupted along the way.

## Invariants (the thing being graded)

These hold across **any sequence** of operations, not merely one at a time. That distinction is the whole
specification: an implementation where each operation is correct in isolation but the composition loses a wafer
does not satisfy this document.

1. **Wafer conservation.** No wafer is ever lost or duplicated. The union of a parent's children's wafer sets
   equals the parent's wafer set, and this survives arbitrarily long chains of split/merge/rework.
2. **Route coherence.** Wafers that were together on a route stay on that route through a split, so that lots
   which were once one lot can legally be merged again. A merge of lots on different routes is invalid.
3. **History is append-only.** Rework appends a loop to a wafer's path; it never erases or replaces prior
   history. After a rework, every wafer is still where it was, with more history rather than different history.
4. **No silent failure.** An impossible operation raises a descriptive error. It never returns a partial result,
   and never quietly succeeds having dropped something — a silent no-op is how conservation dies three steps
   later, far from the code that broke it.
5. **Inputs are not mutated.** Operations return new values. A caller that still holds a lot from before the
   operation sees exactly what it saw before.

## Threats

- **Feature isolation.** The most likely failure is not a wrong algorithm but three correct algorithms that do
  not share a world: each passes its own test, and the composition has no coherent behaviour. Design for the
  chain, not the operation.
- **Validation asymmetry.** Rejecting the obvious bad input (a wafer assigned twice) while accepting the subtle
  one (a wafer assigned to no child at all) loses wafers silently.
- **Overlap blindness.** Once lots have parents, two "different" lots can share wafers. Any operation that
  unions wafers must consider that its inputs may not be disjoint.

## The one thing that is pinned

Architecture, file layout, module boundaries, internal types and helper design are all yours. **The public
surface is not.** Export exactly these three operations from **`src/index.ts`**:

```ts
export function splitLot(parent, waferAssignments, newLotIds, clock)
//   waferAssignments: Record<waferId, childLotId>; returns { childLots, event }

export function mergeLots(parents, mergedLotId, clock)
//   returns { mergedLot, event }

export function recordRework(lotId, waferIds, targetOperationId, reason, clock)
//   returns { startEvent }
```

A **lot** carries at least `{ id, waferIds, routeId, currentOperationId, status }`. A **clock** is any object
with `now(): number`. Events carry a `kind` (`'lot-split'`, `'lot-merge'`, `'lot-rework-started'`) and the
operation's own payload; the `occurredAt` timestamp comes from the clock, never from the wall clock.

This surface is pinned for one reason only: an independent test must have something to call. Everything behind
it is a design decision, and the design decisions are what this variant measures.

## Acceptance

`npm test` green, with your own tests covering the invariants above. Note that the graded criterion is the
invariants themselves under composition — a suite that only exercises one operation at a time can be entirely
green against an implementation that fails this specification.
