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

---

## Small-model build guide (3B-ready)

### 1. Glossary & ground rules

**Domain terms**
- **ISA** — Instruction Set Architecture. The fixed vocabulary of machine instructions the CPU executes. This project uses a minimal RISC-V-like ISA with ~20 instruction types: arithmetic, loads, stores, branches, call/ret, `ecall` (trap to kernel), and a handful of privileged instructions.
- **Register file** — the CPU's set of fast integer registers (`x0`–`x15` for this 16-register subset; `x0` is always 0). `SP` = x14 (stack pointer), `RA` = x13 (return address).
- **PC** — Program Counter. Points to the next instruction to execute.
- **Mode** — the CPU's privilege level: `user` (ring 3 equivalent) or `supervisor` (kernel). Privileged instructions and kernel-mapped memory are illegal in user mode.
- **Trap** — the mechanism by which the CPU switches from user mode to supervisor mode in response to an `ecall`, illegal instruction, or memory fault. The trap handler records the cause and faulting PC.
- **Precise trap** — each trap records the exact instruction that caused it (the faulting PC), the exact cause (`ILLEGAL_INSTRUCTION`, `ECALL`, `PAGE_FAULT`, `PROTECTION_FAULT`), and any fault value (faulting address for memory traps). No vague "something went wrong."
- **Page table** — the kernel's mapping from virtual page numbers to physical frame numbers, plus permission bits (R/W/X and User/Supervisor). A missing entry or insufficient-rights access traps to the kernel.
- **Capability** — an unforgeable kernel-managed token that *names* a kernel object and *encodes* the allowed rights over it (`READ`, `WRITE`, `EXECUTE`, `GRANT`). Userspace holds slot indexes into its CNode; the kernel maps slots to actual capabilities.
- **CNode** — a kernel object that is an array of capability slots. A process's authority is exactly the set of capabilities reachable in its CNode tree. Accessing the CNode itself requires a capability.
- **Untyped memory** — free physical frames handed to the root task as untyped capabilities at boot. The only way to create new kernel objects is to `retype` an untyped capability into a typed object (Page, CNode, Endpoint, TCB). The kernel allocates no memory after boot.
- **Retype** — convert an untyped capability into a typed kernel object. The caller supplies the untyped cap + desired type + target CNode slot. On success, the slot holds a new capability for the typed object.
- **CDT (Capability Derivation Tree)** — a tree tracking parent→child capability relationships. A `mint`/`copy` creates a child with ≤ parent's rights. `revoke(parent)` deletes all children. An untyped region can only be retyped after all its children are revoked.
- **Endpoint** — a kernel IPC object. Threads `send` and `receive` on endpoints. Sending blocks until a receiver is ready (and vice versa) — synchronous rendezvous.
- **Badge** — a word attached to a capability to an endpoint, set by the kernel at `mint` time. When a message arrives at a server, the badge identifies which client sent it. Unforgeable.
- **Journal** — in the filesystem, a write-ahead log. Before overwriting on-disk data structures, the change is written to the journal. If the system crashes, the journal is replayed to restore consistency.
- **fsck** — filesystem consistency checker. Verifies the superblock, block bitmap, inode table, and directory entries. Reports any inconsistency as a typed error.
- **Golden trace** — a machine-readable record of every instruction executed, every trap raised, and every syscall dispatched, in order. Tests compare against golden traces to detect regressions.

**Stack**
- Language: TypeScript (strict, no `any`)
- Runtime: Node.js 20+
- Test runner: Vitest (`npm test` = `vitest run`)
- No real processes, no QEMU, no real OS images (explicit non-goal)
- All machine state is TypeScript objects; `step()` is a pure function
- All I/O events (timer ticks, disk completions, packet arrivals) are injected via an event queue
- Fixtures in `src/fixtures/` as `export const` TypeScript objects

**Acceptance command**
```
npm test        # vitest run — green, no skipped tests
```

**Determinism rules (imperative)**
1. `step(machineState, event)` is a pure function: same input → same output, always.
2. No `Date.now()`, `Math.random()`, `setTimeout`, or `process.env` reads in `src/`.
3. Timer ticks and device interrupts are injected as typed events on the input queue — never generated internally.
4. All physical memory is a fixed `Uint8Array` or `number[]` allocated at machine creation; no dynamic allocation after boot inside the emulator.

---

### 2. The explicit task graph for the first vertical slice

The first slice targets G11 items 1–7 in strict dependency order. Every card is independently testable before the next is started.

---

**`S01` — ISA types + register file**
dependsOn: none
files: `src/cpu/isa.ts`, `src/cpu/registers.ts`, `test/registers.test.ts`

interface:
```ts
// src/cpu/isa.ts
export type Register = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export const SP: Register = 14;
export const RA: Register = 13;
export const ZERO: Register = 0;

export type Opcode =
  | 'ADD' | 'SUB' | 'AND' | 'OR' | 'XOR' | 'SLL' | 'SRL'  // R-type
  | 'ADDI' | 'LI'                                             // I-type
  | 'LW' | 'SW'                                              // memory
  | 'BEQ' | 'BNE' | 'BLT' | 'BGE'                          // branches
  | 'JAL' | 'JALR'                                           // jumps
  | 'ECALL'                                                  // trap to supervisor
  | 'MRET'                                                   // return from supervisor trap (privileged)
  | 'NOP';

export type CauseCode =
  | 'ECALL_USER'
  | 'ILLEGAL_INSTRUCTION'
  | 'PAGE_FAULT_READ'
  | 'PAGE_FAULT_WRITE'
  | 'PROTECTION_FAULT'
  | 'BREAKPOINT';

export type Mode = 'user' | 'supervisor';

export interface Instruction {
  op: Opcode;
  rd?: Register;   // destination
  rs1?: Register;  // source 1
  rs2?: Register;  // source 2
  imm?: number;    // immediate value (signed 16-bit)
}

// src/cpu/registers.ts
export interface RegisterFile {
  regs: number[];        // 16 elements; regs[0] always reads 0
  pc: number;
  mode: Mode;
  // Supervisor-mode trap state:
  sepc: number;           // PC at trap time
  scause: CauseCode | null;
  stval: number;          // trap value (faulting address, etc.)
  stvec: number;          // trap vector (supervisor trap handler PC)
}

export function createRegisterFile(stvec: number): RegisterFile;
// All regs = 0; pc = 0; mode = 'user'; sepc/stval = 0; scause = null.

export function readReg(rf: RegisterFile, r: Register): number;
// Reads reg[r]; returns 0 for r=0 always.

export function writeReg(rf: RegisterFile, r: Register, value: number): RegisterFile;
// Returns a NEW RegisterFile with reg[r] = value (immutable).
// r=0 writes are silently discarded (returns rf unchanged).
```

how to implement:
1. Create `src/cpu/isa.ts` with the types.
2. Create `src/cpu/registers.ts`.
3. `readReg`: if `r === 0` return 0, else return `rf.regs[r]`.
4. `writeReg`: if `r === 0` return `rf` unchanged; else return `{ ...rf, regs: rf.regs.map((v, i) => i === r ? value : v) }`.

acceptance: `test/registers.test.ts`:
- `writeReg(rf, 0, 42)` → `readReg(result, 0) === 0` (x0 immutable).
- `writeReg(rf, 1, 99)` → `readReg(result, 1) === 99`.
- `writeReg` returns a new object (immutable — original unchanged).
- `createRegisterFile(0x1000).stvec === 0x1000`.

---

**`S02` — Physical memory model**
dependsOn: none (independent)
files: `src/cpu/memory.ts`, `test/memory.test.ts`

interface:
```ts
export interface PhysicalMemory {
  size: number;         // total bytes
  data: Uint8Array;
}

export function createMemory(sizeBytes: number): PhysicalMemory;

export function loadWord(mem: PhysicalMemory, addr: number): number;
// Reads a 32-bit little-endian word at addr.
// Throws MemoryAccessError if addr is out of bounds or misaligned (addr % 4 !== 0).

export function storeWord(mem: PhysicalMemory, addr: number, value: number): void;
// Writes a 32-bit little-endian word at addr.
// Throws MemoryAccessError if out of bounds or misaligned.

export class MemoryAccessError extends Error {
  constructor(public readonly addr: number, public readonly reason: 'out_of_bounds' | 'misaligned') {
    super(`Memory access error at 0x${addr.toString(16)}: ${reason}`);
  }
}
```

how to implement:
1. Create `src/cpu/memory.ts`.
2. `loadWord`: check `addr + 3 < size` and `addr % 4 === 0`; read 4 bytes little-endian.
3. `storeWord`: same checks; write 4 bytes little-endian.
4. Use `Uint8Array` for the backing store.

acceptance: `test/memory.test.ts`:
- Write 0xDEADBEEF at address 8; read back → 0xDEADBEEF.
- Misaligned access (addr=1) → throws `MemoryAccessError` with reason `'misaligned'`.
- Out-of-bounds access → throws with reason `'out_of_bounds'`.
- Memory is zero-initialized.

---

**`S03` — CPU stepper (fetch-decode-execute, no MMU yet)**
dependsOn: `S01`, `S02`
files: `src/cpu/stepper.ts`, `src/fixtures/programs.ts`, `test/stepper.test.ts`

interface:
```ts
export interface MachineState {
  regs: RegisterFile;
  mem: PhysicalMemory;
}

export type TrapResult = {
  kind: 'trap';
  cause: CauseCode;
  epc: number;    // PC of the faulting instruction
  tval: number;   // additional info (faulting address, bad instruction, etc.)
};

export type StepResult =
  | { kind: 'ok'; nextState: MachineState; traceRecord: TraceRecord }
  | TrapResult;

export interface TraceRecord {
  pc: number;
  instruction: Instruction;
  regsBefore: number[];
  regsAfter: number[];
  memWriteAddr: number | null;
  memWriteValue: number | null;
}

export function step(state: MachineState): StepResult;
// 1. Fetch: loadWord(mem, pc) → raw instruction word.
// 2. Decode: parse the word into an Instruction.
// 3. Execute: compute next register file and memory state.
//    - ECALL from user mode: return trap { cause: 'ECALL_USER', epc: pc, tval: 0 }.
//    - MRET from user mode: return trap { cause: 'ILLEGAL_INSTRUCTION', epc: pc, tval: 0 }.
//    - Memory access with ADDI sp,-4 etc.: normal (no MMU yet — all addresses are physical).
// 4. Return { kind: 'ok', nextState: { regs: ..., mem: ... }, traceRecord }.
```

how to implement:
1. Create `src/cpu/stepper.ts`.
2. Encode instructions as 32-bit words: bits [6:0] = opcode enum index; bits [10:7] = rd; bits [14:11] = rs1; bits [18:15] = rs2; bits [31:19] = imm13 (signed).
3. `step`: fetch instruction word at pc; decode; dispatch on opcode; compute next state.
4. `ECALL`: return `TrapResult` immediately without advancing PC.
5. `MRET` in user mode: return `TrapResult { cause: 'ILLEGAL_INSTRUCTION' }`.
6. `NOP`: pc += 4.
7. Create `src/fixtures/programs.ts` with a small program array (3–5 instructions) that adds two registers and stores the result.

acceptance: `test/stepper.test.ts`:
- Execute `LI x1, 5; LI x2, 3; ADD x3, x1, x2; NOP` → `regs[3] === 8`.
- `ECALL` in user mode → `TrapResult` with `cause: 'ECALL_USER'`.
- `MRET` in user mode → `TrapResult` with `cause: 'ILLEGAL_INSTRUCTION'`.
- `SW` to address 0 writes the value; `LW` reads it back.
- Same program + same initial state → identical trace records (determinism).

---

**`S04` — Page table + MMU (virtual→physical translation)**
dependsOn: `S01`, `S02`
files: `src/vm/page-table.ts`, `src/vm/mmu.ts`, `test/mmu.test.ts`

interface:
```ts
// src/vm/page-table.ts
export type PagePermissions = {
  read: boolean;
  write: boolean;
  execute: boolean;
  user: boolean;       // false = supervisor-only
};

export interface PageTableEntry {
  physicalFrame: number;  // physical frame number (page index)
  permissions: PagePermissions;
  present: boolean;
}

export interface PageTable {
  entries: Map<number, PageTableEntry>;  // virtual page number → PTE
  pageSize: number;                       // always 4096
}

export function createPageTable(): PageTable;
export function mapPage(pt: PageTable, virtualPage: number, entry: PageTableEntry): void;
export function unmapPage(pt: PageTable, virtualPage: number): void;

// src/vm/mmu.ts
export type TranslationResult =
  | { ok: true;  physicalAddr: number }
  | { ok: false; cause: 'PAGE_FAULT_READ' | 'PAGE_FAULT_WRITE' | 'PROTECTION_FAULT'; faultAddr: number };

export function translateAddress(
  pt: PageTable,
  virtualAddr: number,
  accessType: 'read' | 'write' | 'execute',
  mode: Mode,
): TranslationResult;
// 1. Compute virtualPage = floor(virtualAddr / pageSize), offset = virtualAddr % pageSize.
// 2. Look up PTE; if not present → { ok: false, cause: 'PAGE_FAULT_READ' or 'PAGE_FAULT_WRITE' }.
// 3. Check permissions:
//    - write access on non-write page → PROTECTION_FAULT.
//    - execute access on non-execute page → PROTECTION_FAULT.
//    - user mode accessing !user page → PROTECTION_FAULT.
//    - supervisor mode: can access any page (no U/S restriction on kernel).
// 4. Physical = physicalFrame * pageSize + offset.
```

how to implement:
1. Create `src/vm/page-table.ts` and `src/vm/mmu.ts`.
2. `translateAddress`: virtual page lookup → permission checks → physical address.
3. No TLB cache needed for the first slice (the test doesn't require it).

acceptance: `test/mmu.test.ts`:
- Map virtual page 0 → physical frame 5 with RWX+user; translate vaddr=16 → physAddr = 5*4096 + 16.
- Unmapped page → `PAGE_FAULT_READ` or `PAGE_FAULT_WRITE`.
- Write to read-only page → `PROTECTION_FAULT`.
- User mode accessing supervisor-only page → `PROTECTION_FAULT`.
- Supervisor mode accessing user page → ok (no restriction).

---

**`S05` — MMU-aware stepper + trap dispatch**
dependsOn: `S03`, `S04`
files: `src/cpu/mmu-stepper.ts`, `test/mmu-stepper.test.ts`

interface:
```ts
export interface VMachineState {
  regs: RegisterFile;
  mem: PhysicalMemory;
  pageTable: PageTable;
}

export type VMStepResult =
  | { kind: 'ok'; nextState: VMachineState; traceRecord: TraceRecord }
  | { kind: 'trap'; cause: CauseCode; epc: number; tval: number };

export function vmStep(state: VMachineState): VMStepResult;
// Like step() but all memory accesses go through translateAddress.
// If translation fails: return trap with the cause and faulting virtual address as tval.
// On ECALL: return trap { cause: 'ECALL_USER', epc: pc, tval: 0 }.
// After a trap, PC is NOT advanced (the kernel handler decides where to resume).
```

how to implement:
1. Create `src/cpu/mmu-stepper.ts`.
2. `vmStep`: call the decode step from `S03`; for LW/SW instructions, call `translateAddress` before accessing physical memory; if translation fails, return the trap.
3. For instruction fetch: translate `pc` with `accessType: 'execute'`; if fails, return `PAGE_FAULT` trap.

acceptance: `test/mmu-stepper.test.ts`:
- LW from an unmapped virtual address → trap `PAGE_FAULT_READ`, tval = virtual address.
- SW to a read-only page → trap `PROTECTION_FAULT`, tval = virtual address.
- User mode jumping to a supervisor-only page (execute) → `PROTECTION_FAULT`.
- Normal instruction on a mapped, permitted page → `{ kind: 'ok' }`.

---

**`S06` — Capability types + CNode**
dependsOn: none (pure types and logic, no CPU dependency)
files: `src/kernel/capability.ts`, `src/kernel/cnode.ts`, `test/capability.test.ts`

interface:
```ts
// src/kernel/capability.ts
export type CapabilityRight = 'READ' | 'WRITE' | 'EXECUTE' | 'GRANT';
export type KernelObjectType = 'Untyped' | 'Page' | 'CNode' | 'Endpoint' | 'TCB';

export interface Capability {
  capId: string;       // unique kernel-assigned ID
  objectType: KernelObjectType;
  objectRef: string;   // references a kernel object by ID
  rights: Set<CapabilityRight>;
  badge: number;       // 0 for non-endpoint caps
  parentCapId: string | null;  // CDT parent
}

export type SlotIndex = number;

// src/kernel/cnode.ts
export interface CNode {
  cnodeId: string;
  slots: Map<SlotIndex, Capability>;  // slot → capability
}

export interface CapabilityStore {
  // The kernel's authoritative map of all capabilities.
  allCaps: Map<string, Capability>;  // capId → Capability
  cnodes: Map<string, CNode>;        // cnodeId → CNode

  createCap(type: KernelObjectType, objectRef: string, rights: Set<CapabilityRight>, badge: number, parentCapId: string | null): Capability;
  installCap(cnodeId: string, slot: SlotIndex, cap: Capability): void;
  lookupCap(cnodeId: string, slot: SlotIndex): Capability | null;
  revoke(capId: string): void;  // removes cap and all CDT children
}

export function createCapabilityStore(): CapabilityStore;
```

how to implement:
1. Create `src/kernel/capability.ts` and `src/kernel/cnode.ts`.
2. `createCap`: generate a unique `capId` (sequential counter — deterministic, not UUID), store in `allCaps`.
3. `installCap`: store in the CNode's slot map.
4. `lookupCap`: look up CNode, then slot.
5. `revoke(capId)`: find all caps in `allCaps` where `parentCapId` is a descendant of `capId` (BFS); delete them all plus the root.

acceptance: `test/capability.test.ts`:
- `createCap` → cap has unique `capId`.
- `installCap` then `lookupCap` → returns the installed capability.
- `lookupCap` on empty slot → `null`.
- `revoke(parent)`: parent and all children removed from `allCaps`; sibling caps unaffected.
- Capability rights reduction: a child cap has rights ⊆ parent rights (checked at install time — throw if child claims rights parent doesn't have).

---

**`S07` — Untyped memory + retype**
dependsOn: `S06`
files: `src/kernel/untyped.ts`, `test/untyped.test.ts`

interface:
```ts
export interface UntypedRegion {
  startFrame: number;   // physical frame number
  frameCount: number;
  capId: string;        // the untyped capability ID
  children: string[];   // capIds of objects retyed from this region
}

export interface RetypeArgs {
  untypedCapId: string;
  newType: Exclude<KernelObjectType, 'Untyped'>;
  targetCnodeId: string;
  targetSlot: SlotIndex;
  objectId: string;       // caller-assigned ID for the new kernel object
}

export function retype(
  args: RetypeArgs,
  capStore: CapabilityStore,
  untypedRegions: Map<string, UntypedRegion>,
): void;
// 1. Look up the untyped region by capId. Throw if not found or capId doesn't point to an Untyped cap.
// 2. Create a new Capability of newType, objectRef = objectId, full rights, parentCapId = untypedCapId.
// 3. Install in targetCnodeId/targetSlot.
// 4. Add the new capId to region.children.
// Note: no allocator size tracking for first slice; assume one retype per untyped region.
```

how to implement:
1. Create `src/kernel/untyped.ts`.
2. `retype`: validate untyped cap; create typed cap; install; record child.

acceptance: `test/untyped.test.ts`:
- `retype` untyped → Page cap installed in target slot.
- `retype` to CNode → CNode cap installed.
- `retype` on a non-untyped cap → throws.
- After retype, `region.children` contains the new capId.
- Revoking the untyped cap also revokes the child cap (via CDT).

---

**`S08` — Process/thread lifecycle (TCBs) + scheduler**
dependsOn: `S05`, `S07`
files: `src/kernel/process.ts`, `src/kernel/scheduler.ts`, `test/scheduler.test.ts`

interface:
```ts
// src/kernel/process.ts
export type ThreadStatus = 'ready' | 'running' | 'blocked_recv' | 'blocked_send' | 'dead';

export interface TCB {
  tcbId: string;
  priority: number;         // 0 (lowest) to 255 (highest)
  regs: RegisterFile;       // saved register state when not running
  pageTableId: string;      // which address space this thread runs in
  cnodeId: string;          // capability space
  status: ThreadStatus;
  faultHandlerCap: string | null;  // cap to notify on fault
}

// src/kernel/scheduler.ts
export interface Scheduler {
  addThread(tcb: TCB): void;
  removeThread(tcbId: string): void;
  pick(): TCB | null;       // returns highest-priority ready thread; null if none
  setStatus(tcbId: string, status: ThreadStatus): void;
  timerTick(): TCB | null;  // preempt if a higher-priority thread is now ready
}

export function createScheduler(): Scheduler;
```

how to implement:
1. Create `src/kernel/process.ts` and `src/kernel/scheduler.ts`.
2. `pick`: return the `TCB` in status `'ready'` with the highest `priority`; ties broken by insertion order (FIFO).
3. `timerTick`: call `pick`; if the returned thread has higher priority than current, return it (preempt).

acceptance: `test/scheduler.test.ts`:
- Two ready threads priority 5 and 10 → `pick()` returns the priority-10 thread.
- After priority-10 thread blocks, `pick()` returns priority-5.
- `timerTick` with a higher-priority thread newly ready → returns that thread.
- `pick()` with no ready threads → `null`.

---

**`S09` — Syscall dispatch + capability gate**
dependsOn: `S05`, `S08`
files: `src/kernel/syscall.ts`, `test/syscall.test.ts`

interface:
```ts
export type SyscallNumber =
  | 0  // YIELD
  | 1  // SEND (endpoint, message words, capSlot or -1)
  | 2  // RECV (endpoint)
  | 3  // RETYPE (untypedCapSlot, newType, targetCnodeSlot, objectId)
  | 4  // MAP_PAGE (pageCapSlot, virtualPage, permissions)
  | 5  // EXIT;

export interface SyscallContext {
  tcb: TCB;
  capStore: CapabilityStore;
  scheduler: Scheduler;
  // regs.x1 = syscall number; x2..x5 = arguments
}

export type SyscallResult =
  | { ok: true; returnValue: number }
  | { ok: false; cause: 'CAPABILITY_DENIED'; capSlot: number; requiredRight: CapabilityRight };

export function dispatchSyscall(ctx: SyscallContext): SyscallResult;
// 1. Read syscall number from ctx.tcb.regs.regs[1].
// 2. Look up the required capability (slot from regs[2]) in ctx.tcb.cnodeId.
// 3. If capability is null or lacks the required right → return CAPABILITY_DENIED.
// 4. Dispatch to handler.
// YIELD: setStatus(tcb, 'ready'); return ok.
// EXIT: setStatus(tcb, 'dead'); return ok.
// Other syscalls: stub returning ok for first slice.
```

how to implement:
1. Create `src/kernel/syscall.ts`.
2. `dispatchSyscall`: check syscall number from regs; look up capability; check rights; dispatch.
3. For YIELD and EXIT: implement fully. For SEND/RECV/RETYPE/MAP_PAGE: stub returning `{ ok: true, returnValue: 0 }`.

acceptance: `test/syscall.test.ts`:
- YIELD syscall: thread status becomes `'ready'`.
- EXIT syscall: thread status becomes `'dead'`.
- Syscall with an empty capability slot → `CAPABILITY_DENIED`.
- Syscall with a capability lacking the required right → `CAPABILITY_DENIED`.

---

**`S10` — IPC endpoint + synchronous rendezvous**
dependsOn: `S08`, `S09`
files: `src/kernel/ipc.ts`, `test/ipc.test.ts`

interface:
```ts
export interface IPCMessage {
  words: number[];             // up to 4 data words
  capSlot: number | null;      // slot index of a cap to transfer (-1 = none)
}

export interface Endpoint {
  endpointId: string;
  sendQueue: TCB[];   // threads blocked waiting to send
  recvQueue: TCB[];   // threads blocked waiting to receive
}

export interface IPCResult {
  sender: TCB;
  receiver: TCB;
  message: IPCMessage;
  capTransferred: boolean;  // true if a cap moved
}

export function sendMessage(
  sender: TCB,
  endpointCapSlot: number,
  message: IPCMessage,
  endpoint: Endpoint,
  capStore: CapabilityStore,
  scheduler: Scheduler,
): IPCResult | null;
// If a receiver is waiting: dequeue it; transfer message and optional cap; return IPCResult.
// If no receiver: enqueue sender in sendQueue; setStatus(sender, 'blocked_send'); return null.
// Cap transfer gated by GRANT right: if sender's cap lacks GRANT, capTransferred = false, cap not moved.

export function receiveMessage(
  receiver: TCB,
  endpointCapSlot: number,
  endpoint: Endpoint,
  capStore: CapabilityStore,
  scheduler: Scheduler,
): IPCResult | null;
// If a sender is waiting: dequeue it; transfer; return IPCResult.
// If no sender: enqueue receiver in recvQueue; setStatus(receiver, 'blocked_recv'); return null.
```

how to implement:
1. Create `src/kernel/ipc.ts`.
2. `sendMessage`: if `recvQueue` non-empty, dequeue receiver, set both to `'ready'`, transfer.
3. Cap transfer: if `message.capSlot !== null` and sender's endpoint cap has `GRANT` right: move the cap from sender's CNode slot to receiver's CNode slot (in a designated "receive slot").
4. `receiveMessage`: mirror logic.

acceptance: `test/ipc.test.ts`:
- Receiver waiting; sender sends → `IPCResult` returned; both threads `'ready'`.
- No receiver; sender sends → sender `'blocked_send'`, returns null.
- Receiver arrives after sender blocked → `IPCResult` returned; sender woken.
- GRANT right present → cap transferred to receiver's CNode.
- GRANT right absent → `capTransferred = false`; cap not in receiver's CNode.

---

**`S11` — Capability non-forgeability property test**
dependsOn: `S06`, `S09`
files: `test/capability-nonforgeability.property.test.ts`

how to implement:
1. Create `test/capability-nonforgeability.property.test.ts`.
2. Build a scenario with one TCB that starts with NO capabilities (empty CNode).
3. Attempt 10 different syscalls (each requiring a capability) by writing raw slot indices into registers.
4. Assert: every syscall returns `CAPABILITY_DENIED`.
5. Build a second scenario where the TCB has only a WRITE capability. Try 5 syscalls requiring READ, EXECUTE, or GRANT.
6. Assert: all 5 return `CAPABILITY_DENIED`.
7. Grant the READ right. Try READ syscall → succeeds.

acceptance: All assertions pass. No syscall succeeds without a valid capability.

---

**`S12` — Toy filesystem + journaling + fsck**
dependsOn: `S02`
files: `src/fs/block-device.ts`, `src/fs/journal.ts`, `src/fs/fs.ts`, `src/fs/fsck.ts`, `test/fs.test.ts`

interface:
```ts
// src/fs/block-device.ts
export interface BlockDevice {
  blockSize: number;        // always 512 bytes
  blockCount: number;
  blocks: Uint8Array[];     // blocks[i] = one block
  journalLog: Array<{blockIndex: number; before: Uint8Array; after: Uint8Array}>;
}

// src/fs/journal.ts
export function journalWrite(dev: BlockDevice, blockIndex: number, newData: Uint8Array): void;
// 1. Push { blockIndex, before: copy of dev.blocks[blockIndex], after: copy of newData } to journalLog.
// 2. Write newData to dev.blocks[blockIndex].

export function replayJournal(dev: BlockDevice): void;
// For each journalLog entry, re-write dev.blocks[entry.blockIndex] = entry.after.
// Idempotent: replaying twice yields the same result.

export function clearJournal(dev: BlockDevice): void;
// Remove all journalLog entries (after a clean commit).

// src/fs/fs.ts
export interface Inode {
  inodeId: number;
  fileSize: number;
  blockRefs: number[];    // list of block indices
  isDirectory: boolean;
}

export interface DirEntry { name: string; inodeId: number; }

export interface FS {
  inodes: Map<number, Inode>;
  dirs: Map<number, DirEntry[]>;  // inodeId → directory entries
  freeBlocks: Set<number>;
}

export function createFile(fs: FS, dev: BlockDevice, parentDirInode: number, name: string): number;
// Allocate an inode; create a DirEntry; journal the changes; return inodeId.

export function writeFile(fs: FS, dev: BlockDevice, inodeId: number, data: Uint8Array): void;
// Allocate blocks; journal the block writes and inode update.

export function readFile(fs: FS, dev: BlockDevice, inodeId: number): Uint8Array;

// src/fs/fsck.ts
export type FsckError =
  | { kind: 'INODE_POINTS_TO_FREE_BLOCK'; inodeId: number; blockIndex: number }
  | { kind: 'ORPHAN_INODE'; inodeId: number }
  | { kind: 'DOUBLE_ALLOCATED_BLOCK'; blockIndex: number };

export function fsck(fs: FS): FsckError[];
// Returns empty array if consistent; otherwise returns all found errors.
```

how to implement:
1. Create `src/fs/block-device.ts`, `src/fs/journal.ts`, `src/fs/fs.ts`, `src/fs/fsck.ts`.
2. `journalWrite`: always records before/after then writes; ensures crash-recovery replay is safe.
3. `createFile`: allocate inode ID (sequential counter); journal inode + dir entry writes.
4. `writeFile`: allocate blocks from `freeBlocks`; journal block writes; update inode.
5. `fsck`: check that all `inode.blockRefs` entries are NOT in `freeBlocks`; check all inodes are reachable from the root directory tree; check no block appears in two inodes.

acceptance: `test/fs.test.ts`:
- Create file, write data, read back → same bytes.
- `journalWrite` + `replayJournal` → block has new data; replay again → same result (idempotent).
- **Crash recovery**: `journalWrite` a block, do NOT `clearJournal`, call `replayJournal` on a fresh device copy with the journalLog applied → consistent state.
- `fsck` on a clean FS → no errors.
- `fsck` on a FS with an inode pointing to a freed block → returns `INODE_POINTS_TO_FREE_BLOCK`.

---

**`S13` — Golden boot trace + end-to-end integration**
dependsOn: `S05`, `S08`, `S09`, `S10`, `S11`, `S12`
files: `src/fixtures/boot-program.ts`, `test/golden-boot.test.ts`

interface:
```ts
// src/fixtures/boot-program.ts
export const BOOT_INSTRUCTIONS: Instruction[] = [...];
// A minimal program:
//   1. Kernel starts in supervisor mode.
//   2. Creates a TCB for "init" thread via retype.
//   3. Maps two pages for init.
//   4. Switches to user mode; init thread runs.
//   5. Init sends a message over an IPC endpoint.
//   6. Kernel receives it; responds.
//   7. Init calls EXIT.
```

how to implement:
1. Create `src/fixtures/boot-program.ts` with the instruction sequence.
2. Create `test/golden-boot.test.ts`:
   - Set up the kernel state: memory, capability store, scheduler, endpoint.
   - Execute instructions one at a time using `vmStep`.
   - On each ECALL trap, call `dispatchSyscall`.
   - Collect `TraceRecord[]`.
3. Run the trace twice.
4. Assert `traceA` deeply equals `traceB` (determinism invariant G10.6 and G10.9).
5. Assert the init thread reaches `EXIT` status.
6. Assert the IPC message was received (check receiver TCB's saved regs for the message words).

acceptance: Test passes with identical traces on two runs.

---

### 3. The decomposition method for the remaining breadth

After S01–S13 are green, apply this recipe for every remaining feature:

**Recipe for one feature cluster:**
1. Name the invariant from G10 it exercises.
2. Write the acceptance assertion first: "After X, invariant G10.N holds."
3. Split into at most 3 cards: (a) types/data structures, (b) pure logic/evaluation, (c) machine integration + golden trace.
4. Every card tests offline with `npm test`.

**Worked example 1 — Copy-on-write page fault**
- Types card `COW01`: Add `copyOnWrite: boolean` to `PageTableEntry`. A COW page is mapped read-only; on a write fault, the kernel faults back with `'COW_FAULT'` cause.
- Logic card `COW02` dependsOn `S04`, `S08`: `handleCOWFault(tcb, faultAddr, mem, pageTable)`: allocate a new frame (copy old frame), remap the virtual page with `write: true` and `copyOnWrite: false`. Return new page table.
- Integration card `COW03`: Two threads share a COW mapping. Thread A writes; a `PROTECTION_FAULT` traps; kernel handles it; thread A gets a private copy; thread B's mapping unchanged. Assert the two threads see different values after the write.

**Worked example 2 — Timer preemption demo**
- Types card `TI01`: Extend `VMachineState` with a `ticksUntilPreempt: number`. An injected `TIMER_TICK` event decrements it; at 0, the stepper sets the trap cause to `'TIMER_INTERRUPT'` and the kernel reschedules.
- Logic card `TI02` dependsOn `S08`: `handleTimerInterrupt(scheduler, currentTcb)`: set currentTcb to `'ready'`; call `pick()` to get next thread.
- Integration card `TI03`: A low-priority thread is running; 10 ticks later a high-priority thread is added; assert the high-priority thread is scheduled next after the tick.

**Worked example 3 — Network device simulation**
- Types card `NET01`: `NetworkFrame = { srcMac: number; dstMac: number; payload: Uint8Array }`. `PacketQueue = NetworkFrame[]`. A NIC device raises a `DEVICE_INTERRUPT` (injected event) when a frame arrives.
- Logic card `NET02` dependsOn `S09`: Register a MMIO region for the NIC. A `SW` to the TX register sends a frame; a `LW` from the RX register receives one from the queue.
- Integration card `NET03`: Kernel sends a frame via MMIO SW; NIC delivers it to the receive queue; a second thread polls via MMIO LW and reads the same bytes. Assert round-trip frame integrity.

---

### 4. Per-task implementation conventions

**Folder layout**
```
src/
  cpu/
    isa.ts
    registers.ts
    memory.ts
    stepper.ts
    mmu-stepper.ts
  vm/
    page-table.ts
    mmu.ts
  kernel/
    capability.ts
    cnode.ts
    untyped.ts
    process.ts
    scheduler.ts
    syscall.ts
    ipc.ts
  fs/
    block-device.ts
    journal.ts
    fs.ts
    fsck.ts
  fixtures/
    programs.ts
    boot-program.ts
test/
  registers.test.ts
  memory.test.ts
  stepper.test.ts
  mmu.test.ts
  mmu-stepper.test.ts
  capability.test.ts
  untyped.test.ts
  scheduler.test.ts
  syscall.test.ts
  ipc.test.ts
  capability-nonforgeability.property.test.ts
  fs.test.ts
  golden-boot.test.ts
```

**How to write a test in Vitest**
```ts
import { describe, it, expect } from 'vitest';
import { createRegisterFile, writeReg, readReg } from '../src/cpu/registers.js';

describe('register file', () => {
  it('x0 is always 0', () => {
    const rf = createRegisterFile(0x1000);
    const after = writeReg(rf, 0, 99);
    expect(readReg(after, 0)).toBe(0);
  });
  it('writes to x1 survive', () => {
    const rf = createRegisterFile(0);
    expect(readReg(writeReg(rf, 1, 42), 1)).toBe(42);
  });
});
```

**Encoding instructions as 32-bit words (for the stepper)**

Use a simple encoding that fits in 32 bits:
```ts
// bits[6:0]  = opcode index (0..15)
// bits[10:7] = rd (0..15)
// bits[14:11] = rs1 (0..15)
// bits[18:15] = rs2 (0..15)
// bits[31:19] = immediate (13-bit signed)
const OPCODES: Opcode[] = ['ADD','SUB','AND','OR','XOR','SLL','SRL','ADDI','LI','LW','SW',
                            'BEQ','BNE','BLT','BGE','JAL','JALR','ECALL','MRET','NOP'];

export function encodeInstruction(instr: Instruction): number {
  const op = OPCODES.indexOf(instr.op);
  const rd = (instr.rd ?? 0) & 0xF;
  const rs1 = (instr.rs1 ?? 0) & 0xF;
  const rs2 = (instr.rs2 ?? 0) & 0xF;
  const imm = ((instr.imm ?? 0) & 0x1FFF) << 19;
  return op | (rd << 7) | (rs1 << 11) | (rs2 << 15) | imm;
}
```

**Keeping it deterministic**
- `step()` and `vmStep()` are pure functions; never mutate the input state.
- Return `{ kind: 'ok', nextState: {...}, traceRecord: {...} }` and let the harness advance the state.
- For the golden boot trace test, run the same fixture twice and `deepEqual` both trace arrays.
- No `Math.random()` anywhere. No `Date.now()`. No `process.env`.

**Definition of done for any card**
1. `tsc --noEmit` exits 0.
2. `npm test` green.
3. No `any` in `src/`.
4. No `Date.now()`, `Math.random()`, or real I/O in `src/`.
5. `step()`/`vmStep()` are pure: they accept a state and return a new state (do not mutate input).
6. Every acceptance assertion from the card is a named `it(...)` block.

---

### 5. Common pitfalls for a weak model on THIS project

**Pitfall 1 — `step()` mutating input state**
A 3B model will write `state.regs.pc += 4; return state`. This breaks the golden-trace test because re-running the same trace now starts with a different state. All state transitions must return a *new* state object. Use spread (`{ ...rf, pc: rf.pc + 4 }`) or explicit cloning.

**Pitfall 2 — Combining kernel and userspace state into one object**
The spec explicitly forbids "collapse kernel and userspace state into one mutable object." A `TCB` stores the thread's register file; the kernel has its own state (capability store, scheduler, page tables). The emulator does not let the thread's registers reference the kernel state directly. A `vmStep` dispatches to `dispatchSyscall` only on an ECALL trap — it doesn't give the user-mode instruction access to kernel data structures.

**Pitfall 3 — Forgetting to check `mode` before executing privileged instructions**
A model will implement `MRET` without checking the current mode. `MRET` in user mode must trap with `ILLEGAL_INSTRUCTION`. The `S03` test catches this, but a model building on `S05` (MMU) without re-running `S03` will miss it. The mode check belongs in the stepper, not in a runtime guard on the kernel side.

**Pitfall 4 — Capability forgery through raw slot-index guessing**
A model may implement `dispatchSyscall` so that it fetches the capability by slot index and, if the slot is empty, silently succeeds (or panics). The correct behavior is to return `CAPABILITY_DENIED` with a specific `capSlot` and `requiredRight`. The S11 property test exercises 10 slot indices that are all empty or wrong-rights; all must return `CAPABILITY_DENIED`.

**Pitfall 5 — IPC capability transfer without GRANT check**
A model will transfer any capability in the `capSlot` field of the message. The GRANT right is specifically required for capability transfer. Without checking it, an IPC message can silently move capabilities the sender was not authorized to delegate. The `S10` test has a case where GRANT is absent and asserts `capTransferred === false`.

**Pitfall 6 — Filesystem journal replay is not idempotent**
A model will implement `replayJournal` in a way that double-applies a write if called twice (e.g., `block.data += entry.after`). Replay must be idempotent: `dev.blocks[i] = entry.after`. The test calls `replayJournal` twice and asserts the final state is unchanged.

**Pitfall 7 — fsck not detecting orphan inodes**
A model implements `fsck` only as a block-bitmap check. An `ORPHAN_INODE` exists when an inode is in the inode table but not reachable from the root directory tree. The `fsck` must do a directory traversal from root and flag any inode not reached. The test creates an inode without adding a directory entry and asserts `ORPHAN_INODE` is returned.

**Pitfall 8 — Golden boot trace using `Date.now()` for instruction timestamps**
A model will include wall-clock timestamps in `TraceRecord`. This makes the two-trace comparison in `S13` fail. `TraceRecord` must contain only data derived from the machine state and the instruction — no timestamps, no sequence numbers from real time. Use instruction count (step number) if a counter is needed.
