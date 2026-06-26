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
