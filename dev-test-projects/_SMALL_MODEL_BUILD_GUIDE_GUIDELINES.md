# Small-model (3B) build-guide guidelines — make each spec mechanically buildable

You are enhancing dev-test-project specs so a **tiny local model (~3B params) connected to !Klein** can do the ENTIRE pipeline with minimal reasoning: **decompose the project → produce the dependency-linked task graph → implement each resulting task**, and pass acceptance. The spec + your additions must do the heavy thinking; the 3B should **follow**, not figure out. Assume the reader is literal-minded and cannot infer unstated knowledge.

For each assigned project, **APPEND** a section titled **`## Small-model build guide (3B-ready)`** to its `specification.md`, containing these parts:

### 1. Glossary & ground rules
Define every domain term the spec uses. State the **stack explicitly** (language, runtime, test runner, key libraries) and the **acceptance command** in plain steps. Restate the determinism rules in imperative form ("never call the network in a test; use the fixture adapter in `<path>`").

### 2. The explicit task graph for the FIRST vertical slice
Take the spec's "first vertical slice" and spell it out as a **concrete, dependency-ordered list of SMALL cards** (each ≈ one focused step a weak model can finish + verify in isolation). For EACH card give exactly:
- **id** (e.g. `S01`), **title** (one line), **dependsOn** (prior card ids, or none),
- **files** it creates/edits (exact paths),
- **interface** — write out the real types / function signatures / zod schemas it must produce,
- **how to implement** — a numbered, plain-imperative recipe,
- **acceptance** — the exact test(s)/assertion(s) that prove it done (name the test file + what it checks).

> **Concrete example of the required card shape (imitate this density):**
> **`S03` — Pure score clamp.** dependsOn: `S01` (types), `S02` (test harness). files: `src/score.ts`, `test/score.test.ts`.
> interface: `export function clampScore(raw: number): number // returns a value in [0,100]`.
> how to implement: 1) create `src/score.ts`; 2) `return Math.max(0, Math.min(100, raw))`; 3) export it; 4) add `test/score.test.ts`.
> acceptance: `test/score.test.ts` asserts `clampScore(150) === 100`, `clampScore(-5) === 0`, `clampScore(42) === 42`; run `npm test` → green. No I/O, no randomness (pure → deterministic).

Produce enough cards to cover the whole first slice this way.

### 3. The decomposition method for the rest
Give an **explicit, repeatable recipe** the 3B (via !Klein's `decompose_project`) can apply to expand the remaining breadth into the same shape of small, dependency-ordered, individually-testable cards — with the project's invariants (from its v2 section) as the recurring acceptance backbone. Include **2–3 worked examples** of turning one larger feature into a small card cluster.

### 4. Per-task implementation conventions
File/folder layout, naming, how to write a test in this stack (a tiny worked snippet), how to keep it deterministic, how to wire/seed a fixture adapter, and a crisp **"definition of done"** for any card.

### 5. Common pitfalls for a weak model on THIS project
The specific mistakes a 3B will make here (e.g. floating-point nondeterminism, forgetting a dependsOn edge, mocking the wrong seam) and exactly how to avoid each.

## Rules (read carefully)
- **Be explicit and mechanical.** Prefer concrete interface/code/test snippets over prose. Every card must be independently implementable by a literal 3B.
- **Build on the existing spec.** Stay consistent with the project's base + its `v2` section (and, for #36, `v3`/`v4`). Reference those sections; don't contradict them.
- **Deterministic + offline.** The acceptance command must never need a live LLM, network, payments, or wall-clock randomness — fixtures only.
- **APPEND only**, to your assigned `specification.md` files. **Edit ONLY the files assigned to you.**
- **Do NOT run git, npm, tests, dev-test, scaffold, or any build** — JUST edit the markdown. Do NOT touch other projects, the repo's code, `project.json`, `user-prompt.txt`, this guidelines file, or `_ENHANCEMENT_GUIDELINES.md`. (The parent reviews and commits.)
- Your batch's folders are disjoint from every other agent's — there is no merge collision.

**The bar:** a competent reviewer should believe that a 3B model, handed this spec, could actually decompose it, build the first slice card-by-card, and pass acceptance — without needing to be clever.

When done, report per project: how many first-slice cards you specified, the 2–3 hardest pitfalls you addressed, and confirm you only appended to your assigned specs and ran no git/tests.
