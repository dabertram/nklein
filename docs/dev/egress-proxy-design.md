# Host-side egress proxy — design (§5.L per-role network allowlists, GREENLIT §10c#18)

> Maintained design/provenance reference, not a task list. Remaining implementation is tracked only in `todo.md`
> F2.3–F2.5; I1–I4 history below describes the shipped baseline.
>
> **Status:** I1–I4 shipped; F2.3–F2.5 own the remaining confirm/per-role/per-task work. This document specifies the
> host-side egress proxy + sandbox network topology that makes the `allowlist` network tier REAL: DNS/SNI-level
> enforcement that calls the existing pure [`decideEgressPolicy`](../../src/core/egress-policy-decision.ts) at connect
> time, per-ROLE allowlists keyed to the capability tiers, a per-attempt audit trail, and (optionally) per-action
> approval. Companion code: [`agent-rulesets.ts`](../../src/core/agent-rulesets.ts) (tiers + the
> `sandboxNetworkHasEgress` keystone), [`nklein-agent-sandbox-docker.ts`](../../src/nklein-agent/nklein-agent-sandbox-docker.ts)
> (container construction), [`nklein-agent-sandbox.ts`](../../src/nklein-agent/nklein-agent-sandbox.ts) (pool +
> `setNetworkPolicy` drift protection), [`chat-egress-attempt-audit-store.ts`](../../src/chat/chat-egress-attempt-audit-store.ts)
> (the audit-store shape to mirror). A fresh session should be able to start Increment I1 directly from §6.

## 1. Problem — today's honest posture is binary, and "allowlist" is deliberately dead

The capability dial ([`CAPABILITY_MATRIX`](../../src/core/agent-rulesets.ts)) promises three network postures:

| tier | `network` | what the tier copy promises |
|---|---|---|
| `strict`, `less_strict` | `none` | fully offline sandbox |
| `medium` | `allowlist` | "Domain-allowlisted egress + web research tool" |
| `more_open`, `fully_open` | `full` | full internet egress |

But enforcement is **binary**: [`resolveAgentSandboxNetworkArgs`](../../src/nklein-agent/nklein-agent-sandbox-docker.ts)
maps a policy to exactly `--network none` or `--network bridge`, and the single source of truth
[`sandboxNetworkHasEgress`](../../src/core/agent-rulesets.ts) returns `true` only for `full`. The docker module's own
posture note says why `allowlist` fail-closes to `none`:

> `allowlist` → **fail-closed to `none` for now.** A real per-domain egress allowlist needs an egress proxy or
> firewalled network that does not yet exist; granting full egress under an "allowlist" label would be a security
> lie, so until the proxy lands we deny rather than over-grant. Tracked as a follow-up.

Consequences today:

- The `medium` tier is **functionally dead on the network axis**: `allowlist` ⇒ no egress ⇒
  [`resolveAgentToolAccess`](../../src/core/agent-rulesets.ts) ANDs web tools with real egress ⇒ `medium` also loses
  the web-research tool its UI copy promises. Honest (fail-closed), but the tier delivers nothing between
  `less_strict` and `more_open`.
- **Per-role network overrides are gated** (todo §5.L "per-role network override" cluster): the pool is global-policy
  only, because a pooled container's `--network` is fixed at creation and per-policy keying "only matters once
  distinct per-role network tiers can truly differ". The operator use-case is covered by
  [`setNetworkPolicy`](../../src/nklein-agent/nklein-agent-sandbox.ts) (runtime re-apply with drift protection:
  idle containers retire + recreate, occupied age out — prime directive #2), re-applied on live config change at
  [`nklein-task-session-service.ts`](../../src/nklein-agent/nklein-task-session-service.ts) (~L2517).
- The pure §5.L decision cores are **built and dark**: `decideEgressPolicy` (39 tests) decides
  `allow | deny | confirm` per target with IP-literal/LAN fail-closes and default-deny allowlisting, but nothing
  calls it on the task/sandbox path. Its own SCOPE note names the missing piece: "a name→IP mapping is the proxy's
  job at connect time — a decider that trusts a resolved IP would be racing a rebind."

**Goal:** a real egress path for `allowlist` where `decideEgressPolicy` is consulted before ANY socket opens, so the
tier label becomes true, per-role tiers become meaningful, and every attempt is audited.

## 2. Requirements (from prime directives §1 + §5.L)

- **R1 — LOCAL-ONLY (prime directive #1).** No cloud service, no third-party relay, no runtime image pulls. The proxy
  ships with the desktop app and runs on the user's machine. The sandbox image is already custom-built
  ([`docker/agent-sandbox/Dockerfile`](../../docker/agent-sandbox/Dockerfile)); the proxy must reuse that pattern
  (our image, our bits) or run on the Node runtime we already ship.
- **R2 — FAIL-CLOSED, structurally.** If the proxy is down, crashed, misconfigured, or bypassed, the result must be
  NO egress — never full egress. Enforcement must not depend on the agent's cooperation (env vars alone are a
  request, not a boundary). Docker isolation flags (`--cap-drop ALL --read-only --security-opt no-new-privileges`,
  read-only repo mounts) remain unconditional; this design only changes outbound reachability.
- **R3 — Per-ROLE allowlists keyed to capability tiers.** `resolveCapabilityTier(config, role)` already yields
  per-role tiers (architect / worker / reviewer). The proxy must enforce the *role's* resolved
  `{ networkPolicy, allowlist }`, which requires (a) policy-keyed container pools and (b) role attribution on each
  proxied connection.
- **R4 — `decideEgressPolicy` at connect time.** One decision seam, already unit-tested. The proxy adds only what the
  pure module scoped out: DNS resolution + a post-resolve private-IP recheck (anti-rebind), mirroring the existing
  host-side SSRF guard [`buildSsrfGuardedPageFetcher`](../../src/chat/chat-browser-tool.ts) (~L261).
- **R5 — Per-attempt audit.** A JSONL record for every attempt (allow AND deny AND confirm), mirroring
  [`chat-egress-attempt-audit-store.ts`](../../src/chat/chat-egress-attempt-audit-store.ts) (zod schema,
  `parseValidatedJsonl`, append-only, newest-first reads).
- **R6 — Per-action approval (`confirm`) wiring.** The pure piece exists (`requirePerActionApproval` →
  `confirm`, never softening a deny). Wire it last (I5): it needs a host↔proxy control channel + UI surface.
- **R7 — No TLS interception of agent traffic.** We filter by HOST, not content. MITM would require minting a CA,
  injecting it into the sandbox trust store, and keeping every tool (git/curl/npm/python/node) trusting it — high
  maintenance, breaks pinning, and buys nothing our threat model needs. Prefer explicit CONNECT (host is stated
  plainly) and SNI peeking (read the ClientHello, never decrypt) over any `ssl_bump`-style bump. Evaluated in §3.
- **R8 — All-TS fit (§10c#1).** The final stack is TS; a proxy in `node:net`/`node:dgram` keeps policy, parsing, and
  audit in one language, one test runner, one bundler — and lets `decideEgressPolicy` be a direct import instead of
  an RPC to a foreign config language.

## 3. Proxy technology evaluation

Threat model first, because it decides how much "battle-tested" matters: the adversary is a **prompt-injected local
agent using standard tooling inside a hardened container** — not a human attacker with raw-socket exploits. With the
topology in §4, the *security boundary* is Docker's `--internal` network (no NAT, no default gateway — non-proxy
traffic has NO ROUTE). The proxy never has to survive being attacked as a perimeter; it can only *open* holes, and a
parse anomaly fails toward "blocked", not "escaped". That reframes the trade:

| candidate | footprint / packaging | fail-closed | host visibility w/o MITM | per-connect policy hook (`decideEgressPolicy`) | maintenance | TS fit |
|---|---|---|---|---|---|---|
| **squid** | large C daemon; we'd ship + pin our own build/image | yes (ACL default-deny) | `ssl_bump peek`+`splice` reads SNI without bumping | `external_acl_type` helper process (we could write it in TS, stdio protocol) | heavyweight config language; CVE tracking; two sources of truth (ACLs + our policy) | helper only |
| **tinyproxy** | tiny C | filter default-deny | CONNECT target (explicit proxy) | **none** — static filter files, reload on change; cannot express IP-literal/private-range/rebind logic | would need C patches for a real hook | none |
| **mitmproxy** | full Python runtime + cert machinery | yes | designed FOR interception; passthrough mode wastes the whole tool | Python addons | drags a Python dep into the desktop app; cert lifecycle | none |
| **Envoy** | ~100 MB static binary | yes | SNI filter chains, no MITM | `ext_authz` → a TS sidecar service (real, clean hook) | xDS/YAML config surface is grossly oversized for a one-host desktop app | sidecar only |
| **purpose-built TS proxy** (`node:net`/`node:tls` peek) | ~zero: runs on the Node we ship; container reuses our own image | by construction (default-deny on any anomaly; topology backstop) | CONNECT target is explicit; SNI peek parser for a later transparent mode | **direct import** | ours to maintain — but small (~400–600 LOC effectful, the rest pure+unit-tested), and it is not the perimeter | native |
| **iptables/nftables privileged helper** | n/a on macOS: Docker Desktop runs a VM; host rules don't apply, VM rules are unsupported | — | — | — | a `NET_ADMIN` sidecar contradicts the `--cap-drop ALL` posture | — |
| **Docker `--internal` network + dual-homed gateway** | daemon-native, zero deps | **YES: proxy down ⇒ no route ⇒ no egress** | n/a (topology, not inspection) | n/a | trivial | n/a |

**Verdict:** combine the last two rows — Docker `--internal` topology as the *enforcement boundary* + a
**purpose-built TS explicit proxy** as the *policy/audit point*. Squid-with-a-TS-external-ACL-helper is the documented
fallback if the TS proxy ever proves insufficient, but it doubles the config surface for no boundary gain here.
mitmproxy and the privileged-helper route are rejected outright (R7, macOS reality). Envoy is rejected on
proportionality.

## 4. Recommended architecture

### Topology

```
HOST (macOS-first desktop; identical shape on Linux)
+------------------------------------------------------------------------------+
| !Klein runtime (Node host process)                                           |
|   runtime-server seam (~L1910): role -> tier -> { networkPolicy, allowlist } |
|   AgentSandboxManager: policy-keyed pools + egress-proxy lifecycle           |
|   settings UI (allowlist editor) + audit reader                              |
|        ^ reads ~/.nklein/sandbox-audit/egress-attempts.jsonl (RW mount)      |
+------------------------------------------------------------------------------+
| Docker                                                                       |
|                                                                              |
|  --network none                    nklein-egress-int[-<ns>]                  |
|  +--------------------+            (docker network create --internal:        |
|  | sandbox container  |             NO NAT, NO default gateway)              |
|  | strict/less_strict |            +--------------------+                    |
|  +--------------------+            | sandbox container  |                    |
|     (unchanged)                    | medium / allowlist |                    |
|                                    +---------+----------+                    |
|                                     CONNECT  |  host:443        DNS query    |
|                                     (HTTP(S)_PROXY env,         -> stub:53   |
|                                      per-exec, port = role)     (NXDOMAIN)   |
|  --network bridge                  +---------v----------+                    |
|  +--------------------+            |   egress-proxy     |  RW mount:         |
|  | sandbox container  |            |   container        |  audit JSONL       |
|  | full (v1: as-is)   |            |   DUAL-HOMED:      |                    |
|  +---------+----------+            |   internal+bridge  |                    |
|            | NAT                   +---------+----------+                    |
+------------|-----------------------------------|-----------------------------+
             v                                   v   only after decideEgressPolicy
          Internet                            Internet   allow + resolved-IP recheck
```

- **Tier → network mapping (the new truth).** `none` → `--network none` (unchanged). `full` → `--network bridge`
  (unchanged in v1 — see open question Q2). `allowlist` **+ proxy enabled** → `--network nklein-egress-int[-<ns>]`;
  `allowlist` with the proxy disabled/unavailable → `--network none` exactly as today. The keystone
  `sandboxNetworkHasEgress` gains the enforcement dimension —
  `sandboxNetworkHasEgress(policy, { egressProxyAvailable })` — and stays the SINGLE shared truth for the Docker
  mapping AND tool gating (§4A guard-drift lesson: extend the keystone, never fork it). Flipping it to `true` for
  proxied `allowlist` is exactly what un-deadens `medium`'s web-research tool.
- **The proxy is a dual-homed container, not a host process.** On macOS the host cannot reach container IPs, and a
  container on an `--internal` network cannot reach `host.docker.internal` (no gateway — that is the point). A
  gateway container attached to BOTH the internal network and `bridge` is the only portable shape. It reuses the
  existing custom image (`nklein/agent-sandbox` already ships node 22) with `--entrypoint node` and the app-shipped
  proxy bundle (esbuild single file) bind-mounted read-only — no new image to build or pull (R1). It runs under the
  same hardening flags as the sandbox (`--cap-drop ALL --read-only --security-opt no-new-privileges --pids-limit`,
  mem/cpu caps, non-root uid), gets a `nklein.kind=egress-proxy` label for startup reaping, and is namespaced like
  container/volume names (`namespace` discriminator in [`nklein-agent-sandbox-docker.ts`](../../src/nklein-agent/nklein-agent-sandbox-docker.ts)).
- **Explicit proxying via `HTTP_PROXY`/`HTTPS_PROXY` env, not transparent interception.** Chosen because it is the
  least invasive and most tool-compatible path for agent traffic: git (libcurl), curl, npm, pip/uv, python urllib all
  honor the env vars, and the sandbox image's toolset is exactly that. The known gap — clients that ignore proxy env
  (bare `node fetch`/undici without `EnvHttpProxyAgent`) — is not a security gap: paired with `--network internal`,
  non-proxy-aware traffic simply has **no route** and fails closed, visibly, in tool output. Env is injected per
  `docker exec` (`-e HTTP_PROXY=http://<proxy>:<rolePort> -e HTTPS_PROXY=... -e NO_PROXY=`), the same mechanism
  basic-memory already uses (see the `envArgs` exec path in
  [`nklein-agent-sandbox.ts`](../../src/nklein-agent/nklein-agent-sandbox.ts) ~L877), so role attribution is exact
  even though roles co-occupy one pooled container.
- **DNS: containers get a stub, not a resolver.** Two candidate models were evaluated:
  1. *CONNECT-only, no DNS* — proxy-aware clients send the NAME to the proxy (`CONNECT example.com:443`); the proxy
     resolves host-side. Containers need no working DNS at all.
  2. *Container-side DNS pointing at the proxy* — needed only for transparent modes we are not building.
  Model 1 wins, with one Docker gotcha closed: on user-defined networks Docker's embedded resolver (127.0.0.11)
  forwards external lookups upstream **even on `--internal` networks** — a live DNS-exfiltration channel (data
  encodes in query names). Mitigation: the proxy also runs a ~80-line UDP **DNS stub** (`node:dgram`) answering
  NXDOMAIN to everything and auditing each query name (a free injection-detection signal); sandbox containers on the
  egress network are created with `--dns <proxy-internal-ip>`, which on user-defined networks sets the embedded
  resolver's UPSTREAM — container-name records (the proxy's own hostname) still resolve locally and never hit
  upstream.
- **Per-role attribution: one listener port per role.** `AGENT_RULESET_ROLES` is a fixed triple, so the proxy listens
  on three ports (3128 architect / 3129 worker / 3130 reviewer — squid-conventional base). Each listener binds the
  role's resolved `{ networkPolicy, allowlist, requirePerActionApproval }` snapshot. Per-task attribution inside a
  role can later ride the proxy-auth username (`http://<taskId>@proxy:port`) without changing topology (Q4).
- **Policy-keyed pools (the greenlit §5.L leaf).** The `AgentSandboxManager` container map keys by
  `(networkArgsKey, slot)` where `networkArgsKey ∈ {none, egress-int, bridge}`; container/volume names gain the key
  (`nklein-agent-sandbox[-<ns>]-<netkey>-<slot>`). A task's placement resolves role → tier → policy → pool.
  `setNetworkPolicy` generalizes to a per-role ruleset re-apply with the SAME drift semantics (retire idle
  containers whose key no longer matches any role's resolved policy; occupied age out).
- **Config + policy distribution.** The proxy imports `decideEgressPolicy` directly (bundled); the per-role snapshot
  arrives as a read-only mounted JSON (regenerated + container recreated on config change via the existing
  change-detection path in [`runtime-config.ts`](../../src/config/runtime-config.ts) — same recreate-on-change
  discipline as `setNetworkPolicy`, so proxy config can never drift from the resolved rulesets). Audit JSONL is
  written to a RW bind mount (`writableMounts` precedent) at `~/.nklein/sandbox-audit/`, read host-side with the
  same zod schema.

### Failure semantics (R2 walked end-to-end)

| failure | result |
|---|---|
| proxy container dead/crashed | internal network has no other egress path → all attempts hang/refuse; audit gap is visible; watchdog restarts + records |
| proxy bundle missing / config unparseable | proxy refuses to start → as above; sandbox creation for `allowlist` FAILS CLOSED to `--network none` when the proxy is not confirmed healthy |
| agent unsets/ignores proxy env | no route (internal network) → no egress |
| agent speaks raw TCP/UDP to arbitrary IPs | no route → no egress; DNS names → stub NXDOMAIN (audited) |
| proxy parse anomaly (malformed CONNECT/request) | default-deny + audit `parse_error` |
| DNS rebind (name resolves private after allow) | post-resolve IP recheck denies `resolved_private_ip`; socket connects to the vetted IP, not the name (no TOCTOU) |

## 5. Enforcement flow

```
agent tool (git/curl/pip/...)                      egress-proxy (role listener :312x)
        |                                                   |
        |-- CONNECT api.example.com:443 ------------------->|  1. parse head (pure: egress-proxy-protocol)
        |   (or absolute-form GET http://host/...)          |     anomaly -> 403 deny, audit parse_error
        |                                                   |  2. decideEgressPolicy({ target: "host:port",
        |                                                   |       networkPolicy, allowlist,
        |                                                   |       requirePerActionApproval })
        |                                                   |     deny    -> 403 + reasonCode, audit
        |                                                   |     confirm -> v1: 403 audit decision:"confirm"
        |                                                   |                I5: park + ask host, then proceed
        |                                                   |  3. allow -> dns.lookup(host, {all:true})
        |                                                   |     ANY resolved IP private/LAN -> deny
        |                                                   |       resolved_private_ip, audit (anti-rebind,
        |                                                   |       mirrors buildSsrfGuardedPageFetcher)
        |                                                   |  4. net.connect(vettedIp, port); on established:
        |<-- HTTP/1.1 200 Connection Established -----------|     splice bytes both ways (opaque TLS tunnel,
        |<=================== tunnel ======================>|     NO interception, R7); count bytes
        |                                                   |  5. audit record (append JSONL, RW mount)
```

- **Host extraction order:** CONNECT authority (HTTPS — covers ~all agent traffic) → absolute-form URL (plain HTTP)
  → `Host` header (origin-form fallback) → [transparent SNI peek: parser built in I1, mode not enabled in v1].
- **Default port policy:** CONNECT to `:443` and `:80` only; anything else denies with proxy-local reason
  `disallowed_port` (Q3 sets the default; an allowlisted host is otherwise a full opaque TCP tunnel to that port —
  intended for 443, not for arbitrary services).
- **Decision layering:** the pure module's `EgressDenyReasonCode` set stays untouched; the proxy wraps it in a
  proxy-verdict union adding `parse_error | disallowed_port | resolve_failure | resolved_private_ip` (defined in the
  I1 pure verdict module, so the layering itself is unit-tested).
- **Audit record** (mirrors [`ChatEgressAttemptAuditEntry`](../../src/chat/chat-egress-attempt-audit-store.ts) —
  schemaVersion literal, zod-validated, `parseValidatedJsonl` reads):

```jsonc
{ "schemaVersion": 1, "id": "<uuid>", "role": "worker", "policy": "allowlist",
  "listenerPort": 3129, "transport": "connect",           // connect | http | dns
  "target": "api.example.com:443", "host": "api.example.com", "port": 443,
  "decision": "deny",                                     // allow | deny | confirm
  "reasonCode": "not_on_allowlist",                       // pure code or proxy-local code
  "reason": "The host is not on the egress allowlist (allowlist policy is default-deny).",
  "resolvedIps": null, "executed": false, "bytesIn": 0, "bytesOut": 0,
  "durationMs": 2, "recordedAt": 1784323200000 }
```

## 6. Increment plan (each bounded, testable without live models)

**I1 — pure proxy core (no Docker, no sockets in tests).**
- `src/core/egress-proxy-protocol.ts` — `parseHttpConnectHead` (CONNECT authority + absolute-form + Host-header
  extraction, hard byte/line limits, default-deny on anomaly) and `parseTlsClientHelloSni` (first-record ClientHello
  walk → SNI or null; fixtures = recorded ClientHello bytes). Pure, no I/O.
- `src/core/egress-proxy-verdict.ts` — `decideProxyVerdict(parsed, roleSnapshot, resolvedIps?)`: composes
  `decideEgressPolicy` + port policy + the post-resolve private-IP recheck as a pure function over INJECTED resolved
  IPs (reuse/extract the private-range predicates rather than duplicating them). Proxy-local reason codes live here.
- `src/nklein-agent/sandbox-egress-attempt-audit-store.ts` — schema + append + read, structurally mirroring
  [`chat-egress-attempt-audit-store.ts`](../../src/chat/chat-egress-attempt-audit-store.ts).
- Gate: unit tests for the full §5 matrix (allow/deny/confirm × parse anomalies × rebind); `tsc` + biome clean.

**I2 — topology + proxy process behind a flag (default OFF until validated).**
- `src/server/egress-proxy-server.ts` (+ a bundled entry `egress-proxy-main.ts`): `node:net` listeners per role,
  `node:dgram` DNS stub, config from the mounted JSON, audit via I1 store; deps (resolver, dialer, clock) injected so
  integration tests can run it in-process against a local listener with a permissive injected policy.
- `AgentSandboxManager`: ensure network (`docker network create --internal nklein-egress-int[-<ns>]`), proxy
  container lifecycle (create dual-homed, health-check before any `allowlist` sandbox starts, label + reap), the
  `allowlist`→internal mapping in `resolveAgentSandboxNetworkArgs`, `--dns <proxy-ip>`, per-exec `HTTP(S)_PROXY` env.
- New runtime-config flag `sandboxEgressProxyEnabled` (default `false` ⇒ byte-identical behavior; naming precedent:
  `retrievalEgressEnabled`, `sandboxMcpServersEnabled`). `sandboxNetworkHasEgress` gains the
  `egressProxyAvailable` dimension; extend `setNetworkPolicy` drift protection to the new mapping.
- Gate: Docker integration test (env has Docker) — inside a proxied sandbox, `git ls-remote` / `python3 urllib`
  against an allowed vs denied host (both tools are in the image and proxy-aware); assert connect results + audit
  records + that a direct (non-proxy) fetch has no route.

**I3 — allowlist config surface. ✅ SHIPPED `1367e2fe`.**
- Shipped a SINGLE GLOBAL allowlist (not the role-override map originally sketched here — per-role deferred, risk Q4):
  `sandboxEgressProxyEnabled` (boolean, default false) + `sandboxEgressAllowlist` (string|null) promoted to first-class
  runtime config, mirroring the `deviceRamGb` plumbing end-to-end — types → `normalizeSandboxEgressAllowlist` →
  update-merge → state-factory → read/save → change-detection drift-guard (BOTH fields) → `config-api-contract`
  `.optional()` → `agent-registry` mapper → web-ui settings-draft/save + a Settings card in `runtime-settings-dialog`.
- `parseEgressAllowlist` is the canonical parser (superseding the removed `parseBootstrapAllowlistEnv`); the persisted
  allowlist rides the proxy container's `NKLEIN_EGRESS_PROXY_ALLOWLIST` env. `isEgressProxyEnabled(env, configured?)`
  keeps env-over-config precedence (real environment wins, default OFF); `setSandboxEgressConfig` live-applies on a
  Settings change and resets the memoized ensure-promise so a tightening never keeps a stale verdict/allowlist.
- Gate: `settings-config-contract` Suite 17 + runtime-config roundtrip + web-ui settings-draft/save tests.

**I4 — real bundling step + e2e validation + docs. ✅ SHIPPED.**
- **Bundling step (the seam that made the proxy shippable, not env-only):** `scripts/build-egress-proxy.mjs`
  esbuild-bundles `egress-proxy-entrypoint.ts` (+ its local imports) into a single self-contained ESM
  `dist/egress-proxy/entrypoint.mjs`, wired into `npm run build`. `resolveEgressProxyBundleHostPath` auto-discovers
  that shipped bundle next to the bundled app module (`dist/`); `NKLEIN_EGRESS_PROXY_BUNDLE` stays a dev/test
  override; neither present ⇒ null ⇒ the manager fail-closes to `available:false`. ESM keeps `import.meta.url` intact
  so the in-container main-module guard fires.
- **e2e / regression:** the live-Docker `egress-proxy.docker.test.ts` proves allow/deny/no-route + audit end-to-end
  (gated on `NKLEIN_SANDBOX_EGRESS_PROXY=1` + docker); the deterministic manager wiring (`nklein-agent-sandbox-egress`,
  8 cases) + resolver unit tests (override / auto-discover / null-fail-closed / whitespace) cover the seam without
  Docker. A full aimock board-flow scenario was NOT added — it would require live Docker and is redundant with the
  integration test's real allow/deny proof.
- Docs: this doc stamped SHIPPED-through-I4; the CHANGELOG `## [Upcoming]` egress bullet updated (Settings surface now
  shipped; per-role attribution remains the deferred follow-up).

**I5 (optional) — confirm-flow wiring.**
- `requirePerActionApproval` per role; proxy parks `confirm` attempts in a pending queue exposed on a control
  endpoint published to host loopback only (`-p 127.0.0.1:<port>:<port>` on the proxy's bridge leg); UI approval
  mirrors the chat `egress_read` confirmation gate; audit gains `confirmed`. Also: proxy-auth username for per-task
  attribution.

## 7. Risks + open questions (defaults proposed — veto, don't design)

| # | risk / question | proposed default |
|---|---|---|
| Q1 | **Docker embedded-DNS leak** on `--internal` networks (external names forwarded upstream) — an exfil channel via query names. | Ship the proxy DNS stub + `--dns` upstream override in I2 and live-verify on macOS Docker Desktop; if a Docker version ignores the upstream override, fall back to documenting DNS-resolution-only leakage as a known limitation while CONNECT data flow stays enforced. |
| Q2 | Should `full` tier also route through the proxy (gaining IP-literal/LAN denial + audit even at `more_open`/`fully_open`)? | v1: NO — `full` stays `--network bridge` (zero regression risk for non-proxy-aware tools). Add flag-gated `routeFullTierThroughProxy` later; `decideEgressPolicy` already handles `full` correctly (inward-pivot denials still apply). |
| Q3 | CONNECT port policy — allowlisted host is an opaque tunnel to any port. | Default-allow only `:443` (+`:80` plain HTTP); other ports deny `disallowed_port`. Widen per-need via config later, never silently. |
| Q4 | Audit attribution is role-level (port = role), not task-level, in v1; co-occupant tasks of one role share a listener. | Accept for I2–I4 (role + host + timestamp is enough to correlate with the §5.AF ledger); add proxy-auth-username `taskId` in I5. |
| Q5 | The dual-homed proxy container is itself an egress bridge — a compromise of it defeats the allowlist. | Run it with the full sandbox hardening set (cap-drop ALL, read-only rootfs, no-new-privileges, non-root, pids/mem/cpu caps), read-only config/bundle mounts, our own image, and no inbound exposure except the role listeners on the internal net + the loopback-published control port (I5). Accept as the designed single egress point. |

Non-risk worth stating: **ECH/encrypted-SNI does not threaten v1** — the design is explicit-CONNECT (the client
states the host in cleartext to the proxy); SNI peeking only matters for a hypothetical transparent mode, which is
exactly why that mode stays a parser on the shelf (I1) rather than a commitment.
