# 20 - Virtualized Microkernel Operating System and Hypervisor Lab

Complexity tier: 20/20
Expected decomposition size: 60+ dependent implementation cards before coding.
Domain pressure: operating systems, virtualization, CPU emulation, microkernels, memory management, filesystems, process scheduling, networking, debugging.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build a serious educational operating-system lab that runs inside a fully virtualized deterministic environment. The goal is not to boot Linux; it is to create a small VM, microkernel, userspace services, filesystem, scheduler, debugger, and test harness with real OS concepts and hard boundaries.

## Foundation release scope
The first serious buildout must include:
- Virtual machine, CPU core, instruction, register file, memory page, device, interrupt, process, thread, capability, syscall, filesystem node, packet, debugger session, and trace models.
- Tiny deterministic CPU emulator with fixed instruction set, registers, flags, memory access rules, traps, interrupts, privilege levels, and instruction trace output.
- Microkernel model with address spaces, capability-based handles, message passing IPC, process/thread lifecycle, scheduler, timer ticks, and syscall dispatch.
- Virtual memory subsystem with page tables, permissions, page faults, copy-on-write placeholder, shared memory, and memory-mapped device regions.
- Userspace service model for init, filesystem server, network server, device manager, and shell-like command runner inside the VM.
- Toy filesystem with block device abstraction, superblock, inode-like metadata, directory entries, file read/write, journaling-inspired recovery fixtures, and fsck checks.
- Network device simulation with frames, ARP-like neighbor table, IP-like packets, UDP-like datagrams, packet loss fixtures, and service routing.
- Debugger and observability tools for breakpoints, single-step, register/memory inspection, syscall trace, IPC graph, scheduler timeline, and crash dump.
- Program loader and assembler-like fixture format for tiny user programs, kernel tests, fault injection, and golden boot traces.
- Seed lab that boots init, mounts filesystem, starts services, sends IPC, runs a user program, handles page fault, writes a file, transmits a packet, and recovers from a simulated crash.

## Architecture requirements
- Separate emulator, kernel model, userspace services, device simulation, filesystem, network stack, debugger, and test harness.
- Every VM step must be deterministic and replayable from an initial image plus input events.
- Use explicit privilege and capability checks; never let userspace mutate kernel state directly.
- Keep the instruction set small but real enough for stack, calls, branches, memory, traps, and device IO.
- Design trace formats and golden tests as first-class product features.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- An operating system is a set of isolation, scheduling, memory, IO, and recovery contracts, not a command prompt UI.
- Virtualization requires a precise machine model and deterministic stepping.
- Microkernel design pushes filesystems, networking, and device managers into separate services communicating via IPC.
- Memory protection and capabilities are security boundaries, not optional validation helpers.
- Filesystem recovery and network simulation require fault injection and invariant checks.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Golden boot trace reaches init, starts services, runs a user program, and shuts down deterministically.
- CPU emulator tests cover arithmetic, branches, stack, traps, interrupts, privilege violation, and memory fault.
- Kernel tests cover process creation, IPC, scheduling, capability denial, timer preemption, and crash isolation.
- Virtual memory tests cover page permissions, page fault, shared mapping, and device mapping.
- Filesystem tests cover create, write, read, directory traversal, crash recovery fixture, and fsck invariant failure.
- Network tests cover frame delivery, loss, routing to service, and deterministic packet trace.
- Debugger tests cover breakpoint, single-step, register inspection, memory inspection, syscall trace, and replay from trace.
- The project passes npm test and the VM core makes no network, filesystem, or wall-clock calls outside injected adapters.

## Explicit non-goals
- Do not shell out to QEMU or use a real OS image for the foundation.
- Do not make a terminal-themed web app without a VM and kernel model.
- Do not collapse kernel and userspace state into one mutable object.
- Do not skip deterministic replay; it is the core acceptance mechanism.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is *capability non-forgeability under fully deterministic, replayable execution*: userspace can NEVER fabricate authority it was not granted — every access to every kernel object is mediated by an unforgeable capability — and the *entire* machine (CPU, MMU, kernel, services, devices) steps deterministically so that an identical initial image + identical input events reproduces a byte-identical instruction-and-syscall trace.** Memory protection and capabilities are "security boundaries, not optional validation helpers" (the spec's own words); the whole point of a microkernel is that isolation is *enforced by the machine*, not by trusting code — and the only way to prove that is a deterministic emulator whose every trap, fault, and IPC is replayable and assertable.

A real microkernel is a tiny, ruthlessly-disciplined arbiter. **seL4** — the first OS kernel with a machine-checked proof of functional correctness and security — is 8,700 lines of C + 600 of assembler, allocates **no memory after boot** (no heap, bounded stack), and mediates *all* authority through **unforgeable capabilities**: "an unforgeable token that both names a kernel object and encodes the operations that may be performed on it" ([seL4 — Wikipedia](https://en.wikipedia.org/wiki/SeL4); [seL4: Formal Verification of an OS Kernel, SOSP'09](https://www.sigops.org/s/conferences/sosp/2009/papers/klein-sosp09.pdf); [seL4.systems](https://sel4.systems/)). Its IPC descends from **L4**, where Liedtke showed IPC performance *is* the kernel — fast-path, register-passed, synchronous rendezvous with direct process switch ([L4 microkernel family — Wikipedia](https://en.wikipedia.org/wiki/L4_microkernel_family); [From L3 to seL4: 20 years of L4](https://flint.cs.yale.edu/cs428/doc/L3toseL4.pdf)). The teaching frame is **xv6 on RISC-V** — three privilege modes (machine/supervisor/user), page-table virtual memory, trap-based syscalls ([xv6 RISC-V book, MIT 6.S081](https://pdos.csail.mit.edu/6.S081/2023/xv6/book-riscv-rev3.pdf)). This extension grounds the lab in those real systems and makes the isolation and determinism *provable*.

## G0. The grading rubric (what actually makes this hard)

1. **Capability non-forgeability** — can you *prove* userspace never gains authority it wasn't explicitly granted, across every syscall, fault, and IPC?
2. **Deterministic replay** — does the same initial image + input events reproduce a byte-identical instruction/trap/syscall trace, every time?
3. **Privilege isolation** — can userspace *never* mutate kernel state directly; do privilege/permission violations trap precisely (right fault, right PC, right cause)?
4. **IPC correctness** — does message passing transfer exactly the data + capabilities intended, with correct rendezvous/blocking semantics, and no authority leak?
5. **Crash-recovery integrity** — does the filesystem recover to a consistent state after a crash at any point (journaling/fsck invariants hold)?

## G1. The deterministic machine model (the foundation under everything)

"Every VM step must be deterministic and replayable from an initial image plus input events" (the spec) — this is the spine; build it first (~the first 12–15 cards).

- **A tiny, real-enough ISA.** Fixed instruction set with registers, flags, arithmetic/logic, loads/stores, branches, **call/ret with a stack**, traps/`ecall`, and privileged instructions — enough for "stack, calls, branches, memory, traps, and device IO" (the spec). Model on **RV64I + a Zicsr-like CSR subset** (the instruction set teaching emulators use to run xv6), with three modes: machine / supervisor / user ([xv6 RISC-V book](https://pdos.csail.mit.edu/6.S081/2023/xv6/book-riscv-rev3.pdf); [rvemu — RISC-V emulator running xv6](https://github.com/d0iasm/rvemu); [Writing a RISC-V Emulator — CPU](https://book.rvemu.app/hardware-components/01-cpu.html)). Keep it small and *correct*, not broad.
- **Fetch–decode–execute as a pure stepper.** Each `step()` is a pure function of machine state → (next state, trace record). Instruction tracing tracks PC deltas and effects — a **golden instruction trace** is a first-class product artifact ([BRISC-V — browser teaching emulator](https://arxiv.org/pdf/1812.04077); [Efficient Trace for RISC-V](https://arxiv.org/pdf/2504.01972)).
- **All nondeterminism injected.** No wall-clock, no real I/O (explicit non-goal). Timer ticks, device interrupts, packet arrivals, and disk completion are *scheduled input events* on a logical-time queue. `run(image, events)` twice ⇒ identical trace (invariant #2). This is the deterministic-replay discipline that makes OS bugs reproducible.
- **Precise traps.** Arithmetic faults, illegal instructions, privilege violations, and memory faults trap with the exact cause, faulting PC, and trap value — precise enough that the debugger and golden tests can assert them (the spec's "privilege violation, and memory fault").

## G2. The capability system (the security spine — get this exactly right)

This is *the* defining subsystem. "Never let userspace mutate kernel state directly" and "capabilities are security boundaries" (the spec) become an seL4-grounded, non-forgeable capability model.

- **A capability is an unforgeable token** that *names a kernel object* and *encodes the rights* over it. Only the kernel can create or copy one; userspace holds *references*, never raw kernel pointers ([seL4 — Wikipedia](https://en.wikipedia.org/wiki/SeL4)).
- **Capabilities live in CNodes (capability space).** A process's authority is exactly the set of capabilities reachable in its **CNode** tree — a kernel-managed, hierarchical namespace (analogous to a filesystem) that *is itself* accessed only via a capability, enabling delegation/subdivision/revocation ([seL4 — Wikipedia, CNodes](https://en.wikipedia.org/wiki/SeL4)). A syscall names objects by **capability slot index**, never by address.
- **Untyped memory + retype is the allocation model** (and a beautiful teaching device). Free RAM after boot is handed to the root task as **untyped** capabilities; **retype** converts untyped memory into typed kernel objects (page tables, CNodes, endpoints, TCBs). The kernel never allocates after boot — "no heap, bounded stack" ([seL4 — Wikipedia, untyped/retype](https://en.wikipedia.org/wiki/SeL4); [seL4: Formal Verification, SOSP'09](https://www.sigops.org/s/conferences/sosp/2009/papers/klein-sosp09.pdf)). The model makes the memory lifecycle *explicit and auditable* instead of a hidden allocator.
- **Capability derivation tree + rights + revocation.** `mint`/`copy`/`grant` create derived capabilities (possibly with *reduced* rights — e.g. read-only); a **capability derivation tree (CDT)** records parent→child so a parent untyped region can only be reused after its derivatives are **revoked** ([seL4 — Wikipedia, CDT](https://en.wikipedia.org/wiki/SeL4)). This is the take-grant lineage: authority flows only along explicit grants.
- **The three security invariants — as property tests, not prose** ([seL4 — Wikipedia, invariants](https://en.wikipedia.org/wiki/SeL4)): **non-forgeability** (no capability exists without kernel authorization), **authority confinement** (a process can never exceed the authority of its held capabilities), and **integrity/confidentiality** (no access to an object without a capability for it). The spec's "capability denial" acceptance test is the *minimum*; the real bar is fuzzing authority confinement.

## G3. IPC: synchronous rendezvous + capability transfer (L4-grounded)

"Microkernel design pushes filesystems, networking, and device managers into separate services communicating via IPC" (the spec) — so IPC correctness is load-bearing for the *entire* userspace.

- **Synchronous endpoints with rendezvous semantics.** A send blocks until a receiver is ready (and vice-versa); the message is transferred at the rendezvous point. seL4 retains L4's rendezvous IPC but decouples message-passing from synchronization ([seL4 — Wikipedia, IPC](https://en.wikipedia.org/wiki/SeL4); [microkerneldude — how to use seL4 IPC](https://microkerneldude.org/2019/03/07/how-to-and-how-not-to-use-sel4-ipc/)).
- **Register-passed fast path + direct process switch.** Small messages pass in registers; the kernel performs a **direct process switch** from sender to receiver without touching the in-register payload (zero-copy) — Liedtke's core insight that "IPC performance is the master" ([L4 microkernel family — Wikipedia](https://en.wikipedia.org/wiki/L4_microkernel_family); [From L3 to seL4](https://flint.cs.yale.edu/cs428/doc/L3toseL4.pdf)). Model the fast path *and* the slow (copy) path.
- **IPC carries capabilities, gated by Grant + badges.** A message may include *capabilities*, not just data — IPC is the authority-delegation mechanism. Endpoints carry **badges** (a token identifying the sender's capability) so a server can distinguish clients without a full capability transfer ([seL4 — Wikipedia, badges](https://en.wikipedia.org/wiki/SeL4)). Capability transfer requires the **Grant** right — without it, only data crosses. **This is a critical leak surface:** an IPC must transfer *exactly* the intended capabilities and *no more* (invariant #4).

## G4. Virtual memory: page tables, faults, COW, shared/device mappings

"Memory protection and capabilities are security boundaries" — the MMU is where isolation becomes physical.

- **Multi-level page tables + permission bits.** Translation walks the page table; PTEs carry **R/W/X + User/Supervisor** bits; a TLB caches translations. A missing translation is a TLB miss the walker fills; a missing *page* is a true **page fault** trapping to the kernel ([thebeardsage — TLB](http://thebeardsage.com/virtual-memory-translation-lookaside-buffer-tlb/); [COMS W4118 — virtual memory](https://cs4118.github.io/www/2023-1/lect/20-virt-mem.html); [Wikipedia — TLB](https://en.wikipedia.org/wiki/Translation_lookaside_buffer)).
- **Protection faults are precise and enforced.** Writing a read-only page, or user code touching a supervisor-only page, triggers a protection fault with exact cause and faulting address ([COMS W4118 — protection/trap](https://cs4118.github.io/www/2023-1/lect/20-virt-mem.html)). Userspace cannot map kernel memory; the U/S bit is enforced by the emulator, not by convention.
- **Copy-on-write + shared memory + memory-mapped device regions.** A COW page is shared read-only until a write faults, which copies-then-remaps ([COMS W4118 — COW fault](https://cs4118.github.io/www/2023-1/lect/20-virt-mem.html)). Shared mappings let two address spaces map the same frame (with possibly different rights). MMIO regions map device registers into an address space — the bridge between the VM subsystem and device simulation. (The spec lists exactly: page permissions, page fault, shared mapping, device mapping.)
- **Address spaces are capability-controlled.** A page table is a kernel object retyped from untyped memory; mapping a frame requires capabilities for both — so VM is *inside* the capability model, not beside it.

## G5. The microkernel + scheduler (lifecycle, preemption, isolation)

- **Process/thread lifecycle as TCB objects** (retyped from untyped). Create/start/suspend/destroy; threads have priorities. **Timer-tick preemption** drives a priority scheduler; model L4's **lazy scheduling** insight as an optional optimization note (blocked-on-IPC threads left in the ready queue, requeued lazily) ([L4 microkernel family — Wikipedia, lazy scheduling](https://en.wikipedia.org/wiki/L4_microkernel_family)).
- **Syscall dispatch is the only kernel entry from user.** A user `ecall` traps to supervisor mode; the kernel validates the capability for the requested operation, performs it, returns. There is no other path into kernel state (the spec's "syscall dispatch" + "never let userspace mutate kernel state directly").
- **Crash isolation.** A faulting user thread is contained — its fault traps to the kernel (or a designated fault handler/pager), which can kill or restart it without corrupting the kernel or other processes (the spec's "crash isolation" acceptance test). This is the microkernel payoff: a service crash is recoverable, not fatal.

## G6. Userspace services + toy filesystem (journaling/fsck invariants)

Push real OS functions into userspace servers over IPC — init, filesystem server, network server, device manager, shell-runner (the spec).

- **A block-device-backed filesystem** with superblock, inode-like metadata, directory entries, and file read/write — accessed by user programs *only* through IPC to the FS server (capability-gated). 
- **Journaling-inspired crash consistency.** Model **write-ahead logging**: write a journal "note" describing an update *before* overwriting on-disk structures, so recovery can replay the log; data must be written before the metadata journal commits (**ordered writeback**) to avoid inodes pointing at garbage ([OSTEP — Crash Consistency: FSCK and Journaling](https://pages.cs.wisc.edu/~remzi/OSTEP/file-journaling.pdf); [Stanford CS111 — journaling FS project](https://www.scs.stanford.edu/21sp-cs111/proj/proj_log.html)). 
- **fsck as invariant checker.** After a crash fixture, `fsck` verifies consistency at every level — superblock, block bitmap, inode, directory content — exactly as real fsck does ([OSTEP — fsck](https://pages.cs.wisc.edu/~remzi/OSTEP/file-journaling.pdf); [andreybleme — crash consistency summary](https://andreybleme.com/2021-02-18/crash-consistency-fsck-and-journaling-summary/)). The spec's "fsck invariant failure" test deliberately corrupts state and asserts fsck *catches* it.

## G7. Network device simulation (deterministic packets)

Frames, an ARP-like neighbor table, IP-like packets, UDP-like datagrams, **packet-loss fixtures**, and routing to a service — all deterministic (the spec). A NIC is a memory-mapped device (G4) raising receive interrupts (scheduled input events, G1), so the network stack is just another userspace service over IPC. The acceptance test "deterministic packet trace" falls out of G1's replay discipline.

## G8. Debugger, trace, and golden-test harness (first-class product)

"Design trace formats and golden tests as first-class product features" (the spec).

- **Debugger over the deterministic machine:** breakpoints, single-step, register/memory inspection, **syscall trace**, **IPC graph**, **scheduler timeline**, crash dump — and **replay from a trace** (the spec's debugger acceptance list). Because execution is deterministic, time-travel debugging is free.
- **Golden traces everywhere.** The "golden boot trace" (init → mount FS → start services → IPC → run user program → page fault → write file → transmit packet → recover from crash) is the flagship acceptance artifact; CPU/kernel/VM/FS/net each get golden traces a change diffs against.

## G9. Adversarial & edge-case fixture pack (ship the hard cases)

- **The capability-forgery attempt.** A user program fabricates a capability slot index / a raw object reference and invokes a syscall; the kernel rejects it — authority confinement holds (G2).
- **The unauthorized-IPC capability leak.** A sender without the **Grant** right tries to pass a capability in a message; only data crosses, the capability does not (G3).
- **The privilege-escalation instruction.** User code executes a privileged/CSR instruction or jumps into kernel memory; precise privilege-violation trap, no state change (G1/G4).
- **The wild write.** A user store to a read-only or supervisor-only or unmapped page; precise page/protection fault at the exact PC (G4).
- **The COW race.** Two threads write a shared COW page; each gets its own private copy, neither sees the other's write (G4).
- **The crash-mid-journal.** A power-cut fixture injected *between* the journal write and the in-place update; recovery replays the journal to a consistent state; a crash *before* the journal commit leaves the old state intact — never a torn write (G6).
- **The fsck-catches-corruption.** A deliberately corrupted inode/bitmap; fsck detects and reports the specific invariant violation (G6).
- **The runaway thread.** A user thread spins / faults repeatedly; timer preemption keeps the system live and crash isolation contains it (G5).
- **The lost-packet retransmit.** A dropped frame (loss fixture); the stack behaves deterministically and the packet trace is stable (G7).

## G10. Property-based / invariant tests (the true acceptance bar)

1. **Capability non-forgeability** — over any sequence of syscalls/IPC, no process ever holds authority not derivable from its initial capabilities via legal mint/copy/grant/retype. (Fuzz authority confinement — this is the safety ratchet.) ([seL4 — Wikipedia, invariants](https://en.wikipedia.org/wiki/SeL4))
2. **Kernel-state isolation** — no user-mode instruction ever mutates kernel-owned memory or a kernel object except through a validated syscall.
3. **Privilege-mode safety** — every privileged instruction or supervisor-only access from user mode traps precisely; the U/S and R/W/X bits are always enforced.
4. **IPC fidelity** — a message transfers exactly the intended bytes + capabilities and no more; rendezvous blocking semantics hold (no message lost, none duplicated).
5. **Page-table soundness** — a successful translation implies a present PTE with sufficient rights; every insufficient-rights access faults.
6. **Determinism** — `run(image, events)` twice ⇒ byte-identical instruction/trap/syscall trace.
7. **Crash consistency** — after a crash injected at *any* step, the filesystem recovers (journal replay) to a state fsck declares consistent; no committed write lost, no torn write exposed.
8. **Scheduler liveness + isolation** — under preemption, no ready thread starves indefinitely (with fair priorities), and a faulting thread never corrupts another.
9. **Boot determinism** — the golden boot trace is reproduced exactly from the initial image.

## G11. The concrete first vertical slice (the on-ramp — build THIS first, ~60+ cards, but in this order)

Prove the machine + capability + isolation spine before breadth:

1. **The deterministic CPU emulator** (G1): ISA, registers, flags, stack/call/ret, precise traps, instruction trace, `run(image, events)`. Invariants #2, #6.
2. **Privilege levels + MMU** (G4): user/supervisor modes, page tables, R/W/X + U/S enforcement, precise page/protection faults. Invariants #3, #5.
3. **The capability system** (G2): capabilities, CNodes, untyped + retype, mint/copy/grant + CDT + revoke. Invariants #1, #2 (kernel-state isolation).
4. **Syscall dispatch + process/thread + scheduler** (G5): TCBs from untyped, timer preemption, crash isolation. Invariant #8.
5. **Synchronous IPC** (G3): endpoints, rendezvous, register fast path, capability transfer gated by Grant + badges. Invariant #4.
6. **One userspace service + toy FS with journaling** (G6): init starts an FS server; a user program writes a file via IPC; crash-and-recover; fsck. Invariant #7.
7. **The golden boot trace green** end-to-end (init → mount → services → IPC → user program → page fault → write file → transmit packet → recover), with all invariants holding, including the capability-forgery refusal and a crash-recovery. Invariant #9.

If that slice holds, the network stack, richer filesystem, more devices, and the operator/debugger UI are breadth on a *provably isolated, deterministically replayable* machine.

## G12. Domain knowledge-debt to track

- **Exact ISA semantics + privileged-architecture corner cases** — the lab models a *real-enough* RISC-V-like subset; full RV64GC, the complete privileged spec, and exact CSR behavior are flagged debt with xv6/RISC-V as the reference ([xv6 RISC-V book](https://pdos.csail.mit.edu/6.S081/2023/xv6/book-riscv-rev3.pdf)).
- **Capability-model completeness vs seL4** — model non-forgeability, CNodes, untyped/retype, CDT/revoke, and IPC capability transfer; seL4's full object set, scheduling-context capabilities, and the formal proof obligations are expert-review territory ([seL4: Formal Verification, SOSP'09](https://www.sigops.org/s/conferences/sosp/2009/papers/klein-sosp09.pdf)).
- **Covert/timing channels** — capability isolation controls *explicit* authority; microarchitectural timing channels (and seL4's "time protection" work) are explicitly out of scope and flagged ([Time Protection: the Missing OS Abstraction](https://arxiv.org/pdf/1810.05345)).
- **Journaling modes (metadata vs full-data, ordered vs writeback)** — the lab models WAL + ordered writeback; the full ext4-style journaling-mode matrix is debt ([OSTEP — journaling](https://pages.cs.wisc.edu/~remzi/OSTEP/file-journaling.pdf)).
- **Real-hardware fidelity** — no QEMU, no real OS image (hard non-goal); any future hardware-accurate backend is a production adapter, not a foundation requirement.

## G13. Why this is a great !Klein challenge

This is the apex determinism-and-isolation test in the batch. An OS kernel is the place where a confident-but-wrong line from a weak model silently destroys an isolation boundary — and the antidote is entirely structural: a fully deterministic machine where *every* trap, fault, and IPC is replayable, and machine-checkable invariants (capability non-forgeability, kernel-state isolation, privilege-mode safety, crash consistency) that a bluff *cannot* satisfy. The capability-forgery refusal, the IPC capability-leak guard, the precise privilege trap, and the crash-mid-journal recovery are exactly the seams agents hand-wave, and the property tests make hand-waving fail loudly. It decomposes in strict, satisfying dependency order (emulator → MMU → capabilities → syscalls/scheduler → IPC → FS/recovery), each layer a hard boundary built on the last. The payoff is a tiny, *correct*, replayable microkernel whose isolation is enforced by the machine and provable by replay — the definitive demonstration that small, governed, decomposed agents can build the most safety-critical software there is, because the structure (not the model's cleverness) carries the correctness. That is precisely the thesis !Klein exists to prove.
