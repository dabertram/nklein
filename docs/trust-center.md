# !Klein Trust Center — data flows, egress, and compliance posture

> F12.103 (2026-07-17). This document states what the ARCHITECTURE enforces today, with pointers to the code that
> enforces it. Claims here are meant to be verifiable — where a guarantee is machine-checked, the check is named.
> Planned-but-not-shipped items are marked **planned** and never stated as current fact.

## The core claim

**!Klein is private by architecture, not by policy.** All model inference runs on the user's own machines (LM Studio
across the local fleet); all agent execution runs in local Docker sandboxes; project state, telemetry, and the
retrieval index live under the user's home directory. There is no cloud backend, no account requirement for local
operation, and no telemetry phone-home.

## Data-flow summary

| Data | Where it lives | Leaves the machine? |
|---|---|---|
| Source code / workspaces | `~/.nklein/dev-workspaces`, user project paths | Never by default (see egress inventory) |
| Model prompts + completions | Local fleet (LM Studio endpoints) | Never — enforced, see below |
| Ledger / telemetry / fitness | `~/.nklein/nklein/*` (JSON/JSONL files) | Never |
| Retrieval index + code embeddings | Local stores; local embedding endpoint | Never — **machine-checked** |
| Chat transcripts / sessions | `~/.nklein/nklein/chat-*`, `~/.nklein/data/sessions` | Never |

## Enforcement points (code-verifiable)

- **Local-only model policy:** `assertLocalProviderAllowed` (`src/nklein-agent/nklein-local-only-policy.ts`) fails
  closed before any network call when a provider/base-URL is not a permitted local endpoint. Eleven call sites guard
  the client constructors and eval paths.
- **Local-retrieval privacy invariant (machine-checked in CI):**
  `test/runtime/nklein-agent/local-retrieval-privacy-invariant.test.ts` statically scans every retrieval/embedding
  module and FAILS the suite if any non-localhost URL appears beyond the single allowlisted ingress (the public
  nomic embedding-model download). Adding an egress edge to these modules cannot land silently.
- **Sandboxed execution:** agent code runs in Docker sandboxes; workspace writes flow through captured patches and
  confined tool paths (`nklein-tool-path-containment.ts`).
- **Untrusted-content taint + egress gate (Phase 7S):** content ingested from the web/MCP is tainted at ingestion;
  the capability broker (S5/S6/S8/S9) tracks taint per session, and the egress-provenance gate (S3) plus the
  outward-action queue place outward-facing actions behind review. The fan-out cap (S9, default-on) bounds outward
  request volume.
- **Delivery integrity scans:** every delivered patch is scanned (record-only today) for placeholder/quality issues,
  diff bloat, and reward-hacking signatures — evidence lands in the local ledger only.

## Egress inventory (exhaustive by class)

1. **Local fleet inference** — HTTP to `localhost`/LAN LM Studio endpoints. Contains prompts/code. Never leaves the
   user's machines.
2. **Model weight downloads** — ingress-only fetches of public weights (LM Studio's own downloads; the allowlisted
   nomic embedding GGUF). No user data is sent.
3. **Optional online web research** — OFF by default; enabling it is an explicit settings action ("Allow online web
   research (egress)"), and requests target the user-configured SearXNG-compatible backend (localhost-bundled by
   default). Results are tainted as untrusted at ingestion (S4 screen + S2 fence).
4. **Optional MCP servers** — user-configured; the curated sandbox set is offline (`--network none`). Third-party
   MCP servers are the user's explicit choice, and their content is tainted like web content.
5. **Auto-update / package installs** — standard developer-tooling ingress (npm, model hosts) under the user's
   control; disable via `NKLEIN_NO_AUTO_UPDATE`.

There is no other egress class. A new one must survive the privacy-invariant test, the local-only assertions, and
review of this inventory.

## Retention

Everything is local files under `~/.nklein`; retention equals the user's filesystem. Deleting the directory removes
all !Klein state. There is no server-side copy to expire, subpoena, or breach.

## Compliance posture

- **GDPR:** !Klein is locally-installed software; the operator is the data controller for their own machine. No
  personal data is transmitted to the vendor. Data-subject rights (access/erasure) reduce to filesystem operations
  on `~/.nklein`.
- **EU AI Act (enforceable 2026-08-02):** !Klein orchestrates locally-run open-weight models chosen by the user.
  The user selects and operates the models; the per-model licenses in the capability catalog record provenance.
  **Planned (F12.100):** a license/provenance gate + AI-BOM export per project.
- **Air-gapped operation — planned (F12.101):** a first-class profile that disables every ingress/egress class
  above and self-attests. Today the equivalent posture is achievable manually (no web-research flag, no MCP, no
  auto-update, pre-downloaded models), but it is not yet a single switch with attestation.

## Verifiability roadmap (planned, tracked in todo.md)

- **F12.98 Trust & Privacy Panel** — this document's claims, live in the UI with current flag states.
- **F12.99 signed egress receipts** — every outbound request appends a signed local receipt (destination, payload
  hash, taint labels).
- **F12.102 signed reproducible releases + SBOM/SLSA** — supply-chain verifiability for !Klein itself.

---
*Maintained alongside `docs/security-threat-model.md`. Update this document whenever an egress class, enforcement
point, or storage location changes — the privacy-invariant test and this inventory are the pair reviewers check.*
