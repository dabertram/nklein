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
