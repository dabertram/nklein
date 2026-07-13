# Vendored Cline SDK — provenance, stance, and patch ledger

This directory contains the **source** of the Cline SDK, vendored into !Klein and built by us.

## Provenance & attribution (we are fair)

- **Upstream:** [github.com/cline/cline](https://github.com/cline/cline), `/sdk/packages/{shared,llms,agents,core,sdk}`.
- **Pinned commit:** `9aac8340dc2932d14038a801eb5da3e318bf72d5` (tag `sdk/core/v0.0.54`, "chore(sdk): regenerate bun.lock for v0.0.54").
- **License:** Apache-2.0 (see `LICENSE`). This engine is Cline's work. !Klein's local-only multi-model
  kanban swarm is built **on top of** it, and we are grateful for it. We vendor it openly, with full
  attribution and license intact — nothing here is hidden or rebranded.

## Why we vendor the source (not the npm bundles)

The published `@cline/*` npm packages ship only prebuilt, minified `dist`. We instead vendor the
**TypeScript source** and build it ourselves (`scripts/build-cline-sdk.mjs`, esbuild + tsc) so that:

1. **No lock-in / hard safety net.** If upstream ever disappears, renames, or unpublishes (it has
   reorganized once already: `@clinebot` → `@cline`, and the original source repo went private), the
   buildable source still lives here. We are never stranded on opaque prebuilt bundles.
2. **Deep control.** !Klein targets *small, slow, local* LLMs under a strict local-only directive.
   That requires controlling internals — context/compaction budgeting, tool execution, prompts — in
   ways a cloud-first engine does not optimize for. Owning the source makes that possible.

## Our stance: a base we build on, not a path we follow (we are strong)

- **Cline is our base.** We track it as the upstream engine and prefer to stay close to it.
- **We pull upstream changes selectively — only when there's a benefit for !Klein.** We do not
  auto-upgrade and we do not follow upstream's roadmap by default. Cline's commercial gravity is the
  cloud platform (accounts, hub, remote, subscriptions); !Klein's is the opposite (offline, local,
  self-hosted). Those are different products on a shared engine.
- **We patch our copy when upstream steers away from our direction.** If a change would gain us
  something — e.g. better context control for small models — or if upstream drifts against our
  local-only / small-LLM target, we patch *our* copy. Apache-2.0 explicitly permits this. Every patch
  is recorded below and kept minimal so re-syncing stays cheap.

This is not freeloading. We credit the source, honor the license, contribute fixes upstream where it
makes sense, and diverge deliberately only where !Klein's direction genuinely requires it.

## Rebuilding

```sh
npm install --prefix vendor/cline-sdk   # install the SDK's third-party build deps (isolated)
node scripts/build-cline-sdk.mjs        # esbuild .js (self-contained) + tsc .d.ts -> packages/*/dist
```

`node_modules/` and `packages/*/dist/` here are build artifacts (gitignored). The host resolves
`@cline/*` to the built `dist` via tsconfig paths + esbuild aliases.

## Local patch ledger

Keep this list current; re-apply on each upstream sync. Patches are intentionally minimal.

| File | Patch | Why |
|---|---|---|
| `packages/core/src/index.ts` | Re-export the `DEFAULT_*_IDCS_*` OCA constants from `./auth/oca` | 0.0.54 stopped re-exporting them from the public entry; the host's provider boundary builds OCA OAuth config from them. |
| `packages/{shared,core}/src/**` (non-test) | Rebrand dir-name string **literals** `".cline"`→`".nklein"` and `".clinerules"`→`".nkleinrules"`, and the system-prompt identity `"You are Cline, an AI coding agent"`→`"You are NKlein, …"` | The host app stores all config/data under `.nklein` / `.nkleinrules` ([runtime-path-constants.ts](../../src/config/runtime-path-constants.ts)); the SDK must match for app↔SDK path consistency, and the agent's identity is !Klein. **Only string literals are touched, never the `Cline*` API symbols the host imports.** Re-apply on sync: `find packages/{shared,core}/src -name '*.ts' ! -name '*.test.ts' -print0 \| xargs -0 perl -i -pe 's/"\\.clinerules"/".nkleinrules"/g; s/"\\.cline"/".nklein"/g'` then patch the prompt identity in `shared/src/prompt/system.ts`. |
| `packages/{shared,core}/src/{agents/types.ts,types/config.ts,runtime/host/**,services/llms/handler-factory.ts}` | Add a host-local `modelWrapper` socket and apply it once after provider model resolution. | !Klein's buffered local-model recovery must wrap the shared `AgentModel.stream` seam before deltas reach the agent loop; an in-process decorator preserves the provider adapter and cannot be serialized accidentally into remote runtime config. |
| `packages/llms/src/providers/ai-sdk.ts` | Preserve an AI SDK `abort` part as `finish:aborted` and honor the host-local `metadata.nkleinProviderMaxRetries` override. | The shared model wrapper needs abort provenance intact and one authoritative total retry budget; !Klein sets inner AI SDK retries to zero only on wrapped turns, avoiding a 3×3 nested retry multiplication while other SDK callers retain their default. |

## Syncing to a newer upstream

1. Check out the desired `sdk/core/vX.Y.Z` tag from `github.com/cline/cline`.
2. Re-vendor `/sdk/packages/*` (preserve this NOTICE + LICENSE).
3. Re-apply the patches in the ledger above (or drop ones upstream has made unnecessary).
4. `npm install --prefix vendor/cline-sdk && node scripts/build-cline-sdk.mjs`, then run the full gate.
5. Reconcile any API drift in the host's boundary files (`src/nklein-agent/sdk-*-boundary.ts`, etc.).
