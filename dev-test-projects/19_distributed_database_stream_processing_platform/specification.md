# 19 - Distributed Database and Stream Processing Platform

Complexity tier: 19/20
Expected decomposition size: 50-58 dependent implementation cards before coding.
Domain pressure: distributed systems, consensus, query planning, replication, transactions, stream processing, fault injection, observability.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build an educational but serious distributed database foundation that supports a tiny SQL-like layer, replicated logs, transactions, stream processing, and deterministic fault simulation. It should expose the hardest architectural seams agents usually hand-wave.

## Foundation release scope
The first serious buildout must include:
- Cluster, node, partition, replica, log entry, term, transaction, table, index, query plan, stream, checkpoint, watermark, fault, and metric models.
- Deterministic simulation harness for node clocks, network partitions, message delay, crash/restart, disk persistence fixtures, and recovery.
- Replicated log module with leader election, append entries, commit index, snapshot placeholder, stale leader rejection, and membership change constraints.
- Storage engine for typed rows, primary keys, secondary indexes, MVCC-like versions, write-ahead-log fixtures, and snapshot reads.
- Transaction coordinator supporting read-only snapshot, single-partition write, multi-partition two-phase commit, abort, retry, and idempotent client requests.
- SQL-like parser and query planner for a constrained language with select, project, filter, join, aggregate, order, limit, and index selection.
- Stream processor that consumes append logs, maintains materialized views, handles watermarks, late events, exactly-once-like idempotence, and checkpoint recovery.
- Observability suite for replication lag, leader changes, transaction retries, query cost, stream lag, and fault timeline.
- Seed cluster scenario with partitioned network, stale leader, transaction retry, slow query, late stream event, and recovery from checkpoint.

## Architecture requirements
- Separate simulation, consensus, storage, transaction, query, stream, and observability modules with crisp contracts.
- Make all nondeterminism injectable through the simulation scheduler.
- Use property-style tests for invariants such as no committed unreplicated writes and snapshot consistency.
- Prefer a small correct subset over broad fake database syntax.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Consensus correctness depends on terms, quorum, log matching, commit rules, and stale leader handling.
- Transactions require isolation semantics and idempotent retry behavior.
- Query planning must reason about indexes and cost, not just filter arrays.
- Stream processing must handle late events, watermarks, and checkpoint recovery.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Fault simulation tests reproduce leader election, partition, crash, restart, and recovery deterministically.
- Consensus tests prove committed log entries survive leader changes in the fixture model.
- Transaction tests cover abort, retry, two-phase commit, and snapshot reads.
- Query planner tests choose different plans based on indexes and estimated selectivity.
- Stream tests cover watermark, late event, idempotent replay, and checkpoint restore.
- The project passes npm test without external databases.

## Explicit non-goals
- Do not wrap SQLite or an external database.
- Do not implement broad SQL with fake internals.
- Do not use real time, sockets, or processes in deterministic core tests.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *consensus safety + exactly-once correctness under a deterministic fault simulator*: a committed log entry must survive any sequence of crashes, partitions, and leader changes (State Machine Safety / linearizability), every transaction must obey its isolation contract, and every stream output must be exactly-once — and ALL of it must be provable by replaying `runCluster(seed, faults)` to a byte-identical event log.** This is the project where "it works on my machine" is death: distributed-systems bugs hide in the interleavings, and the only honest way to find them is to make *every source of nondeterminism injectable* and replay the adversary deterministically — the FoundationDB / TigerBeetle discipline.

The thesis of this whole challenge is **deterministic simulation testing (DST)**. FoundationDB pioneered making the *entire* distributed system run inside a single-threaded, seeded simulator so that crashes, partitions, and clock skew are *scripted and replayable*; its simulator stress-tested the system so thoroughly that Jepsen's author declined to test it ([WarpStream — DST for our entire SaaS](https://www.warpstream.com/blog/deterministic-simulation-testing-for-our-entire-saas); [notes.eatonphil — what's the big deal about DST](https://notes.eatonphil.com/2024-08-20-deterministic-simulation-testing.html)). TigerBeetle (a financial DB) used the same approach to become Jepsen-passing in three years and can "speed up time and replay scenarios" for debugging ([TigerBeetle — DB in the browser](https://tigerbeetle.com/blog/2023-07-11-we-put-a-distributed-database-in-the-browser/)). The DST success formula: **no parallelism + quantized execution + deterministic behavior** ([Amplify — a DST primer](https://www.amplifypartners.com/blog-posts/a-dst-primer-for-unit-test-maxxers)). That formula *is* the spine of this project; everything below hangs off it.

## F0. The grading rubric (what actually makes this hard)

1. **Consensus safety** — does a committed entry survive every crash/partition/leader-change the simulator can throw, with no committed entry ever lost or overwritten (State Machine Safety)?
2. **Determinism** — does `runCluster(seed, faults)` produce a byte-identical event log on every run, so any bug is a reproducible replay?
3. **Isolation correctness** — do transactions actually provide their claimed isolation (snapshot reads see a consistent point-in-time; serializable rejects write-skew)?
4. **Exactly-once streaming** — across checkpoint/restore and replay, does every input event affect each materialized view exactly once (no double-count, no loss)?
5. **Idempotent client requests** — does a retried client write commit exactly once despite leader changes?

## F1. The deterministic simulation kernel (the foundation under the foundation)

Build this *first* — it is the thing the whole project is testing. ~the first 10–12 cards.

- **Single-threaded logical-time scheduler.** No real threads, sockets, clocks, or `Date.now()` anywhere in the core (explicit non-goal). The simulator owns a priority queue of scheduled events (message delivery, timer fire, disk write) ordered by logical time; it advances time by popping events. "No parallelism + quantized execution + deterministic behavior" ([Amplify — DST primer](https://www.amplifypartners.com/blog-posts/a-dst-primer-for-unit-test-maxxers)).
- **Per-node logical clocks** with injectable skew/drift; **network model** with per-link delay, reorder, duplication, and *partition* (drop messages across a cut); **crash/restart** that discards volatile state but preserves the disk-persistence fixture; **disk model** that can lose un-fsync'd writes and reorder within a fsync barrier.
- **Seeded entropy tree.** All randomness (election timeouts, message jitter, fault timing) draws from one seeded PRNG, so `(seed, fault-schedule)` fully determines the run.
- **Event-logged + replayable.** The authoritative record is the append-only event log; state is a fold; a snapshot is a memoized fold. The flagship test is `runCluster(seed, faults)` twice ⇒ identical logs (invariant #2), and a "speed up time, replay the failing seed" debugging workflow ([TigerBeetle — replay scenarios](https://tigerbeetle.com/blog/2023-07-11-we-put-a-distributed-database-in-the-browser/)).
- **Liveness via fault windows.** Faults are scheduled to *heal* so the cluster can make progress; the simulator asserts both safety (always) and liveness (eventually, once faults stop).

## F2. The replicated log / consensus module (Raft, including the subtle parts)

Model **Raft** precisely — and implement the parts agents *always* get wrong.

- **The three sub-problems:** leader election (terms, randomized timeouts, RequestVote, majority), log replication (AppendEntries, `nextIndex`/`matchIndex`, commit index), and **safety** (Log Matching Property + Leader Completeness + State Machine Safety) ([Raft paper](https://raft.github.io/raft.pdf); [Baeldung — Raft](https://www.baeldung.com/cs/raft-consensus-algorithm)).
- **THE subtle commit rule (the seam this spec exists to test).** A leader **never commits an entry from a previous term by counting replicas** — only an entry from its *current* term is committed by majority, after which all prior entries commit *indirectly* via Log Matching. This is the Figure-8 hazard: an old-term entry replicated on a majority can still be overwritten by a future leader, so counting it as committed would violate safety ([Raft paper §5.4.2](https://raft.github.io/raft.pdf); [dev.to — why Raft can't safely commit old-term entries](https://dev.to/abdellani/why-raft-cant-safely-commit-old-term-entries-370p); [sudk1896 — commitment in Raft](https://sudk1896.github.io/2018/11/10/CommitmentInRaft.html)). The seed scenario "stale leader" must exercise exactly this.
- **Stale-leader rejection + linearizable reads.** A stale leader (superseded, unaware) must not serve reads; reads use the **ReadIndex / leader-lease** mechanism — record commitIndex, confirm leadership via a heartbeat round (or a valid lease), and only return once `appliedIndex ≥ commitIndex` ([Raft paper — read-only queries](https://raft.github.io/raft.pdf); [SOFAJRaft — linearizable reads / lease](https://www.sofastack.tech/en/projects/sofa-jraft/consistency-raft-jraft/)).
- **Membership change via joint consensus.** Configuration changes go through a transitional `C-old,new` requiring majorities from *both* old and new configs, avoiding split-brain ([Raft paper §6](https://raft.github.io/raft.pdf)). **Snapshot/InstallSnapshot** lets the leader catch up a follower whose needed entries were compacted away.

## F3. The MVCC storage engine + isolation (real anomalies, real defenses)

The transaction layer must provide *named* isolation with *real* anomaly behavior — "transactions require isolation semantics" (the spec).

- **MVCC with versioned keys.** Each key carries versions; a write creates a new version with a timestamp; a read sees the version visible at its snapshot ([CMU 15-445 — multiversioning](https://15445.courses.cs.cmu.edu/spring2026/notes/20-multiversioning1.pdf); [tech-lessons — SSI in a KV engine](https://tech-lessons.in/en/blog/serializable_snapshot_isolation/)). **Snapshot reads** see a consistent point-in-time; **WAL fixtures** make recovery testable; **garbage collection / VACUUM** of obsolete versions is modeled ([Wikipedia — snapshot isolation](https://en.wikipedia.org/wiki/Snapshot_isolation)).
- **Snapshot Isolation is not Serializable — and that gap is the test.** SI permits **write skew**: two transactions read overlapping rows, decide independently, and write disjoint rows that jointly violate an invariant ([Vlad Mihalcea — write skew in 2PL vs MVCC](https://vladmihalcea.com/write-skew-2pl-mvcc/)). **Serializable Snapshot Isolation (SSI)** detects dangerous read-write dependency structures at runtime and aborts one transaction to preserve serializability ([tech-lessons — SSI](https://tech-lessons.in/en/blog/serializable_snapshot_isolation/); [muratbuffalo — serializable isolation for snapshot DBs](http://muratbuffalo.blogspot.com/2025/07/serializable-isolation-for-snapshot-databases.html)). The engine must offer both levels and demonstrate the write-skew anomaly *appearing* under SI and *being prevented* under SSI.
- **Distributed transactions via 2PC (Percolator-style).** Multi-partition writes use two-phase commit: a **Prewrite** phase (lock + stage) then a **Commit** phase, layered on single-row atomic primitives — exactly Google Percolator's design for cross-shard ACID SI on top of BigTable ([TiKV — Percolator](https://tikv.org/deep-dive/distributed-transaction/percolator/); [Yugabyte — Percolator vs Spanner](https://www.yugabyte.com/blog/implementing-distributed-transactions-the-google-way-percolator-vs-spanner/)). Model the **coordinator** with abort, retry, and crash-in-the-middle recovery; a participant must be able to resolve a transaction whose coordinator crashed after prewrite (the classic 2PC blocking hazard).
- **Idempotent client requests.** Each client request carries a unique id; the state machine deduplicates so a retried write (e.g. resent after a leader change) applies exactly once (the seed scenario "transaction retry" + acceptance "idempotent client requests").

## F4. The SQL-like query planner (cost-based, index-aware)

"Query planning must reason about indexes and cost, not just filter arrays" (the spec) — make it a real, if small, **cost-based optimizer**.

- **Logical → physical plan with a cost model.** Parse a constrained SQL subset (select/project/filter/join/aggregate/order/limit), build a logical plan, enumerate physical plans, cost them, pick the cheapest ([CMU 15-445 — query planning & optimization](https://15445.courses.cs.cmu.edu/spring2025/notes/15-optimization.pdf)).
- **Selectivity & cardinality estimation drive the choice.** Selectivity ∈ [0,1] is the fraction of rows passing a predicate; cardinality = selectivity × child rows; these feed the cost of access paths (full scan vs index) and join methods (nested-loop vs hash) and **join order** ([Springer survey — cardinality estimation, cost model, plan enumeration](https://link.springer.com/article/10.1007/s41019-020-00149-7); [accelazh — Volcano/Cascades](http://accelazh.github.io/database/Database-Query-Optimizer-Volcano-Cascades)). The acceptance criterion "choose different plans based on indexes and estimated selectivity" becomes: a high-selectivity predicate on an indexed column picks the index; a low-selectivity one picks a scan.
- **A Volcano/Cascades-lite memo** (best plan per sub-expression, transformation rules like `Join(A,B)→Join(B,A)`) is the natural structure ([accelazh — Volcano/Cascades](http://accelazh.github.io/database/Database-Query-Optimizer-Volcano-Cascades)). Keep it small and correct (the spec: "a small correct subset over broad fake database syntax").

## F5. The stream processor (exactly-once, event-time, watermarks)

Model **Flink-style** stream processing — the spec's hardest non-consensus seam.

- **Event time vs processing time + watermarks.** A **watermark** with timestamp *t* flowing in the stream declares "event time has reached *t*"; windows fire based on event time regardless of arrival order; **late events** past the watermark are handled by an explicit policy (drop / side-output / allowed-lateness) ([Flink — timely stream processing](https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/time/); [thesoftwarefrontier — Flink architecture & event-time](https://www.thesoftwarefrontier.com/p/understanding-apache-flink-architecture)). This is exactly the spec's "watermarks, late events."
- **Checkpointing via Chandy-Lamport barriers.** Consistent snapshots use **checkpoint barriers** injected at sources that flow through the operator graph; when an operator has received barriers on all inputs, it snapshots its state — the distributed-snapshot (Chandy-Lamport) algorithm with Flink's alignment optimization ([Confluent — exactly-once in Flink](https://developer.confluent.io/learn/streamables/exactly-once-processing-in-apache-flink/); [Conduktor — Flink checkpointing](https://www.conduktor.io/glossary/flink-state-management-and-checkpointing)). On failure, restore from the last checkpoint and replay from the recorded source offsets.
- **Exactly-once is "effectively once" via idempotent/transactional sinks.** Internally, replay-from-checkpoint + deterministic processing yields exactly-once *state*; end-to-end requires idempotent or transactional output so a replay doesn't double-emit ([Medium — almost end-to-end exactly-once with Flink](https://medium.com/codex/how-we-almost-achieve-end-to-end-exactly-once-processing-with-flink-28d2c013b5c1)). The spec's "exactly-once-like idempotence" gets the honest framing: it is *effectively once*, achieved by replay + idempotent application, not magic.
- **The stream consumes the replicated log** (F2) as its durable, ordered input — closing the loop: consensus provides the exactly-once-ordered input that makes deterministic stream replay possible.

## F6. CAP / consistency framing (name the tradeoffs explicitly)

The platform should *declare* its consistency posture, not pretend to dodge physics.

- **CAP/PACELC as design notes.** Under a partition (P) you choose availability (A) or consistency (C); else (E) you trade latency (L) vs consistency (C) — Spanner is PC/EC, ScyllaDB is PA/EL ([ScyllaDB — PACELC](https://www.scylladb.com/glossary/pacelc-theorem/); [bytebytego — CAP vs PACELC](https://blog.bytebytego.com/p/consistency-and-partition-tolerance)). The Raft core is **CP**: during a partition the minority side refuses writes (and stale reads) rather than diverge.
- **Optional eventual-consistency lane via CRDTs.** For explicitly AP data (e.g. a metrics counter that must stay available under partition), model a **CRDT** — a G-Counter / PN-Counter / LWW-Register that is *strongly eventually consistent*: deterministic merge guarantees replicas with the same causal history converge to identical state ([Wikipedia — CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type); [mwhittaker — CRDTs](https://mwhittaker.github.io/consistency_in_distributed_systems/3_crdt.html)). This makes the CP-vs-AP tradeoff *concrete and testable* rather than abstract.

## F7. The observability suite (the fault timeline)

"Observability for replication lag, leader changes, transaction retries, query cost, stream lag, and fault timeline" (the spec) — every metric is derived from the event log, so it is reproducible. The **fault timeline** scrubs through logical time showing partitions opening/healing, elections, commits, aborts, checkpoints, and recoveries — the operator's window into a deterministic run.

## F8. Adversarial & edge-case fixture pack (ship the hard interleavings)

- **The Figure-8 stale leader.** An old-term entry on a majority that a new leader legitimately overwrites; the system must *not* have committed it (F2). Safety holds.
- **The partition-during-commit.** A 2PC coordinator crashes after prewrite; a participant resolves the transaction's fate without the coordinator (no eternal lock).
- **The write-skew pair.** Two SI transactions that jointly break an invariant commit under SI; under SSI one aborts. Both behaviors asserted.
- **The retried-write-across-failover.** A client write is acked-but-lost during a leader change and retried; it commits exactly once (idempotent dedupe).
- **The late stream event.** An event arriving after its window's watermark is handled per policy (dropped/side-output), never silently double-counted.
- **The checkpoint-restore double-count trap.** Kill the stream processor mid-window and restore; the materialized view reflects each input exactly once (no double-apply).
- **The split-vote election.** Simultaneous candidates split the vote; randomized timeouts eventually elect one leader (liveness once faults heal).
- **The disk-loses-unsynced-writes.** A crash drops un-fsync'd WAL tail; recovery never exposes a write that wasn't durable, and never loses a committed one.

## F9. Property-based / invariant tests (the true acceptance bar)

Assert these as properties over randomized fault schedules (the spec mandates property-style tests):

1. **State Machine Safety / no committed entry lost** — if an entry is committed at index *i* with value *v*, no node ever applies a different value at *i*, across any crash/partition/election sequence ([Raft — State Machine Safety](https://raft.github.io/raft.pdf)).
2. **Election safety** — at most one leader per term.
3. **Log Matching** — if two logs share an entry at `(index, term)`, they are identical up to that point.
4. **No committed-unreplicated write** — a write reported committed exists on a majority (the spec's named invariant).
5. **Linearizability of committed ops** — the observed history of committed reads/writes has a valid linearization (a stale leader never serves a read that violates it).
6. **Snapshot consistency** — a snapshot read reflects a single consistent point-in-time (the spec's named invariant).
7. **Serializability under SSI** — no committed schedule exhibits write skew (or any non-serializable anomaly) at the serializable level.
8. **Idempotency** — replaying any client request with the same id yields exactly one application.
9. **Exactly-once streaming** — across any checkpoint/restore + replay, each input event affects each materialized view exactly once.
10. **Determinism** — `runCluster(seed, faults)` twice ⇒ byte-identical event logs.
11. **CRDT convergence** — for any AP CRDT, replicas that have seen the same set of updates have identical state, regardless of delivery order ([CRDT — strong eventual consistency](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type)).

## F10. The concrete first vertical slice (the on-ramp — build THIS first, ~50–58 cards)

Prove the consensus + transaction + stream spine end-to-end before breadth:

1. **The DST kernel** (F1): logical-time scheduler, network/crash/disk fault models, seeded entropy, event log, snapshot/restore, `runCluster(seed, faults)`. Invariant #10.
2. **Raft core** (F2): election, replication, commit index, **the current-term commit rule**, stale-leader rejection, ReadIndex linearizable reads. Invariants #1–#5.
3. **MVCC storage + single-partition transactions** (F3): versioned keys, snapshot reads, WAL fixtures. Invariant #6.
4. **2PC multi-partition transactions + idempotent client requests** (F3): prewrite/commit, abort/retry, coordinator-crash recovery. Invariant #8.
5. **SI vs SSI** (F3): demonstrate write skew under SI, prevent it under SSI. Invariant #7.
6. **The stream processor** (F5): consume the replicated log, event-time windows, watermarks, late-event policy, checkpoint/restore. Invariant #9.
7. **A small cost-based planner** (F4): index-vs-scan choice driven by selectivity.
8. **The seed cluster scenario green** (partitioned network, stale leader, transaction retry, slow query, late stream event, recovery from checkpoint) under the simulator, with all invariants holding — including the Figure-8 stale-leader and a checkpoint-restore.

If that slice holds under randomized fault schedules, more SQL, more isolation levels, membership changes, and the UI are breadth on a *provably safe* spine.

## F11. Domain knowledge-debt to track

- **Raft membership-change and snapshot-streaming corner cases** — joint consensus and InstallSnapshot have subtle edge cases (single-server changes, snapshot/log overlap) flagged as debt with the paper as the reference ([Raft paper §6/§7](https://raft.github.io/raft.pdf)).
- **Full serializability vs SSI false-abort rate** — SSI can abort transactions that *were* serializable (false positives); the rate and tuning are expert-review territory ([tech-lessons — SSI](https://tech-lessons.in/en/blog/serializable_snapshot_isolation/)).
- **Exactly-once end-to-end limits** — internal exactly-once is achievable; true end-to-end needs idempotent/transactional sinks and is "effectively once" — surfaced honestly, never claimed as magic ([Medium — end-to-end exactly-once with Flink](https://medium.com/codex/how-we-almost-achieve-end-to-end-exactly-once-processing-with-flink-28d2c013b5c1)).
- **Cardinality-estimation error** — optimizers assume independent columns and uniform distributions; skew breaks estimates; the planner ships a simple model and flags the limitation ([Springer survey — cardinality estimation](https://link.springer.com/article/10.1007/s41019-020-00149-7)).
- **Clock assumptions** — the core uses logical clocks only; real wall-clock/TrueTime designs (Spanner) are out of scope and flagged ([Yugabyte — Percolator vs Spanner](https://www.yugabyte.com/blog/implementing-distributed-transactions-the-google-way-percolator-vs-spanner/)).

## F12. Why this is a great !Klein challenge

This is the *purest* test of **determinism under hard safety invariants** in the whole batch. Distributed-systems correctness is exactly where confident-but-wrong code from a weak model is most dangerous and least detectable by eyeballing — and the antidote is structural: make every nondeterminism injectable, replay the adversary from a seed, and assert machine-checkable safety properties (no committed entry lost; linearizability; exactly-once; serializability) that a bluff *cannot* pass. The Raft current-term commit rule, write-skew-under-SI, and checkpoint-restore-double-count are precisely the seams agents hand-wave, and the property tests make hand-waving fail loudly. It decomposes in crisp dependency order (simulator → consensus → MVCC/2PC → isolation → stream → planner), each layer landing against an invariant. The reward is a small, *correct*, replayable distributed database — the kind of legible, determinism-first, safety-grounded system !Klein exists to prove buildable even when the brain driving the build is small and fallible.

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms**
- **DST (Deterministic Simulation Testing)** — the entire cluster runs as a single-threaded simulation; all nondeterminism (timers, network, disk, crashes) is injectable. `runCluster(seed, faults)` produces an identical event log on every run.
- **Logical time** — a monotonically increasing integer owned by the simulator's priority queue. No wall clock.
- **Seeded PRNG** — a deterministic pseudo-random number generator initialized from an integer seed. All randomness (election timeouts, jitter, fault timing) draws from it.
- **Event log** — the authoritative append-only record of everything that happened in a simulation run (messages sent/received, elections, commits, crashes, disk writes). State is a fold over the log.
- **Term** — Raft's logical election epoch. A leader in term T is invalid in term T+1. Every message carries the sender's current term.
- **Commit index** — the highest log index known to be committed (replicated on a majority of nodes). Entries at or below this index are durable.
- **Log Matching** — Raft invariant: if two logs share an entry at (index, term), all entries up to that index are identical.
- **Current-term commit rule** — a Raft leader commits an entry from its current term by majority count; entries from prior terms commit only *indirectly* when a current-term entry is committed (see F2).
- **MVCC** — Multi-Version Concurrency Control. Each key has a list of versioned values; reads see the version visible at their snapshot timestamp.
- **Snapshot isolation (SI)** — a transaction reads a consistent point-in-time; writes are invisible until commit; write skew is possible.
- **SSI (Serializable Snapshot Isolation)** — extends SI to detect dangerous read-write conflicts and abort one transaction to prevent write skew.
- **2PC (two-phase commit)** — Prewrite (lock and stage each shard) + Commit (make all shards permanent). If the coordinator crashes after Prewrite but before Commit, participants must resolve the fate without the coordinator.
- **Watermark** — in stream processing, a timestamp T flowing through the stream declaring "no events with `eventTime < T` will arrive later." Windows fire based on event time using watermarks.
- **Checkpoint barrier** — a special record injected at stream sources; when all inputs of an operator have received the barrier, the operator snapshots its state.
- **Exactly-once** — effectively once: replay-from-checkpoint + deterministic processing + idempotent/transactional output ensures no double-count and no loss.

**Stack**
- Language: TypeScript (strict, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` = `vitest run`)
- No real threads, sockets, OS processes, or `Date.now()` anywhere in core (explicit non-goal)
- All communication between simulated nodes is via the simulator's message queue
- Fixtures in `src/fixtures/` as `export const` TypeScript objects

**Acceptance command**
```
npm test        # vitest run — green, no skipped tests
```

**Determinism rules (imperative)**
1. Zero calls to `Date.now()`, `setTimeout`, `setInterval`, `Math.random()`, or any async I/O in `src/`.
2. The simulator advances logical time by processing events from a sorted priority queue.
3. All randomness uses a seeded LCG (provide the implementation — no external library needed):
```ts
export function createLCG(seed: number) {
  let s = seed >>> 0;
  return () => { s = Math.imul(s, 1664525) + 1013904223 >>> 0; return s; };
}
```
4. Every test passes a fixed seed to `createSimulator(seed)`.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets F10 items 1–8 in strict dependency order.

---

**`S01` — Simulator types + event queue**
dependsOn: none
files: `src/sim/types.ts`, `src/sim/simulator.ts`, `test/simulator.test.ts`

interface:
```ts
// src/sim/types.ts
export interface SimEvent {
  scheduledAt: number;   // logical time
  targetNodeId: string;
  payload: unknown;
}

export interface NodeState {
  nodeId: string;
  isAlive: boolean;
  diskLog: unknown[];    // persisted entries (survive crash/restart)
  volatileState: unknown; // lost on crash
}

export type MessageHandler = (nodeId: string, payload: unknown, sim: Simulator) => void;
export type PRNG = () => number;

// src/sim/simulator.ts
export interface Simulator {
  scheduleAt(time: number, targetNodeId: string, payload: unknown): void;
  scheduleAfter(delayTicks: number, targetNodeId: string, payload: unknown): void;
  now(): number;
  advanceTo(targetTime: number): void;
  // Processes all events with scheduledAt <= targetTime in order.
  addNode(nodeId: string, handler: MessageHandler): void;
  crashNode(nodeId: string): void;
  restartNode(nodeId: string): void;
  partitionLink(fromNodeId: string, toNodeId: string): void;   // drop messages on this link
  healLink(fromNodeId: string, toNodeId: string): void;
  prng: PRNG;
  eventLog: SimEvent[];   // append-only; the authoritative record
}

export function createSimulator(seed: number): Simulator;
```

how to implement:
1. Create `src/sim/types.ts` with types above.
2. Create `src/sim/simulator.ts`. Use a sorted array as the priority queue (sort by `scheduledAt`).
3. `advanceTo`: pop events with `scheduledAt <= targetTime`; if the link is partitioned or node is crashed, drop the message (don't call handler); otherwise call the node's handler.
4. `crashNode`: mark `isAlive = false`; clear volatile state; keep disk log.
5. `restartNode`: mark `isAlive = true`; restore from disk log only.
6. `prng`: the LCG from the determinism rules section, seeded with the constructor `seed`.

acceptance: `test/simulator.test.ts`:
- `scheduleAt(5, "n1", msg)` → `advanceTo(4)` does NOT deliver; `advanceTo(5)` delivers.
- Crashed node does not receive messages.
- Partitioned link: message from A to B is dropped; B to A is also dropped.
- `eventLog.length` grows with each delivered event.
- `createSimulator(42)` run twice → same sequence of `prng()` outputs.

---

**`S02` — Seeded PRNG + determinism proof**
dependsOn: `S01`
files: `test/determinism.property.test.ts`

how to implement:
1. Create `test/determinism.property.test.ts`.
2. Build two simulators with the same seed. Schedule identical events. Call `advanceTo(1000)` on both.
3. Assert `simA.eventLog` deeply equals `simB.eventLog`.
4. Repeat with seed 1, 2, 3.

acceptance: All 3 seeds produce identical logs between the two simulators.

---

**`S03` — Raft log entry + node types**
dependsOn: `S01`
files: `src/raft/types.ts`, `test/raft-types.test.ts`

interface:
```ts
// src/raft/types.ts
export interface LogEntry {
  index: number;   // 1-based
  term: number;
  command: unknown;
}

export type NodeRole = 'follower' | 'candidate' | 'leader';

export interface RaftPersistent {
  currentTerm: number;
  votedFor: string | null;
  log: LogEntry[];
}

export interface RaftVolatile {
  role: NodeRole;
  leaderId: string | null;
  commitIndex: number;
  lastApplied: number;
  // Leader-only:
  nextIndex: Record<string, number>;   // nodeId → next log index to send
  matchIndex: Record<string, number>;  // nodeId → highest replicated index
  votesReceived: Set<string>;
}

export type RaftMessage =
  | { type: 'RequestVote';   term: number; candidateId: string; lastLogIndex: number; lastLogTerm: number }
  | { type: 'RequestVoteReply'; term: number; voteGranted: boolean; voterId: string }
  | { type: 'AppendEntries'; term: number; leaderId: string; prevLogIndex: number; prevLogTerm: number; entries: LogEntry[]; leaderCommit: number }
  | { type: 'AppendEntriesReply'; term: number; success: boolean; followerId: string; matchIndex: number }
  | { type: 'ClientWrite'; command: unknown; clientId: string; requestSeq: number }
  | { type: 'Tick' };
```

how to implement:
1. Create `src/raft/types.ts` with the interfaces above.
2. Acceptance: `tsc --noEmit` passes. `test/raft-types.test.ts` constructs one of each message type and asserts the `type` field.

---

**`S04` — Raft election**
dependsOn: `S01`, `S03`
files: `src/raft/node.ts`, `test/raft-election.test.ts`

interface:
```ts
// src/raft/node.ts
export function createRaftNode(
  nodeId: string,
  peerIds: string[],
  sim: Simulator,
  electionTimeoutRange: [number, number], // [min, max] ticks
): void;
// Registers a message handler on sim for nodeId.
// On 'Tick': if follower and no heartbeat received in electionTimeout ticks, start election.
// On 'RequestVote': grant vote if term >= currentTerm and log is up-to-date; update currentTerm.
// On 'RequestVoteReply': collect votes; if majority, become leader.
// On 'AppendEntries' with empty entries: reset election timer (heartbeat).
```

how to implement:
1. Create `src/raft/node.ts`.
2. Election: on timeout, increment `currentTerm`, set `votedFor = self`, send `RequestVote` to all peers.
3. `RequestVote` granting rule: `term > currentTerm` OR (`term == currentTerm` and haven't voted). Plus: candidate's log is at least as up-to-date (higher last term, or same last term and longer log).
4. On becoming leader: send immediate `AppendEntries` (heartbeat) to all peers.

acceptance: `test/raft-election.test.ts`:
- 3-node cluster; tick until leader elected; assert exactly one leader.
- Split vote (even partition): eventually one leader via randomized timeouts.
- After partition heals, a valid leader is elected within bounded ticks.
- Only one leader per term (election safety).

---

**`S05` — Raft log replication + the current-term commit rule**
dependsOn: `S04`
files: `src/raft/node.ts` (extend), `test/raft-replication.test.ts`

interface: Extend `createRaftNode` to handle `AppendEntries` (non-heartbeat), `AppendEntriesReply`, and `ClientWrite`.

commit rule (implement exactly as stated in the spec):
```
A leader commits an entry at index i ONLY when:
  1. entries[i].term === currentTerm  (CURRENT term, not a prior term)
  2. matchIndex[node] >= i for a majority of nodes (including self)
When a current-term entry commits, all prior entries at lower indices also commit
(Log Matching Property makes them safe).
```

how to implement:
1. Extend `src/raft/node.ts`.
2. On `ClientWrite`: append `{ index: log.length+1, term: currentTerm, command }` to log; send `AppendEntries` to all peers.
3. On `AppendEntriesReply(success=true)`: update `matchIndex[followerId]`; find the highest index i where `matchIndex` majority AND `log[i].term === currentTerm`; set `commitIndex = i`.
4. On `AppendEntries`: check `prevLogIndex`/`prevLogTerm` consistency (reject if mismatch); append entries; update `commitIndex = min(leaderCommit, lastNewIndex)`.

acceptance: `test/raft-replication.test.ts`:
- Write 3 commands; all committed entries present on all nodes after `advanceTo`.
- **The Figure-8 scenario** (the critical test): 5-node cluster; leader L1 in term 1 replicates an entry to 2 followers but not the other 2 before crashing. L2 wins election in term 2, replicates a new entry to a majority (which does NOT include L1's old entry on a majority). L1's old entry is NOT committed. Only L2's term-2 entry commits. Assert `commitIndex` for the old entry is never set.
- Leader change mid-replication: client write commits exactly once despite a failover.

---

**`S06` — MVCC storage engine**
dependsOn: none (pure; no simulator dependency)
files: `src/storage/mvcc.ts`, `test/mvcc.test.ts`

interface:
```ts
export type Timestamp = number;  // logical, from simulator

export interface MVCCStore {
  write(key: string, value: string, ts: Timestamp): void;
  // Creates a new version (key, ts, value). Throws if ts <= max existing ts for key.

  read(key: string, snapshotTs: Timestamp): string | null;
  // Returns the value of the most-recent version with version.ts <= snapshotTs.
  // Returns null if no such version.

  readRange(keyMin: string, keyMax: string, snapshotTs: Timestamp): Array<{key: string; value: string}>;
  // All keys in [keyMin, keyMax] visible at snapshotTs.

  latestTs(key: string): Timestamp | null;
  // Highest timestamp among all versions for key, or null.

  gc(beforeTs: Timestamp): void;
  // Remove all versions strictly older than beforeTs except the most recent per key.
}

export function createMVCCStore(): MVCCStore;
```

how to implement:
1. Create `src/storage/mvcc.ts`.
2. Internal: `Map<string, Array<{ts: Timestamp; value: string}>>` sorted by ts ascending.
3. `read`: binary search for largest ts <= snapshotTs.
4. `gc`: for each key, keep the most recent version, remove others with ts < beforeTs.

acceptance: `test/mvcc.test.ts`:
- `write(k, v1, 10)` then `write(k, v2, 20)`: `read(k, 15)` = v1, `read(k, 20)` = v2.
- `read(k, 5)` before any write = null.
- `readRange` returns only keys visible at snapshotTs.
- `gc(15)` removes v1 but keeps v2.
- Writing at ts=10 when latest is ts=20 throws.

---

**`S07` — Single-partition transaction + snapshot isolation**
dependsOn: `S06`
files: `src/txn/transaction.ts`, `test/transaction-si.test.ts`

interface:
```ts
export interface Transaction {
  txnId: string;
  snapshotTs: Timestamp;
  writeSet: Map<string, string>;  // key → new value (staged, not committed)
  readSet: Map<string, Timestamp>;  // key → version timestamp read (for SSI)
  status: 'active' | 'committed' | 'aborted';
}

export interface TxnManager {
  begin(snapshotTs: Timestamp): Transaction;
  read(txn: Transaction, key: string): string | null;
  // Read from snapshotTs; buffer in readSet for SSI tracking.
  write(txn: Transaction, key: string, value: string): void;
  // Stage in writeSet; does not touch MVCCStore yet.
  commit(txn: Transaction, commitTs: Timestamp, store: MVCCStore): 'ok' | 'conflict';
  // Under SI: always 'ok' (no conflict check).
  // Apply writeSet to store at commitTs.
  abort(txn: Transaction): void;
}

export function createTxnManager(): TxnManager;
```

how to implement:
1. Create `src/txn/transaction.ts`.
2. `begin`: create transaction with `snapshotTs`, empty sets, status `'active'`.
3. `read`: check `writeSet` first (read-your-own-writes), then `store.read(key, snapshotTs)`.
4. `commit` under SI: apply all `writeSet` writes to `store` at `commitTs`; return `'ok'`.
5. `abort`: set `status = 'aborted'`.

acceptance: `test/transaction-si.test.ts`:
- T1 begins at ts=10, T2 begins at ts=10. Both read key k = "0". T1 writes k="1" commits at ts=20. T2 still reads k="0" (snapshot ts=10). T2 writes k="2" commits at ts=30 — both commits succeed (SI allows write skew). Assert both committed.
- Read-your-own-writes: write key in txn, read back → get the written value without committing.

---

**`S08` — Write skew demo + SSI prevention**
dependsOn: `S07`
files: `src/txn/ssi.ts`, `test/ssi.test.ts`

interface:
```ts
export function commitSSI(
  txn: Transaction,
  allActiveTxns: Transaction[],
  commitTs: Timestamp,
  store: MVCCStore,
): 'ok' | 'conflict';
// Serializable Snapshot Isolation conflict check:
// For each key K in txn.readSet:
//   if any OTHER committed transaction wrote K with commitTs in (txn.snapshotTs, commitTs]:
//     return 'conflict' (abort — dangerous read-write dependency detected).
// If no conflict: apply writeSet, return 'ok'.
```

how to implement:
1. Create `src/txn/ssi.ts`.
2. `commitSSI`: for each key in `readSet`, call `store.latestTs(key)`; if `latestTs > txn.snapshotTs` (written by another txn after our snapshot), return `'conflict'`.

acceptance: `test/ssi.test.ts`:
- **Write skew under SI**: two txns both read key `"balance"="100"` at ts=0; both decide to write `"50"` (each deducting 50). Both commit under SI → both succeed → balance reads "50" twice (write skew demonstrated). Assert both committed.
- **SSI prevents it**: same scenario using `commitSSI`. The second to commit detects the conflict → returns `'conflict'`. Only one commit succeeds. Assert store has exactly one final write.

---

**`S09` — 2PC multi-partition transaction**
dependsOn: `S07`, `S01`
files: `src/txn/two-phase-commit.ts`, `test/two-phase-commit.test.ts`

interface:
```ts
export interface Shard {
  shardId: string;
  store: MVCCStore;
}

export type TwoPCState = 'prewriting' | 'committed' | 'aborted' | 'resolving';

export interface TwoPCCoordinator {
  txnId: string;
  shards: Shard[];
  primaryKey: string;   // one key designated as the "lock" anchor (Percolator-style)
  writeSet: Map<string, string>;
  state: TwoPCState;
}

export function prepareWrite(coord: TwoPCCoordinator, store: MVCCStore, prepareTs: Timestamp): boolean;
// Phase 1: for each key in writeSet, write a "lock" marker to the store at prepareTs.
// Returns false if any key already has a conflicting lock (abort early).

export function commitWrite(coord: TwoPCCoordinator, store: MVCCStore, commitTs: Timestamp): void;
// Phase 2: replace lock markers with actual values; update primaryKey to 'committed'.

export function resolveOrphanedLocks(
  coord: TwoPCCoordinator,
  store: MVCCStore,
  now: Timestamp,
  lockTtl: number,
): 'committed' | 'aborted';
// Called when coordinator crashed post-prewrite:
// Check primaryKey in store. If primaryKey is 'committed' → replay commitWrite.
// If primaryKey lock is older than lockTtl → abort (clean up locks).
```

how to implement:
1. Create `src/txn/two-phase-commit.ts`.
2. Represent a lock as `write(key, "__LOCK__:txnId", prepareTs)`.
3. `commitWrite`: overwrite lock entries with actual values.
4. `resolveOrphanedLocks`: check primary key value; if it is `"__LOCK__:txnId"` and time > prepareTs + lockTtl → abort by deleting locks (write tombstones).

acceptance: `test/two-phase-commit.test.ts`:
- Normal flow: prepareWrite + commitWrite → all keys updated.
- Conflict: another txn writes one key between prewrite and commit → prepareWrite returns false.
- **Crash recovery**: call prepareWrite, skip commitWrite (simulate crash), then call resolveOrphanedLocks with expired TTL → state = 'aborted'. Locks cleaned up, original values preserved.

---

**`S10` — Idempotent client request deduplication**
dependsOn: `S04`
files: `src/raft/client-dedup.ts`, `test/client-dedup.test.ts`

interface:
```ts
export interface ClientRequest {
  clientId: string;
  requestSeq: number;  // monotonically increasing per client
  command: unknown;
}

export interface ClientDedupStore {
  getResult(clientId: string, requestSeq: number): unknown | null;
  recordResult(clientId: string, requestSeq: number, result: unknown): void;
}

export function createClientDedupStore(): ClientDedupStore;
// Used in Raft state machine: before applying a command, check dedup store.
// If already seen: return prior result. Else: apply and record.
```

how to implement:
1. Create `src/raft/client-dedup.ts` with a `Map<string, Map<number, unknown>>`.
2. `getResult(clientId, seq)`: look up `clientId → seq → result`.
3. `recordResult`: store.

acceptance: `test/client-dedup.test.ts`:
- First request `(c1, seq=1)` → `getResult` returns null; after `recordResult`, returns the value.
- Same `(c1, seq=1)` again → returns prior result (deduplication).
- Different seq → null (not deduplicated).

---

**`S11` — Stream processor: event-time windows + watermarks**
dependsOn: `S01`
files: `src/stream/types.ts`, `src/stream/window-processor.ts`, `test/window-processor.test.ts`

interface:
```ts
// src/stream/types.ts
export interface StreamEvent {
  eventTime: number;     // logical time from the event source
  processingTime: number; // logical time of arrival at processor
  key: string;           // group-by key
  value: string;
}

export interface Watermark { timestamp: number; }

export type StreamRecord = { kind: 'event'; event: StreamEvent } | { kind: 'watermark'; wm: Watermark };

export interface WindowResult {
  key: string;
  windowStart: number;
  windowEnd: number;
  events: StreamEvent[];
}

// src/stream/window-processor.ts
export interface WindowProcessor {
  ingest(record: StreamRecord): WindowResult[];
  // On 'watermark': fire all windows with windowEnd <= wm.timestamp; return results; discard fired windows.
  // On 'event': buffer in the appropriate window bucket. Late events (eventTime < current watermark) → discard.
  state(): Map<string, StreamEvent[]>;  // key → buffered events for current window
}

export function createWindowProcessor(windowSizeSeconds: number): WindowProcessor;
```

how to implement:
1. Create `src/stream/types.ts` and `src/stream/window-processor.ts`.
2. `WindowProcessor` maintains `Map<string, StreamEvent[]>` per key.
3. On event: compute `windowEnd = ceil(event.eventTime / windowSizeSeconds) * windowSizeSeconds`. Buffer under `key`.
4. On watermark: fire all windows where `windowEnd <= wm.timestamp`; return `WindowResult`s; clear those buckets.
5. Late events: if `eventTime < lastSeenWatermark.timestamp`, discard (don't add to buffer).

acceptance: `test/window-processor.test.ts`:
- Events e1(t=1), e2(t=3) in 5-second window; watermark(t=5) fires window → result contains both.
- Watermark at t=4 doesn't fire 5-second window.
- Late event (arrives after watermark t=5, with eventTime=3) → discarded.
- Two keys → two independent window results.

---

**`S12` — Stream checkpoint + restore**
dependsOn: `S11`
files: `src/stream/checkpoint.ts`, `test/stream-checkpoint.test.ts`

interface:
```ts
export interface CheckpointState {
  processorState: Map<string, StreamEvent[]>;
  lastWatermarkTs: number;
  inputOffset: number;  // how many records have been processed
}

export function takeCheckpoint(processor: WindowProcessor, lastWatermarkTs: number, inputOffset: number): CheckpointState;

export function restoreFromCheckpoint(checkpoint: CheckpointState, windowSizeSeconds: number): WindowProcessor;
// Creates a new WindowProcessor pre-loaded with checkpoint.processorState.
// Replaying records from inputOffset onwards must yield identical results.
```

how to implement:
1. Create `src/stream/checkpoint.ts`.
2. `takeCheckpoint`: snapshot `processor.state()`, record `lastWatermarkTs` and `inputOffset`.
3. `restoreFromCheckpoint`: create a new `WindowProcessor`, populate its state from `checkpoint.processorState`.

acceptance: `test/stream-checkpoint.test.ts` (the exactly-once test):
1. Process events 1–5 through the window processor; take a checkpoint at offset 5.
2. Process 2 more events; fire a watermark; capture `resultsA`.
3. Restore from checkpoint (offset 5). Replay events 1–7 but skip the first 5 (start from offset 5). Fire same watermark; capture `resultsB`.
4. Assert `resultsA` deeply equals `resultsB` — no double-count, no loss.

---

**`S13` — Simple cost-based query planner**
dependsOn: `S06`
files: `src/planner/query-plan.ts`, `src/planner/planner.ts`, `test/planner.test.ts`

interface:
```ts
// src/planner/query-plan.ts
export type PhysicalPlan =
  | { type: 'FullScan'; table: string; estimatedRows: number }
  | { type: 'IndexScan'; table: string; index: string; estimatedRows: number }
  | { type: 'Filter'; input: PhysicalPlan; predicate: string; selectivity: number }
  | { type: 'NestedLoopJoin'; outer: PhysicalPlan; inner: PhysicalPlan }
  | { type: 'HashJoin'; outer: PhysicalPlan; inner: PhysicalPlan };

export function estimateCost(plan: PhysicalPlan): number;
// FullScan: estimatedRows * 1.0
// IndexScan: estimatedRows * 0.1
// Filter: estimateCost(input) * selectivity
// Join: estimateCost(outer) + estimateCost(outer) * estimateCost(inner)

// src/planner/planner.ts
export interface QueryContext {
  tables: Record<string, { rowCount: number; indexes: string[] }>;
}

export interface SimpleQuery {
  table: string;
  filterColumn: string | null;
  filterSelectivity: number;  // 0.0–1.0; 0.01 = high selectivity (good for index)
  joinTable: string | null;
}

export function planQuery(query: SimpleQuery, ctx: QueryContext): PhysicalPlan;
// Decision rule:
//   If filterSelectivity < 0.1 AND the table has an index on filterColumn: use IndexScan.
//   Otherwise: FullScan.
//   If joinTable: wrap in a HashJoin (outer=filtered table, inner=FullScan of joinTable).
```

how to implement:
1. Create `src/planner/query-plan.ts` and `src/planner/planner.ts`.
2. `planQuery`: check selectivity and index availability; build the plan tree.
3. `estimateCost`: recursive cost computation.

acceptance: `test/planner.test.ts`:
- High-selectivity filter (0.01) + indexed column → `IndexScan`.
- Low-selectivity filter (0.9) → `FullScan`.
- Same table, same filter but no index → `FullScan` even with high selectivity.
- `estimateCost(IndexScan) < estimateCost(FullScan)` for same estimated row count.

---

**`S14` — Consensus safety property test (the most important test)**
dependsOn: `S04`, `S05`
files: `test/consensus-safety.property.test.ts`

how to implement:
1. Create `test/consensus-safety.property.test.ts`.
2. `runSafetyCheck(seed: number, faultSchedule: FaultSchedule)`:
   - Create 5-node cluster under the simulator with the given seed.
   - Apply faults: partition node 1 from nodes 2-3 at t=10; heal at t=30; crash node 4 at t=20; restart at t=40.
   - Issue 5 client writes at t=5, 8, 12, 15, 25.
   - Advance to t=200.
   - Collect all `commitIndex` values across nodes.
   - Collect all `log[i]` values across nodes for i <= commitIndex.
   - Assert: for every committed index i, ALL nodes that have log[i] have the SAME command. (State Machine Safety)
   - Assert: at most one leader per term at any point (scan the event log).
3. Run with 3 different seeds.

acceptance: All 3 seeds pass both invariants.

---

**`S15` — Full seed scenario integration test**
dependsOn: `S04`, `S05`, `S07`, `S08`, `S11`, `S12`, `S13`
files: `test/seed-scenario.test.ts`

how to implement:
1. Create `test/seed-scenario.test.ts`.
2. Run the following sequence in a single test (using the simulator):
   - 3-node cluster, seed=1.
   - Write 3 rows.
   - Partition node 1 from node 2 at t=20; write a row; assert it doesn't commit (no majority).
   - Heal partition at t=40; assert the row eventually commits.
   - Demonstrate write skew under SI (S08 fixture).
   - Demonstrate SSI prevents it.
   - Process 5 stream events; fire watermark; assert window result.
   - Take checkpoint; simulate crash; restore; replay last 2 events; assert same result (no double-count).
   - Run a query with high-selectivity filter → IndexScan chosen.
3. Assert all invariants pass: committed entries survive leader change; exactly-once stream; SSI prevents write skew.

acceptance: Test passes end-to-end with seed=1.

---

### 3. The decomposition method for the remaining breadth

After S01–S15 are green, apply this recipe for every remaining feature:

**Recipe for one feature cluster:**
1. Identify which F9 invariant it exercises.
2. Write the acceptance assertion first: "After X, invariant F9.N must hold."
3. Split into at most 3 cards: (a) types, (b) core logic, (c) simulator integration + property test.
4. Every card tests offline with `npm test`.

**Worked example 1 — Raft snapshots (InstallSnapshot)**
- Types card `SN01`: `Snapshot = { lastIncludedIndex, lastIncludedTerm, state: Record<string, string> }`.
- Logic card `SN02` dependsOn `S05`, `S06`: `takeSnapshot(commitIndex, log, store)` → `Snapshot`. `applySnapshot(snap, node)` truncates log and loads state.
- Integration card `SN03`: A follower that lags 100+ entries receives an `InstallSnapshot` message; assert it catches up and has identical committed state. Assert no entry before `lastIncludedIndex` is in the log.

**Worked example 2 — CRDT G-Counter (AP data)**
- Types card `CR01`: `GCounter = { counts: Record<string, number> }` (one slot per node ID).
- Logic card `CR02`: `increment(gc, nodeId)` → new counter. `merge(a, b)` → `{ counts: max(a[k], b[k]) for each k }`. `value(gc)` → `Σ counts`.
- Property test: generate any sequence of increments and merges; assert `merge(merge(a,b), c) equals merge(a, merge(b,c))` (associativity) and `merge(a, a) equals a` (idempotency). Assert `value` is the same regardless of merge order (strong eventual consistency).

**Worked example 3 — ReadIndex linearizable reads**
- Types card `RI01`: `ReadIndexRequest = { clientId, requestSeq, readKey }`.
- Logic card `RI02` dependsOn `S04`: In leader handler: on `ReadIndex`, record `pendingRead = { commitIndex: currentCommitIndex, readKey }`. Send a round of heartbeats (AppendEntries to majority). On receiving majority `AppendEntriesReply`, if `appliedIndex >= pendingRead.commitIndex`, serve the read from `store.read(readKey, commitTs)`. Otherwise defer.
- Test: leader receives a `ReadIndex` after a stale leader might exist; assert the read is not served until after the heartbeat round confirms leadership.

---

### 4. Per-task implementation conventions

**Folder layout**
```
src/
  sim/
    types.ts
    simulator.ts
  raft/
    types.ts
    node.ts
    client-dedup.ts
  storage/
    mvcc.ts
  txn/
    transaction.ts
    ssi.ts
    two-phase-commit.ts
  stream/
    types.ts
    window-processor.ts
    checkpoint.ts
  planner/
    query-plan.ts
    planner.ts
test/
  simulator.test.ts
  determinism.property.test.ts
  raft-types.test.ts
  raft-election.test.ts
  raft-replication.test.ts
  mvcc.test.ts
  transaction-si.test.ts
  ssi.test.ts
  two-phase-commit.test.ts
  client-dedup.test.ts
  window-processor.test.ts
  stream-checkpoint.test.ts
  planner.test.ts
  consensus-safety.property.test.ts
  seed-scenario.test.ts
```

**How to write a test in Vitest**
```ts
import { describe, it, expect } from 'vitest';
import { createMVCCStore } from '../src/storage/mvcc.js';

describe('mvcc', () => {
  it('reads correct version at snapshot', () => {
    const store = createMVCCStore();
    store.write('k', 'v1', 10);
    store.write('k', 'v2', 20);
    expect(store.read('k', 15)).toBe('v1');
    expect(store.read('k', 20)).toBe('v2');
  });
});
```

**Seeded LCG (copy into test files)**
```ts
function createLCG(seed: number) {
  let s = seed >>> 0;
  return () => { s = Math.imul(s, 1664525) + 1013904223 >>> 0; return s; };
}
```

**Keeping it deterministic**
- Simulator time is a `number` (integer ticks). Never `Date.now()`.
- Network partition: the simulator's `partitionLink` set is checked before delivery.
- Tests call `sim.advanceTo(N)` directly; no awaiting, no callbacks.
- Election timeouts are sampled from the seeded PRNG: `timeout = min + (prng() % (max - min))`.
- Stream event times are always fixed integers in test fixtures.

**Definition of done for any card**
1. `tsc --noEmit` exits 0.
2. `npm test` green.
3. No `any` in `src/`.
4. No `Date.now()`, `setTimeout`, `setInterval`, `Math.random()`, or async in `src/`.
5. Every acceptance assertion from the card is a named `it(...)` block.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — Using `async/await` or `setTimeout` in the simulator**
A 3B model will reach for `async function step()` and `await sleep(ms)`. This makes the test non-deterministic. The entire simulator is synchronous: `advanceTo(N)` is a while-loop processing the priority queue until all events with `scheduledAt <= N` are consumed. No Promises, no real timers, no async.

**Pitfall 2 — The current-term commit rule (the Figure-8 bug)**
A model will count replicas for *any* log entry and mark it committed when a majority has it. This is wrong. An old-term entry (from a prior leader) MUST NOT be committed by majority count — only the act of committing a *current-term* entry makes prior entries safe. The `test/raft-replication.test.ts` Figure-8 scenario tests this directly: the old-term entry should remain uncommitted even when a majority has it.

**Pitfall 3 — Treating write skew as a bug to prevent at the SI level**
A model will add conflict checking to `commit()` (the SI path) to prevent write skew. The spec explicitly says SI *allows* write skew (demonstrate it in `S07`); SSI *prevents* it (demonstrate that in `S08`). Keep SI and SSI as separate functions with separate test cases.

**Pitfall 4 — Stream processor using `Date.now()` for window boundaries**
Window boundaries are computed from `eventTime` (an integer from the stream), not from the system clock. A model will write `windowEnd = Date.now() + windowSizeMs`. Instead: `windowEnd = Math.ceil(event.eventTime / windowSizeSeconds) * windowSizeSeconds`. All integers.

**Pitfall 5 — Checkpoint-restore double-count**
A model will restore the processor, then replay ALL events from the beginning. This causes double-counting for events before the checkpoint. The restore must skip the first `inputOffset` events. The `test/stream-checkpoint.test.ts` test catches this: results after a proper restore must exactly equal results from a clean run.

**Pitfall 6 — 2PC coordinator crash leaves locks forever**
A model will prewrite locks but then not implement `resolveOrphanedLocks`. The 2PC test (`S09`) verifies that after a simulated coordinator crash and TTL expiry, locks are cleaned up and the original values are still readable. Forget this and the test for the crash-recovery case fails.

**Pitfall 7 — MVCC `read` returning a value from after the snapshot timestamp**
A model will return `latestVersion` unconditionally. The snapshot read must return the most-recent version with `ts <= snapshotTs`. The test in `S06` checks `read(k, 15)` returns v1 (ts=10) not v2 (ts=20).

**Pitfall 8 — Missing the property test for consensus safety**
A model will write example-based tests (one specific failure scenario) and not generalize. The `S14` property test runs 3 seeds. If only seed=1 is tested and the Figure-8 scenario uses seed=2, the bug goes undetected. Run all 3 seeds.
