# 12 - GitLab-Class Code Hosting and CI Platform Foundation

Complexity tier: 12/20
Expected decomposition size: 34-38 dependent implementation cards before coding.
Domain pressure: Git hosting, merge requests, CI pipelines, runners, permissions, code review, release governance, auditability.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build the foundation for a serious self-hosted code collaboration platform. It should model repositories, merge requests, review policy, CI pipelines, runner scheduling, artifacts, environments, and audit controls well enough to become a product like a small GitLab if expanded.

## Foundation release scope
The first serious buildout must include:
- Organization, user, group, project, repository, branch, commit metadata, merge request, review, approval rule, pipeline, job, runner, artifact, environment, and audit event models.
- Repository abstraction that can ingest deterministic commit graphs and branch refs from fixtures without implementing the full Git protocol immediately.
- Merge request workflow with draft state, discussion threads, approvals, required reviewers, branch protection, conflict status, and merge train queue.
- CI pipeline compiler for a constrained YAML-like fixture format with stages, jobs, needs, variables, artifacts, cache keys, environments, and manual gates.
- Runner scheduler that matches jobs to tags, capacity, isolation level, secrets policy, and concurrency limits.
- Permission model for organization owners, maintainers, developers, reporters, guests, external users, protected branches, and deploy environments.
- Release evidence bundle linking commits, approvals, pipeline results, artifacts, deployments, and audit events.
- Seed project with failing pipeline, protected branch, security approval, flaky job retry, and merge train conflict.

## Architecture requirements
- Separate source-control metadata, collaboration workflow, CI graph evaluation, runner scheduling, secrets policy, and audit logging.
- Use typed permission checks with reasoned denial outputs and golden tests.
- Represent pipeline graphs explicitly; do not treat jobs as a flat list.
- Make merge decisions reproducible from refs, approvals, policy, and pipeline status.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- A code platform is a policy engine as much as a repository browser.
- CI pipelines are DAGs with artifacts, environments, manual gates, and cancellation semantics.
- Branch protection and review rules must compose without privilege leaks.
- Runner scheduling must avoid exposing secrets to untrusted jobs.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Permission tests cover protected branches, fork-like external contributors, deploy environments, and audit-only access.
- Pipeline compiler tests cover needs DAG, manual gate, artifact dependency, variable scope, and invalid cycles.
- Merge request policy produces deterministic allowed/blocked reasons.
- Runner scheduler respects tags, capacity, secrets, and concurrency.
- The project passes npm test without shelling out to git.

## Explicit non-goals
- Do not build only a repository listing UI.
- Do not execute untrusted CI jobs in the foundation.
- Do not reduce permissions to a single admin boolean.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is that a code platform is two interlocking deterministic engines — a *content-addressed Merkle DAG* (the repository) and a *typed policy/pipeline DAG* (CI + review governance) — and the load-bearing requirement is that *every merge decision and every CI result is reproducible from refs + commit graph + approvals + policy + job inputs alone*, with **no secret ever reaching an untrusted job** and **no privilege ever leaking across a fork or protected-branch boundary**.** A platform that gets the DAGs right but leaks a secret, or whose merge gate is non-reproducible, has failed at the only things that make it a *platform* rather than a file browser.

A serious code platform is "a policy engine as much as a repository browser" (the spec's own framing). The repository side is Git's genius — a **content-addressed Merkle DAG** where every object (blob, tree, commit) is named by the hash of its content, so identity *is* integrity ([git-scm — Git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects); [GitHub Blog — Git's packed object store](https://github.blog/open-source/git/gits-database-internals-i-packed-object-store/)). The CI/governance side is a **typed DAG evaluator** with capability-scoped execution. This extension makes both rigorous and reproducible behind fixtures, with zero shelling out to `git` (the explicit non-goal).

## C0. The grading rubric (what actually makes this hard)

1. **DAG correctness, twice** — is the repository a real content-addressed Merkle DAG (objects identified by content hash, refs as named DAG roots, reachability enforced), *and* is the CI pipeline a real DAG (`needs`-based, with cycle rejection, artifact lineage, manual gates), not a flat job list?
2. **Reproducible merge gate** — given the same refs, approvals, branch-protection policy, and pipeline status, does the merge decision (allowed/blocked + *reason*) come out identical every time?
3. **No privilege/secret leak** — can you *prove* an untrusted (fork-like) job never receives a protected/masked secret, never runs on a protected runner, and never escalates permissions across a boundary?
4. **Three-way merge fidelity** — does conflict detection use a real merge base and produce correct conflict/clean outcomes deterministically?
5. **Release evidence integrity** — does a release bundle link commit → approvals → pipeline → artifacts → deployment → audit such that it is a verifiable provenance chain?

## C1. The content-addressed object store (the repository done honestly)

Do **not** model a repo as "a list of files." Model Git's actual object graph, ingested from fixtures.

- **Four object types, content-addressed.** `blob` (file content), `tree` (directory: name→mode→object-id entries), `commit` (root tree + parent(s) + author/committer + message), `tag`. Each object's ID is the hash of its serialized content (SHA-1 in classic Git, SHA-256 in the newer object format); a one-byte change yields a different ID ([git-scm — Git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects); [Ken Muse — how Git stores data](https://www.kenmuse.com/blog/understanding-how-git-stores-data/)). Commits are **snapshots, not diffs** — each references a full root tree.
- **Refs are named DAG roots.** Branches and tags are mutable names → commit IDs; the commit graph is an immutable DAG of parent edges ([Wasil Zafar — the object model & DAG](https://www.wasilzafar.com/pages/series/software-engineering/software-engineering-part10-git-internals.html)).
- **Packfiles + delta chains (model the concept, not byte-for-byte zlib).** Loose objects vs packed; **offset deltas** (base by relative position) and **ref deltas** (base by object-id); delta chains bounded by depth; a `.idx` with a 256-entry **fanout table** for binary-search lookup; a multi-pack-index for many packs ([GitHub Blog — packed object store](https://github.blog/open-source/git/gits-database-internals-i-packed-object-store/); [git-scm — Packfiles](https://git-scm.com/book/en/v2/Git-Internals-Packfiles)). The teaching value: an object can be *materialized only by applying its delta chain*, and **connectivity/reachability** (every object reachable from a ref) is the integrity invariant that `git fsck`/`gc` rely on.
- **Determinism win:** because objects are content-addressed and immutable, the entire repository is a pure function of its object set + refs; two ingests of the same fixture graph produce byte-identical object IDs.

## C2. Three-way merge & conflict detection (the seam agents fake)

Merge is not "concatenate diffs." It is a real **three-way merge against a merge base**.

- **Merge base selection.** The base is the most-recent common ancestor of the two branch heads. With multiple common ancestors (criss-cross history), the modern **ort** strategy *recursively merges the ancestors into a synthetic base* and 3-way-merges against that ([git-scm — merge-strategies](https://git-scm.com/docs/merge-strategies); ort is default since Git 2.50). Model this; it is the difference between correct and naïve.
- **Conflict semantics.** A hunk conflicts when both sides changed the same region relative to the base; non-conflicting changes from both sides are *both* taken. A change made then reverted on one side still appears in the result (merge sees only base + two heads, not intermediate commits) — a real, testable subtlety ([git-scm — merge-strategies, revert note](https://git-scm.com/docs/merge-strategies)). Conflicts are represented by the standard `<<<<<<< / ======= / >>>>>>>` markers.
- **Fast-forward vs merge commit.** If the target has no commits the source lacks, fast-forward (move the ref); otherwise create a merge commit with ≥2 parents. Strategies to model: `ort/recursive` (default), `resolve`, `octopus` (>2 heads), `ours` (discard other side), plus `-Xours/-Xtheirs` resolution options (distinct from the `ours` *strategy*) ([git-scm — merge-strategies](https://git-scm.com/docs/merge-strategies); [Baeldung — Git merge strategies](https://www.baeldung.com/ops/git-merge-strategies)). Rename detection (similarity threshold) is part of ort.
- **`conflict status` on a merge request becomes a derived, reproducible computation** over (source head, target head, merge base), not a stored boolean.

## C3. The CI pipeline DAG compiler (real `needs` semantics)

The pipeline is a DAG, full stop — "do not treat jobs as a flat list" (the spec's architecture rule).

- **Stages provide a default linear order; `needs` overrides it into a DAG.** Jobs in a stage run in parallel; `needs` lets a job start the moment *its* dependencies finish, crossing stage boundaries ([GitLab Docs — needs](https://docs.gitlab.com/ci/yaml/needs/); [oneuptime — DAG in GitLab CI](https://oneuptime.com/blog/post/2025-12-21-dag-gitlab-ci/view)). The compiler builds the graph, **topologically sorts it, and rejects cycles** (the explicit acceptance criterion "invalid cycles").
- **Artifact lineage is constrained by `needs`.** A job may only consume artifacts from jobs in its `needs` set — model artifacts as typed outputs with producer/consumer edges, so a job that reads an artifact it doesn't depend on is a compile error ([GitLab Docs — needs/artifacts](https://docs.gitlab.com/ci/yaml/needs/)).
- **`rules`/`workflow:rules`** decide if/when a job (and the whole pipeline) runs; a `workflow:rules` `when: never` suppresses jobs that individual `rules` would otherwise allow ([GitLab Docs — CI/CD YAML](https://docs.gitlab.com/ci/yaml/); [MDN — conditional CI/CD](https://developer.mozilla.org/en-US/blog/optimizing-devsecops-workflows-with-gitlab-conditional-ci-cd-pipelines/)). **Variable scope** (global vs job vs masked/protected) and **manual gates** (`when: manual`, environment approvals) are first-class graph properties.
- **Cancellation/cascade semantics:** cancelling/ failing a node must propagate to dependents per policy; `allow_failure` lets a node fail without blocking. The compiler output is a fully-evaluated, deterministic execution plan.

## C4. The runner scheduler + secrets isolation (the safety spine)

This is where "no privilege leak" lives. Runner scheduling is a constraint-satisfaction problem with security as a hard constraint.

- **Tag matching + capacity + concurrency.** A job runs only on a runner whose tag set ⊇ the job's required tags; a stuck job means no tag-matching runner or all are saturated ([GitLab Docs — configure runners](https://docs.gitlab.com/ci/runners/configure_runners/); [GitLab Docs — executors](https://docs.gitlab.com/runner/executors/)). Concurrency caps how many jobs a runner runs at once.
- **Protected = secret-bearing.** A **protected** CI/CD variable is available *only* to pipelines on protected branches/tags; a **masked** variable is redacted from logs ([GitLab Docs — CI/CD variables](https://docs.gitlab.com/ci/variables/)). The scheduler must enforce: an untrusted/fork-like job **never** receives a protected variable and **never** lands on a protected/privileged runner. This is the literal "runner scheduling must avoid exposing secrets to untrusted jobs" requirement, made a typed gate.
- **Isolation level as a scheduling input.** Jobs declare a required isolation level (e.g. untrusted-sandbox vs trusted); runners advertise one; the matcher refuses to place an untrusted job on a trusted-only runner. The foundation does **not execute** untrusted jobs (explicit non-goal) — it *schedules and proves the policy*, with execution behind a deterministic fixture executor.

## C5. The permission/policy engine (compose without privilege leaks)

"Branch protection and review rules must compose without privilege leaks" (the spec). This is the hardest correctness surface after the DAGs.

- **Role lattice:** organization owner > maintainer > developer > reporter > guest > external/fork contributor, each with typed capabilities. Permission checks return **reasoned denials** ("blocked: developer cannot push to protected branch `main`; requires maintainer + 2 approvals"), with golden tests ([GitLab Docs — protected branches](https://docs.gitlab.com/user/project/repository/branches/protected/)).
- **Protected branches + CODEOWNERS + approval rules compose.** A protected branch can require maintainer-merge, forbid force-push, and require **Code Owner approval per matched path rule**; when a CODEOWNERS rule matches, direct pushes are denied and the matched owner must approve ([GitLab Docs — Code Owners](https://docs.gitlab.com/user/project/codeowners/); [GitLab Docs — approval rules](https://docs.gitlab.com/user/project/merge_requests/approvals/rules/)). **Self-approval and stale-approval (approval reset on new commits)** are explicit rules.
- **Security approval policies** add gates based on pipeline scan results: rules apply until the pipeline completes, preventing merge before scans run; a bot records the gate ([GitLab Docs — MR approval policies](https://docs.gitlab.com/user/application_security/policies/merge_request_approval_policies/)). Model as composable policy, not nested ifs.
- **Fork boundary is the canonical privilege-leak test:** an external contributor's MR from a fork must not gain write to protected branches, must not access protected secrets in CI, and must not approve their own MR.

## C6. The merge train / merge queue (concurrency correctness)

The merge gate under concurrency is genuinely hard and a great determinism test.

- **The queue semantics.** A merge train queues MRs; each MR's pipeline runs against *its changes combined with all earlier-queued MRs + the target branch*, so the train proves they all work *together*; pipelines run in parallel (default cap 20) ([GitLab Docs — Merge trains](https://docs.gitlab.com/ci/pipelines/merge_trains/); [GitLab 12.1 — parallel merge trains](https://about.gitlab.com/releases/2019/07/22/gitlab-12-1-released/)).
- **Drop-on-unmergeable.** If an MR becomes unmergeable mid-train (a conflict introduced by an earlier merge), it is **dropped from the train automatically** and the trains behind it re-evaluate ([GitLab Docs — Merge trains, drop behavior](https://docs.gitlab.com/ci/pipelines/merge_trains/)). Fast-forward / semi-linear methods are supported.
- **The seed scenario "merge train conflict"** becomes: queue A, B, C; A merges; B now conflicts and is dropped with a reason; C re-bases onto the new target and proceeds — all deterministic, all audited.

## C7. Release evidence & supply-chain provenance (the auditability spine)

The "release evidence bundle" should be grounded in real supply-chain standards.

- **A release bundle is a provenance chain:** commit (content-addressed ID) → approvals (who, when, which rule) → pipeline result (which jobs, which runners) → artifacts (with content digests) → deployment (which environment) → audit events — a verifiable linkage, not a PDF.
- **Ground it in SLSA / in-toto.** Build provenance describes *where, when, and how* an artifact was produced, expressed as a **signed in-toto attestation** (statement type + subject + predicate); SLSA defines the required fields (builder identity, source repo + commit digest, materials/inputs with digests, metadata) ([Kusari — SLSA](https://www.kusari.dev/learning-center/slsa-supply-chain-levels-for-software-artifacts); [Secure Pipelines — SLSA to in-toto](https://secure-pipelines.com/ci-cd-security/artifact-provenance-attestations-slsa-in-toto/); [Legit Security — SLSA provenance deep dive](https://www.legitsecurity.com/blog/slsa-provenance-blog-series-part-2-deeper-dive-into-slsa-provenance)). Signing/verification is modeled (Sigstore/cosign-style) behind a deterministic fixture signer — never a live network call.

## C8. The deterministic test strategy

- **Fixture commit graphs, not real Git.** Repositories are ingested as declarative object/ref fixtures (`npm test` never shells out to `git` — explicit non-goal). The object store, merge, and pack-model are pure functions over these fixtures.
- **Virtual clock + seeded scheduler.** Runner scheduling, train ordering, pipeline "completion," and retry/backoff read an injected clock and a seeded PRNG so a flaky-retry scenario replays identically.
- **Golden artifacts everywhere:** golden permission-denial reasons, golden compiled pipeline plans, golden merge results (clean/conflict), golden release bundles. The spec's "merge decisions reproducible from refs, approvals, policy, and pipeline status" becomes a literal golden-master test.

## C9. Adversarial & edge-case fixture pack (ship the hard cases)

- **The fork privilege-escalation MR.** An external contributor opens an MR that (a) targets a protected branch, (b) edits the CI config to echo a protected secret, (c) self-approves. All three are refused with reasons; the secret never enters the job; the attempt is audited.
- **The CI cycle.** A pipeline whose `needs` graph contains a cycle (A needs B needs A) is rejected at compile time.
- **The artifact-without-needs.** A job reads an artifact from a job not in its `needs` — compile error.
- **The masked-secret-in-logs.** A job tries to print a masked variable; it is redacted in the captured log fixture.
- **The merge-train poison.** MR B introduces a conflict that only manifests after A merges; B is dropped (not merged-broken), C survives.
- **The stale-approval bypass.** An MR is approved, then a new commit is pushed; the prior approval is invalidated and the merge is blocked until re-approval.
- **The CODEOWNERS gap.** A path with no owner vs a path with a required owner who hasn't approved — distinct, reasoned outcomes.
- **The reverted-change-survives merge.** The git subtlety from C2 — a change reverted on one branch still lands in the three-way merge — asserted as a known, correct behavior.

## C10. Property-based / invariant tests (the true acceptance bar)

1. **Content-addressing integrity** — re-serializing any object yields its ID; mutating one byte changes the ID; identical fixture graphs ingest to identical object sets (determinism).
2. **Reachability** — every object in a valid repo is reachable from some ref; an object unreachable from all refs is flagged (fsck-style), never silently trusted.
3. **DAG acyclicity** — the CI pipeline graph and the commit-parent graph are always acyclic; cycles are rejected.
4. **Merge-base correctness** — `merge(a, b)` uses the true LCA; `merge(a, ancestor-of-a)` fast-forwards; merge is commutative in outcome where Git guarantees it.
5. **Secret non-exposure** — over any randomized job/runner/variable assignment, no untrusted job ever co-occurs with a protected/masked variable or a protected runner. (Fuzz it — this is the safety ratchet.)
6. **Permission monotonicity** — a lower role never gains a capability of a higher role through any composition of branch/approval/CODEOWNERS rules.
7. **Merge-gate reproducibility** — same (refs, approvals, policy, pipeline status) ⇒ identical allow/block + identical reason, every run.
8. **Audit totality** — every merge, push-to-protected, approval, runner assignment, and deployment has an audit event; every audit event maps to a real action.

## C11. The concrete first vertical slice (the on-ramp — build THIS first, ~34–38 cards)

1. **The content-addressed object store** (C1): blob/tree/commit/tag, content-hash IDs, refs, reachability, fixture ingest. Invariants #1, #2.
2. **Three-way merge** (C2): merge-base selection, clean/conflict detection, fast-forward vs merge commit, the reverted-change-survives test. Invariant #4.
3. **The MR workflow + permission engine** (C5): roles, protected branches, CODEOWNERS, approval rules with reasoned denials, stale-approval reset. Invariants #6, #7.
4. **The CI DAG compiler** (C3): stages + `needs`, topological sort, cycle rejection, artifact lineage, manual gates, `rules`. Invariant #3.
5. **The runner scheduler + secrets isolation** (C4): tag/capacity/concurrency matching, protected/masked variable gating, untrusted-job refusal. Invariant #5.
6. **One merge train** (C6): queue, combined-pipeline, drop-on-conflict, with the poison fixture.
7. **One release evidence bundle** (C7) linking commit→approvals→pipeline→artifacts→deploy→audit, SLSA/in-toto-shaped. Invariant #8.

If that slice holds, additional review features, environments, and the UI are breadth on two proven DAG engines with an enforced security boundary.

## C12. Domain knowledge-debt to track

- **Exact Git pack/delta byte format and SHA-256 transition** — the foundation models the *concept* (content-addressing, delta chains, fanout index, reachability); byte-exact packfile compatibility and the SHA-1→SHA-256 object-format migration are flagged debt, not faked ([GitHub Blog — packed object store](https://github.blog/open-source/git/gits-database-internals-i-packed-object-store/)).
- **Full merge-strategy parity (ort rename/copy detection, submodule fast-forward rules)** — model the common cases; exotic ort behaviors are debt ([git-scm — merge-strategies](https://git-scm.com/docs/merge-strategies)).
- **Real runner execution & sandbox escape surface** — the foundation refuses to run untrusted jobs and proves the *policy*; production sandboxing (container/VM isolation, escape hardening) is debt.
- **SLSA level targeted + key management** — which SLSA build level the platform claims, and how signing keys are custodied, are expert-review items ([Kusari — SLSA](https://www.kusari.dev/learning-center/slsa-supply-chain-levels-for-software-artifacts)).
- **Security-scanner semantics for approval policies** — what counts as a blocking vulnerability is a rule pack, not hard truth.

## C13. Why this is a great !Klein challenge

It forces an agent swarm to hold **two different DAG disciplines in its head at once** — a content-addressed immutable Merkle DAG and a typed, policy-gated execution DAG — and to keep a **hard security boundary** (no secret/privilege leak across forks and protected branches) reproducible under concurrency (merge trains). The invariants are crisp and machine-checkable (content-addressing integrity, acyclicity, secret-non-exposure fuzzing, merge-gate reproducibility), so a small local model cannot bluff: a faked merge base or a leaked secret fails a property test immediately. It decomposes cleanly in strict dependency order (object store → merge → permissions → CI DAG → runner/secrets → merge train → release bundle), and the payoff — a self-hostable GitLab-class core whose every merge and release is provable from first facts — is exactly the kind of governed, legible, determinism-first system !Klein exists to prove buildable with weak models.

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms**
- **Object** — a Git content-addressed artifact. Four types: `blob` (file bytes), `tree` (directory listing), `commit` (snapshot + parents + message), `tag`. An object's ID is the SHA-256 hash of its serialized content; identical content always produces the same ID.
- **Content-addressed** — the ID *is* the content hash. A one-byte change changes the ID. Two ingests of the same fixture produce byte-identical object IDs. This is the repository's core invariant.
- **Ref** — a mutable named pointer to a commit ID. Branches and tags are refs. The commit graph is immutable; only refs move.
- **Merge base** — the most-recent common ancestor (LCA) of two commit histories. Required to compute a three-way merge. A naïve "latest common commit" is wrong for criss-cross histories.
- **Three-way merge** — merge result = apply non-conflicting changes from both sides relative to the merge base. A hunk conflicts only when *both* sides changed it vs the base.
- **Fast-forward** — if target has no commits that source lacks, just move the target ref to the source head. No merge commit created.
- **Pipeline** — a DAG of jobs defined by stages (default order) and `needs` edges (override order). Evaluated by topological sort; cycles are rejected.
- **Artifact** — a typed output produced by a job, consumable only by jobs that `needs` the producer.
- **Protected variable** — available only to pipelines on protected branches. **Masked** variable — value is redacted from logs. Both are never sent to untrusted (fork-like) jobs.
- **Runner** — an agent that executes jobs. Has a tag set, capacity, concurrency limit, and isolation level. A job is scheduled to a runner only if the runner's tags ⊇ job's required tags, capacity allows, and secrets policy permits.
- **CODEOWNERS** — a file mapping path patterns to required reviewer(s). A merge to a protected branch path requires the code owner's approval.
- **Stale approval** — an approval given before a new commit was pushed. Must be invalidated (merge blocked until re-approval).
- **Merge train** — a queue of MRs each running a pipeline against (its changes + all earlier-queued MRs + the target). An MR that becomes unmergeable mid-train is dropped.
- **Release evidence bundle** — a provenance chain: commit → approvals → pipeline result → artifacts (with digests) → deployment → audit events.

**Stack**
- Language: TypeScript (strict, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` = `vitest run`)
- Hashing: use Node's built-in `crypto.createHash('sha256')` — no network, no external hash lib
- No git binary, no shelling out, no real CI execution (explicit non-goal)
- All fixtures are plain TypeScript `const` objects in `src/fixtures/`

**Acceptance command**
```
npm test        # vitest run — green with no skipped tests
```

**Determinism rules (imperative)**
1. Never shell out to `git`. All repository operations are pure functions over TypeScript fixture objects.
2. Never use `Date.now()` in core modules. Inject a `clock: () => string` (ISO-8601).
3. Never generate random IDs in core modules. Use deterministic hashing (`sha256(content)`) or caller-supplied IDs.
4. Fixtures in `src/fixtures/` are `export const` objects, never fetched from URLs.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets C11 items 1–7 in strict dependency order.

---

**`S01` — Object types & content-hash IDs**
dependsOn: none
files: `src/object-types.ts`, `src/object-hash.ts`, `test/object-hash.test.ts`

interface:
```ts
// src/object-types.ts
export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';
export type ObjectId = string; // 64-char hex SHA-256

export interface GitBlob   { type: 'blob';   content: string; }
export interface TreeEntry { name: string; mode: string; objectId: ObjectId; }
export interface GitTree   { type: 'tree';   entries: TreeEntry[]; }
export interface GitCommit {
  type: 'commit';
  treeId: ObjectId;
  parentIds: ObjectId[];
  author: string;
  message: string;
  timestamp: string; // ISO-8601
}
export interface GitTag    { type: 'tag';    targetId: ObjectId; name: string; message: string; }
export type GitObject = GitBlob | GitTree | GitCommit | GitTag;

// src/object-hash.ts
export function hashObject(obj: GitObject): ObjectId;
// Serializes obj to a stable JSON string (keys sorted), SHA-256 hashes it, returns hex.
```

how to implement:
1. Create `src/object-types.ts` with the interfaces above.
2. Create `src/object-hash.ts`. Import `createHash` from `'node:crypto'`.
3. `hashObject`: `JSON.stringify(obj, Object.keys(obj).sort())` → SHA-256 → hex string.
4. Export `hashObject`.

acceptance: `test/object-hash.test.ts` asserts:
- Hashing the same blob twice gives the same ID.
- Changing one byte of `content` changes the ID.
- Two different objects have different IDs.
- `hashObject(blob).length === 64`.

---

**`S02` — In-memory object store + ref store**
dependsOn: `S01`
files: `src/object-store.ts`, `test/object-store.test.ts`

interface:
```ts
export interface ObjectStore {
  put(obj: GitObject): ObjectId;       // hashes obj, stores, returns ID
  get(id: ObjectId): GitObject | null; // returns null if not found
  has(id: ObjectId): boolean;
}

export interface RefStore {
  setRef(name: string, commitId: ObjectId): void;
  getRef(name: string): ObjectId | null;
  allRefs(): Record<string, ObjectId>;
}

export function createObjectStore(): ObjectStore;
export function createRefStore(): RefStore;
```

how to implement:
1. Create `src/object-store.ts`.
2. `ObjectStore`: `Map<ObjectId, GitObject>`. `put` calls `hashObject`, stores, returns id.
3. `RefStore`: `Map<string, ObjectId>`.

acceptance: `test/object-store.test.ts`:
- `put` a blob, `get` it back by ID → equal.
- `put` same blob twice → same ID, store size unchanged.
- `get` nonexistent ID → `null`.
- `setRef`, `getRef` round-trip.

---

**`S03` — Commit graph traversal & merge base**
dependsOn: `S02`
files: `src/commit-graph.ts`, `src/fixtures/repo-fixture.ts`, `test/commit-graph.test.ts`

interface:
```ts
export function ancestors(store: ObjectStore, commitId: ObjectId): Set<ObjectId>;
// BFS/DFS parent traversal. Returns all ancestor commit IDs including the commit itself.

export function mergeBase(
  store: ObjectStore,
  a: ObjectId,
  b: ObjectId,
): ObjectId | null;
// Returns the most-recent common ancestor of commits a and b.
// Algorithm: collect ancestors(a), then walk ancestors(b) until a hit.
// Returns null if no common ancestor.

export function isAncestor(
  store: ObjectStore,
  candidate: ObjectId,
  of: ObjectId,
): boolean;
// Returns true if candidate is an ancestor of (or equal to) of.
```

how to implement:
1. Create `src/commit-graph.ts`.
2. `ancestors`: BFS from `commitId`, following `parentIds`. Return a `Set<ObjectId>`.
3. `mergeBase`: collect `ancestors(a)` into a set; do BFS from `b` in reverse-recency order (BFS = level-order = most-recent first); return first hit in the set.
4. `isAncestor`: return `ancestors(of).has(candidate)`.
5. Create `src/fixtures/repo-fixture.ts` with a 5-commit linear chain and a fork-then-merge history (enough for merge base tests).

acceptance: `test/commit-graph.test.ts`:
- `mergeBase(store, headA, headB)` returns the known fork point from the fixture.
- `isAncestor(store, root, head)` returns `true`.
- `isAncestor(store, head, root)` returns `false`.
- Fast-forward check: if `mergeBase === b`, then A is ahead of B.

---

**`S04` — Three-way merge & conflict detection**
dependsOn: `S03`
files: `src/three-way-merge.ts`, `test/three-way-merge.test.ts`

interface:
```ts
export type MergeOutcome =
  | { status: 'clean';    resultLines: string[] }
  | { status: 'conflict'; markers: string[] };  // standard <<< === >>> markers

export function threeWayMerge(
  base: string[],    // lines of the merge base version
  ours: string[],    // lines of our branch
  theirs: string[],  // lines of their branch
): MergeOutcome;
// Per-line three-way merge:
// If base===ours and base!==theirs: take theirs.
// If base===theirs and base!==ours: take ours.
// If ours===theirs: take either (no conflict).
// If all three differ: conflict (<<<...===...>>>).

export function computeMergeConflictStatus(
  store: ObjectStore,
  sourceHead: ObjectId,
  targetHead: ObjectId,
): 'clean' | 'conflict' | 'fast-forward';
// 'fast-forward' if isAncestor(targetHead, sourceHead).
// Otherwise get the merge base tree, compare file contents.
// Returns 'clean' if all files merge without conflict, 'conflict' otherwise.
```

how to implement:
1. Create `src/three-way-merge.ts`.
2. `threeWayMerge`: iterate lines in the longest version; use the 4-way logic above.
3. `computeMergeConflictStatus`: call `mergeBase`; read each file from base/source/target trees; call `threeWayMerge` per file; if any conflict, return `'conflict'`.

acceptance: `test/three-way-merge.test.ts`:
- Non-conflicting changes from both sides both appear in result.
- Conflicting hunk → `status: 'conflict'`, markers present.
- Fast-forward case → `'fast-forward'`.
- The "reverted-change-survives" case: A reverts a change on its branch; the change still appears in the three-way result (base has it, A removed it, B kept it → B's version survives). Assert this explicitly.

---

**`S05` — Permission / role model**
dependsOn: none (pure types + logic)
files: `src/permissions.ts`, `src/fixtures/permission-fixture.ts`, `test/permissions.test.ts`

interface:
```ts
export type Role = 'owner' | 'maintainer' | 'developer' | 'reporter' | 'guest' | 'external';

export interface ProjectMember { userId: string; role: Role; }
export interface BranchProtection {
  branchPattern: string;           // exact name or glob
  allowedPushRoles: Role[];        // roles allowed to push directly
  requireMergeRequest: boolean;
  requiredApprovals: number;
  codeownersRequired: boolean;
}
export interface CodeOwnerRule { pathPattern: string; ownerIds: string[]; }

export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function checkPushPermission(
  userId: string,
  role: Role,
  branch: string,
  protections: BranchProtection[],
): PermissionCheckResult;

export function checkMergePermission(
  userId: string,
  role: Role,
  branch: string,
  protections: BranchProtection[],
  approvals: Array<{ userId: string }>,
  codeowners: CodeOwnerRule[],
  changedPaths: string[],
): PermissionCheckResult;
```

how to implement:
1. Create `src/permissions.ts`.
2. `checkPushPermission`: find matching protection; if `!allowedPushRoles.includes(role)` return denied with reason.
3. `checkMergePermission`: check approval count; check codeowners (find matching paths, require at least one owner approval); return denied with reason for each failure.
4. Reasons must be human-readable strings (golden tests will match them).

acceptance: `test/permissions.test.ts`:
- Developer cannot push to `main` (protected, maintainer-only) → denied with reason containing "developer".
- Maintainer can push.
- MR with 0 approvals when 2 required → denied, reason includes "approvals".
- CODEOWNERS rule matched, owner hasn't approved → denied, reason names the path.
- Self-approval: approvals list contains only the MR author → if protection requires external approval, denied.

---

**`S06` — CI pipeline DAG compiler**
dependsOn: none (pure logic)
files: `src/pipeline-compiler.ts`, `src/fixtures/pipeline-fixture.ts`, `test/pipeline-compiler.test.ts`

interface:
```ts
export interface JobDef {
  name: string;
  stage: string;
  needs: string[];       // job names this depends on
  tags: string[];
  artifacts: string[];   // artifact names this job produces
  consumesArtifacts: string[]; // artifact names this job reads
  when: 'on_success' | 'manual' | 'always';
  allowFailure: boolean;
}

export interface PipelineDef {
  stages: string[];      // default order
  jobs: JobDef[];
}

export type CompileResult =
  | { ok: true;  topologicalOrder: string[]; artifactEdges: Array<{from: string; to: string}> }
  | { ok: false; error: string };  // error includes 'cycle' or 'artifact-without-needs'

export function compilePipeline(def: PipelineDef): CompileResult;
// 1. Build adjacency: job A depends on job B if A.needs includes B.name,
//    OR B is in an earlier stage and A has no explicit needs overrides.
// 2. Topological sort (Kahn's algorithm).
// 3. If cycle detected → { ok: false, error: 'cycle: A → B → A' }.
// 4. Validate: for each consumesArtifacts entry, the producing job must be in A's needs.
//    If not → { ok: false, error: 'artifact-without-needs: job X reads artifact Y not in needs' }.
// 5. Return topological order and artifact edges.
```

how to implement:
1. Create `src/pipeline-compiler.ts`.
2. Build adjacency map from `needs` + stage ordering.
3. Kahn's algorithm: compute in-degree, BFS, detect remaining nodes (cycle).
4. Artifact validation: for each job, check `consumesArtifacts` producers are in `needs`.

acceptance: `test/pipeline-compiler.test.ts`:
- Linear stages → topological order = stage order.
- `needs` edge crossing stages → earlier in topological order than stage would imply.
- Cycle (A needs B needs A) → `ok: false`, error includes `'cycle'`.
- Artifact consumed without needs edge → `ok: false`, error includes `'artifact-without-needs'`.

---

**`S07` — Runner scheduler + secrets gate**
dependsOn: `S06`
files: `src/runner-scheduler.ts`, `src/fixtures/runner-fixture.ts`, `test/runner-scheduler.test.ts`

interface:
```ts
export interface RunnerDef {
  runnerId: string;
  tags: string[];
  concurrencyLimit: number;
  isProtected: boolean;   // true = only protected-branch pipelines may use this runner
  currentLoad: number;    // current number of running jobs
}

export interface CIVariable {
  name: string;
  value: string;
  isProtected: boolean;   // only available on protected branches
  isMasked: boolean;
}

export interface ScheduleJobArgs {
  job: JobDef;
  runners: RunnerDef[];
  variables: CIVariable[];
  isProtectedBranch: boolean;
  isForkPipeline: boolean;
}

export type ScheduleResult =
  | { ok: true;  runnerId: string; visibleVariables: CIVariable[] }
  | { ok: false; reason: string };

export function scheduleJob(args: ScheduleJobArgs): ScheduleResult;
// Rules (in order):
// 1. If isForkPipeline: filter out ALL isProtected variables from visibleVariables.
// 2. Find a runner whose tags ⊇ job.tags AND currentLoad < concurrencyLimit
//    AND (!runner.isProtected || isProtectedBranch).
// 3. If no matching runner: { ok: false, reason: 'no available runner for tags: [...]' }.
// 4. Return the chosen runner and the filtered variable set.
```

how to implement:
1. Create `src/runner-scheduler.ts`.
2. Filter variables: if `isForkPipeline`, remove all `isProtected` variables.
3. Find runner: iterate, check tag superset (job tags ⊆ runner tags), concurrency, protection.
4. If none found, return error.

acceptance: `test/runner-scheduler.test.ts`:
- Fork pipeline → protected variables absent from `visibleVariables`.
- Non-fork protected branch → protected variables present.
- No tag-matching runner → `ok: false`.
- Saturated runner (concurrency full) → skipped; next runner chosen.
- Protected runner, non-protected branch → skipped.

---

**`S08` — Merge request lifecycle + stale approval**
dependsOn: `S04`, `S05`
files: `src/merge-request.ts`, `test/merge-request.test.ts`

interface:
```ts
export type MRStatus = 'open' | 'merged' | 'closed';
export interface MergeRequest {
  mrId: string;
  authorId: string;
  sourceBranch: string;
  targetBranch: string;
  sourceHeadId: ObjectId;
  status: MRStatus;
  approvals: Array<{ userId: string; approvedAt: string; approvedHeadId: ObjectId }>;
  isDraft: boolean;
  conflictStatus: 'clean' | 'conflict' | 'fast-forward' | 'unknown';
}

export function addApproval(
  mr: MergeRequest,
  userId: string,
  clock: () => string,
): MergeRequest;
// Appends approval with current sourceHeadId.

export function pushNewCommit(
  mr: MergeRequest,
  newHeadId: ObjectId,
): MergeRequest;
// Updates sourceHeadId; invalidates all approvals where approvedHeadId !== newHeadId.

export function checkMergeReadiness(
  mr: MergeRequest,
  protections: BranchProtection[],
  codeowners: CodeOwnerRule[],
  changedPaths: string[],
  pipelineStatus: 'success' | 'failed' | 'running' | 'none',
): PermissionCheckResult;
```

how to implement:
1. Create `src/merge-request.ts`.
2. `pushNewCommit`: set `sourceHeadId = newHeadId`; filter approvals keeping only those where `approvedHeadId === newHeadId` (stale = removed).
3. `checkMergeReadiness`: check not draft; call `checkMergePermission`; check pipeline status not failed/running; return first failure.

acceptance: `test/merge-request.test.ts`:
- Approval added → in approvals list.
- New commit pushed → prior approvals removed (stale).
- Draft MR → merge blocked with reason "draft".
- Failed pipeline → merge blocked with reason "pipeline".

---

**`S09` — Merge train queue**
dependsOn: `S08`
files: `src/merge-train.ts`, `test/merge-train.test.ts`

interface:
```ts
export interface TrainEntry {
  mrId: string;
  combinedHeadId: ObjectId; // sourceHead + all earlier MRs applied to target
  pipelineStatus: 'running' | 'success' | 'failed' | 'dropped';
}

export interface MergeTrain {
  queue: TrainEntry[];
}

export function enqueueMR(
  train: MergeTrain,
  mr: MergeRequest,
  store: ObjectStore,
  targetHead: ObjectId,
): MergeTrain;
// Computes combinedHead = merge(targetHead + all queued MRs + this MR).
// Adds an entry with pipelineStatus 'running'.

export function dropConflictingMRs(
  train: MergeTrain,
  store: ObjectStore,
  afterMergedMRId: string,
): MergeTrain;
// After an earlier MR merges, re-check each remaining MR's conflict status.
// Set pipelineStatus 'dropped' for any that now conflict.
// Re-compute combinedHead for the surviving entries.
```

how to implement:
1. Create `src/merge-train.ts`.
2. `enqueueMR`: compute `combinedHeadId` by chaining merges from target through each queued entry.
3. `dropConflictingMRs`: for each remaining entry, call `computeMergeConflictStatus`; if `'conflict'`, set `'dropped'`.

acceptance: `test/merge-train.test.ts`:
- Queue A, B, C. Merge A. B conflicts. C survives. Assert B.pipelineStatus === 'dropped', C still in queue.
- Queue with no conflicts → all survive.

---

**`S10` — Release evidence bundle**
dependsOn: `S02`, `S08`
files: `src/release-bundle.ts`, `test/release-bundle.test.ts`

interface:
```ts
export interface ArtifactRef { name: string; digest: string; /* sha256 of content */ }

export interface ReleaseBundle {
  releaseId: string;
  commitId: ObjectId;
  approvals: Array<{ userId: string; approvedAt: string }>;
  pipelineId: string;
  artifacts: ArtifactRef[];
  deploymentTarget: string;
  auditEventIds: string[];
  createdAt: string;
}

export function buildReleaseBundle(
  commitId: ObjectId,
  mr: MergeRequest,
  pipelineId: string,
  artifacts: ArtifactRef[],
  deploymentTarget: string,
  auditEventIds: string[],
  clock: () => string,
): ReleaseBundle;
```

how to implement:
1. Create `src/release-bundle.ts`.
2. Build the struct from the provided arguments.
3. `releaseId = sha256(commitId + pipelineId + clock())` for determinism.

acceptance: `test/release-bundle.test.ts`:
- Bundle contains all provided approvals, artifacts, and audit events.
- Same inputs produce same `releaseId`.
- `artifacts[i].digest` is a non-empty hex string.

---

**`S11` — Content-addressing invariant property test**
dependsOn: `S01`, `S02`
files: `test/content-address.property.test.ts`

how to implement:
1. Create `test/content-address.property.test.ts`.
2. Use a deterministic sequence (not `Math.random()`) to generate 20 different blobs.
3. Assert: `hashObject(blob) === hashObject(blob)` (same object, same ID).
4. Assert: mutating one character changes the hash.
5. Assert: all 20 hashes are distinct.
6. Assert: `store.put(blob)` twice returns the same ID and `allObjects.length` doesn't grow.

acceptance: All assertions pass, no I/O.

---

**`S12` — Secret-non-exposure property test**
dependsOn: `S07`
files: `test/secret-exposure.property.test.ts`

how to implement:
1. Create `test/secret-exposure.property.test.ts`.
2. Generate 10 fork-pipeline scenarios with random combinations of protected/unprotected variables.
3. For each: call `scheduleJob(..., isForkPipeline: true)`.
4. Assert: `result.visibleVariables` contains no entry with `isProtected === true`.
5. Generate 5 non-fork, protected-branch scenarios.
6. Assert: `result.visibleVariables` includes all protected variables.

acceptance: All 15 scenarios pass.

---

### 3. The decomposition method for the remaining breadth

After S01–S12 are green, apply this recipe for every remaining feature:

**Recipe for one feature cluster:**
1. Name the feature's required inputs — which existing cards define those types?
2. Name the invariant it must preserve (from C10). Write that as the acceptance property first.
3. Split into at most 3 cards: (a) types-only, (b) pure logic/evaluation, (c) integration + golden test.
4. For each card: write the exact TypeScript interface, numbered recipe, and named test assertions.
5. Every card's test must run offline with `npm test`.

**Worked example 1 — CODEOWNERS file parser**
- Types card `CO01`: `CodeOwnerRule = { pathPattern: string; ownerIds: string[] }`. Function `parseCodeowners(text: string): CodeOwnerRule[]`. No deps.
- Logic card `CO02` dependsOn `CO01`, `S05`: `matchCodeowners(rules, changedPaths)` → `{ path, requiredOwners }[]`. Already used by `checkMergePermission` in S05; this adds the file-parse entry point.
- Test: fixture `CODEOWNERS` text with 3 rules; assert correct owner sets for matching paths; assert no-match path returns empty.

**Worked example 2 — Pipeline `rules:` / `workflow:rules` evaluation**
- Types card `PR01`: `JobRule = { if: string; when: 'on_success'|'never'|'always'; variables: Record<string, string> }`. `evaluateJobRule(rule, context: Record<string, string>): boolean`. Context = branch name, MR labels, etc.
- Logic card `PR02` dependsOn `S06`, `PR01`: Extend `compilePipeline` to accept `rules` per job; filter out jobs whose rules evaluate to `never` before building the DAG. Return the filtered plan.
- Test: a job with `rules: [{if: "$CI_COMMIT_BRANCH == main", when: "on_success"}]` is included on `main`, excluded on `feature/x`.

**Worked example 3 — Audit event trail for merge decisions**
- Types card `AU01`: `AuditEvent = { eventId, actorId, actionType: 'MERGE'|'PUSH'|'APPROVAL'|'PIPELINE_START', targetId, timestamp, reason, outcome }`.
- Logic card `AU02` dependsOn `AU01`, `S08`: `auditMergeDecision(mr, result, actorId, clock)` → `AuditEvent`. Wraps `checkMergeReadiness` + emits one event per decision.
- Property test (in `AU02` test file): for every merge decision (allowed or denied), exactly one audit event is emitted. `auditEvents.length === mergeDecisions.length`.

---

### 4. Per-task implementation conventions

**Folder layout**
```
src/
  object-types.ts
  object-hash.ts
  object-store.ts
  commit-graph.ts
  three-way-merge.ts
  permissions.ts
  pipeline-compiler.ts
  runner-scheduler.ts
  merge-request.ts
  merge-train.ts
  release-bundle.ts
  fixtures/
    repo-fixture.ts        // commit graph fixture
    pipeline-fixture.ts    // pipeline YAML-like objects
    runner-fixture.ts      // runner + variable definitions
    permission-fixture.ts  // members, protections, CODEOWNERS
test/
  object-hash.test.ts
  object-store.test.ts
  commit-graph.test.ts
  three-way-merge.test.ts
  permissions.test.ts
  pipeline-compiler.test.ts
  runner-scheduler.test.ts
  merge-request.test.ts
  merge-train.test.ts
  release-bundle.test.ts
  content-address.property.test.ts
  secret-exposure.property.test.ts
```

**How to write a test in Vitest**
```ts
import { describe, it, expect } from 'vitest';
import { compilePipeline } from '../src/pipeline-compiler.js';

describe('pipeline-compiler', () => {
  it('rejects cycles', () => {
    const result = compilePipeline({
      stages: ['build'],
      jobs: [
        { name: 'A', stage: 'build', needs: ['B'], tags: [], artifacts: [], consumesArtifacts: [], when: 'on_success', allowFailure: false },
        { name: 'B', stage: 'build', needs: ['A'], tags: [], artifacts: [], consumesArtifacts: [], when: 'on_success', allowFailure: false },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cycle/);
  });
});
```

**Keeping it deterministic**
- `hashObject` uses `node:crypto` — deterministic, no network.
- Inject `clock: () => string` everywhere. Tests pass `() => "2026-06-30"`.
- No `Math.random()` in `src/`. The secret-exposure property test uses a fixed array of 10 scenarios, not random generation.
- Fixture commit graphs are fully specified (each commit has a known `timestamp` and `parentIds`). No generated UUIDs.

**Definition of done for any card**
1. `tsc --noEmit` exits 0.
2. `npm test` green.
3. No `any` in `src/`.
4. No shell-out (no `child_process`, no `exec`, no `git` commands) anywhere.
5. Every acceptance assertion from the card is present as a named `it(...)` block.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Treating a repo as a list of files instead of a DAG**
A 3B model will want `repo.files = [{path, content}]`. The spec is clear: the object store is a content-addressed Merkle DAG. A `tree` object points to `blob` objects by ID; a `commit` points to a `tree` by ID. The test catches this because `hashObject(tree)` depends on the IDs of the blobs it references — changing a blob must change the tree's ID.

**Pitfall 2 — Using `Date.now()` for commit timestamps**
Commit IDs are content hashes; if the `timestamp` field is `Date.now()`, then the same logical commit hashed twice gives different IDs. Fix: fixtures specify timestamps as static ISO-8601 strings. `hashObject` must be a pure function of the object's fields.

**Pitfall 3 — Computing merge base as "oldest common commit" instead of LCA**
A model will find a common ancestor but pick the wrong one (the root instead of the latest common fork point). The `commit-graph.test.ts` fixture must include a fork-then-merge topology with multiple common ancestors, and the test must assert the *specific* LCA commit, not just "any" common ancestor.

**Pitfall 4 — Implementing the CI pipeline as a flat job list**
A model will build `jobs.map(run)` without topological sorting. The cycle-detection test (S06) fails immediately. Remind the model: jobs have a `needs` array; the compiler must build an adjacency map and run Kahn's algorithm.

**Pitfall 5 — Leaking protected variables to fork pipelines**
A model will pass all variables to `scheduleJob` and only filter them in a UI display layer, not in the scheduling function itself. The `scheduleJob` function must filter `isProtected` variables when `isForkPipeline === true`, so the caller never even receives them. The property test (S12) catches the display-layer-only fix.

**Pitfall 6 — Not invalidating stale approvals on new commit push**
A model will accumulate approvals in a list and never remove them. `pushNewCommit` in `S08` must filter `approvals` to only those where `approvedHeadId === newHeadId`. If the model retains all approvals, the stale-approval test in `S08` fails.

**Pitfall 7 — Merge train: re-using the original source head instead of combinedHead**
For the merge train, each queued MR's pipeline must run against `combinedHead` (target + earlier MRs + this MR), not the original source head. The drop-on-conflict test (S09) catches this: B only becomes conflicting *after* A is combined — if B's pipeline ran against B's original source, it would look fine.

**Pitfall 8 — Hash collisions in the property test**
A model might generate 20 blobs from a trivial integer sequence and end up with some identical content. Make the blobs clearly distinct: `{ type: 'blob', content: \`file content number ${i} with unique suffix\` }`. The test must assert all 20 hashes are distinct.
