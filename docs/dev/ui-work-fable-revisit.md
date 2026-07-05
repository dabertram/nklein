# UI work log — for a Fable revisit (started 2026-07-05)

David lifted the "no UI in non-Fable sessions" hold (2026-07-05): *"you can absolutely do them, just take notes about all the ui things you do, so that i can revisit later with fable."* This file logs **every UI change made in a non-Fable (plain-Opus) session** so Fable can review/polish the visual + interaction quality later. Functionally correct + tested, but NOT visually optimized — Fable should pass over each of these.

## How to use this log
Each entry: what was added/changed, which files, what it does, and **what to revisit with Fable** (visual polish, layout, motion, a11y, empty/error states). The backend is wired + tested; the review is about look-and-feel + UX refinement.

## Changes

_(entries appended as work proceeds)_

### 1. Egress Settings toggle + SearXNG backend URL (§5.AC) — 2026-07-05
- **File:** `web-ui/src/components/runtime-settings-dialog.tsx` (General section, after "knows today").
- **What:** a Radix switch "Allow online web research (egress)" bound to `retrievalEgressEnabled`, plus a text input "SearXNG backend URL" bound to `retrievalSearchBackendUrl` (disabled until egress is on). Full lifecycle wired (state → initial → dirty-check → reset-on-load → save payload) mirroring the `knowsTodayEnabled` toggle. Server read/save paths already existed (`buildRuntimeConfigResponse` + the config contract). +1 component test (renders toggle + URL from config); 40 dialog tests green.
- **Revisit with Fable:** visual placement/grouping (it's a plain row in General — maybe belongs in its own "Online retrieval" subsection with the egress security note styled as a callout); the disabled-state affordance on the URL input; validation/error state for a malformed URL; a "test connection" affordance would be nice; the inline `<code>docker compose…</code>` hint wrapping on narrow widths.

### Web-ui typecheck debt — FIXED 2026-07-05
`web-ui npm run typecheck` is RED on 8 test files (`native-agent`, `kanban-board`, `use-git-actions`, `use-runtime-settings-nklein-controller`, `use-startup-onboarding`, `use-runtime-config`, `use-runtime-project-config`, `nklein-agent-chat-panel`) — each inline `createRuntimeConfig*()` fixture is missing the now-required `sandboxMaxConcurrentExec` field. NOT caused by this session (the root `test:fast` gate doesn't run the web-ui tsc, so it drifted). Fix = add `sandboxMaxConcurrentExec: 2` to each fixture. FIXED: added `sandboxMaxConcurrentExec: 2` to all 8 fixtures; `web-ui npm run typecheck` is now GREEN (0 errors), so future UI work gets clean type feedback.
