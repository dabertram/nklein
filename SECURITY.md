# Security Policy

!Klein (`nklein`) is a **local-first** orchestration board for running coding agents on your own machine. Its security
model is built on **containment and local-only defaults**, not on trusting the agent or the model. This document
describes that posture, what it means for you as the operator, and how to report a vulnerability.

## Security posture

!Klein is designed so that an agent — even a capable or misbehaving one — cannot reach outside its sandbox or leak your
work off the machine by default. The guarantees are enforced in code, not by convention:

- **Local models by default.** !Klein targets local model providers (LM Studio, Ollama, and compatible OpenAI-style
  local endpoints). It does not send your code or prompts to a cloud LLM by default. Re-enabling any cloud provider is a
  deliberate, reviewed code change — never a setting that slips on silently.
- **Strict Docker agent isolation (mandatory, fail-closed).** Agent task work runs inside a Docker sandbox container,
  not on the host. The agent operates on a clone in the container's workspace; its result reaches your repository only as
  a reviewable `nklein/tasks/<task>` result branch that the trusted runtime applies after you review it. There is no
  agent-permission tier — not even a "fully open" one — that grants host access. If Docker is unavailable, isolated agent
  tasks fail closed rather than falling back to running on the host.
- **Egress is gated and fail-closed.** Outbound network access (e.g. the optional web-search tool) is denied unless you
  explicitly enable it; a blocked request returns `blocked_by_egress` and no fetch happens. There is no implicit
  allowlist escape hatch — egress stays closed until an explicit, per-domain proxy path is configured.
- **Mutating tool actions are confirmed and audited.** A tool that writes or runs commands passes a confirmation gate
  before it executes, and the executed action is recorded in an audit trail. Read-only actions do not silently gain
  write power.
- **Secret-aware agent I/O.** Agent inputs/outputs pass through secret detection/redaction (private keys, common cloud
  and token patterns), and protected test paths are human-gated and cannot be weakened without explicit approval.
- **The web UI is local.** The runtime and its UI serve on the loopback interface for local use; !Klein is not intended
  to be exposed to an untrusted network as-is.

## What this means for you (the operator)

!Klein contains the agent, but it runs the tools and models **you** point it at. You remain responsible for:

- **Keeping Docker running** if you run agent tasks — isolation depends on it. Do not disable it and run untrusted work.
- **Running local model servers you trust** (LM Studio / Ollama). !Klein does not vet model weights or a model's behavior.
- **Reviewing result branches before merging.** The review + acceptance gate exists so agent output is inspected, not
  rubber-stamped.
- **Not exposing the local UI/port to an untrusted network** without your own authentication/proxy in front of it.
- **Treating enabling cloud providers or web egress as a security decision** — both are off by default for a reason.

## Supported versions

!Klein is pre-1.0 (see `package.json`). Security fixes land on the active development branch and ship in the next
release; there is no long-term-support branch yet. Run a recent build.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a vulnerability.

- Use GitHub's private security advisory tool:
  **https://github.com/dabertram/nklein/security/advisories/new**

Please include, as far as you can:

- a description of the issue and its impact (e.g. sandbox escape, egress bypass, secret leakage, unauthorized host
  action);
- the version / commit you observed it on;
- clear reproduction steps or a proof of concept;
- any relevant logs or configuration (with secrets redacted).

We aim to acknowledge a report promptly, work with you on a fix, and credit you on disclosure unless you prefer to remain
anonymous. Please give us reasonable time to ship a fix before any public disclosure.

## Scope notes

- **In scope:** sandbox-isolation escapes, egress-gate bypasses, unauthorized host actions from an agent, secret leakage
  in !Klein's own code paths, and confirm-gate/audit bypasses.
- **Out of scope (report upstream / to the vendor):** behavior of the local model you choose to run; issues in the
  vendored Cline SDK that also affect upstream (we track and patch these in
  [`vendor/cline-sdk/`](./vendor/cline-sdk/NOTICE.md), but upstream bugs are best reported to Cline as well); and issues
  that require an attacker who already has full local access to the machine !Klein runs on.
