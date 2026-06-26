# Security Issues

Static review date: 2026-06-26.

Scope: repository source review of runtime auth, TRPC procedures, chat tools, filesystem boundaries, sandbox integration, Electron desktop shell, and frontend rendering. I did not run a dependency advisory audit or live exploit tests.

Assumptions:
- Local loopback mode is intentionally unauthenticated and relies on host/origin checks.
- Remote mode means `--host` is bound to a non-loopback address. In that mode the passcode gate protects API routes unless `--no-passcode` is used.
- Authenticated remote users should still not receive arbitrary host command, filesystem, or app-launch capability unless the backend endpoint explicitly models that intent.

## Critical

### 1. Web chat can auto-run arbitrary host commands via the "safe" classifier

Evidence:
- Can-act chat sessions offer `run_command` for every scope except `chat_only` in `src/trpc/runtime-api.ts:446`.
- The runtime confirm callback silently approves commands whose classifier returns `safe` in `src/trpc/runtime-api.ts:481`.
- The runner executes the approved string through a shell in `src/chat/chat-command-tool.ts:70`.
- The classifier treats `node -e` and `node --print` as safe in `src/chat/chat-command-safety.ts:322`, even though those execute arbitrary JavaScript.
- The safe executable set also includes tools with writable or command-executing modes such as `sed`, `awk`, `xargs`, and `tee` in `src/chat/chat-command-safety.ts:174`.
- `npm test`, `npm run <test|typecheck|lint|build|check>`, and `npx biome format` are also classified safe in `src/chat/chat-command-safety.ts:289`, but package scripts and formatters can execute arbitrary project code or write files.

Impact:
- A model output or prompt-injected chat turn can execute host commands without per-command user approval in a can-act chat session.
- Example class: `node -e "require('fs').writeFileSync(...)"` would be considered safe and then run through the host shell.
- This bypasses the UI's "unsafe commands" confirmation because the backend classifies the command as safe.

Recommendation:
- Remove silent auto-approval for all chat `run_command` calls. Require a per-command confirmation that shows the exact command and cwd, or run commands only from explicit user clicks.
- Replace `shell: true` string execution with argv-based execution for any remaining allowlisted commands.
- Remove `node -e`, `node --print`, package scripts, `xargs`, `tee`, and write-capable formatter invocations from the safe path.
- Add tests for false-safe payloads: `node -e`, `npm run <script>`, `npx biome format`, `sed -i`, `xargs rm`, and `tee file`.

## High

### 2. `runtime.runCommand` exposes raw browser-to-host shell execution

Evidence:
- The TRPC input schema accepts any command string in `src/core/api-contract.ts:1785`.
- The endpoint forwards that string directly to `deps.runCommand` in `src/trpc/runtime-api.ts:2332`.
- The implementation spawns it with `shell: true` and `env: process.env` in `src/cli.ts:351`.
- The visible UI use case is narrower: opening a workspace in a known app builds a constrained command client-side in `web-ui/src/hooks/use-open-workspace.ts:89` and `web-ui/src/utils/open-targets.ts:293`.

Impact:
- Any authenticated browser client, including a remote authenticated user, can bypass the intended "open workspace in editor" intent and run arbitrary shell commands in the project root.
- This is broader than the chat command tool and does not share its safety classifier or audit trail.

Recommendation:
- Replace the raw command endpoint with typed backend intents, for example `openWorkspace({ targetId })`, and build the command on the server from an allowlist.
- Remove or lock down `runtime.runCommand` behind a development-only flag and an explicit local-only guard.
- If raw command execution must exist, add per-command confirmation, audit details, and do not run via shell string interpolation.

### 3. Chat workspace file tools can escape through symlinks

Evidence:
- `resolveWithinWorkspace` does only lexical `resolve`/`relative` confinement in `src/chat/chat-workspace-tools.ts:42`.
- Reads, directory listings, and writes then call filesystem APIs that follow symlinks in `src/chat/chat-workspace-tools.ts:90`, `src/chat/chat-workspace-tools.ts:109`, and `src/chat/chat-workspace-tools.ts:200`.
- Read tools are `sandbox_read` and are always allowed by the execution-mode gate in `src/chat/chat-execution-mode.ts:49`.
- The web runtime offers those read tools whenever there is an active workspace in `src/trpc/runtime-api.ts:447`.

Impact:
- A workspace symlink such as `repo/link -> /Users/david/.ssh` can allow `read_file` or `list_dir` to read outside the workspace while passing the lexical check.
- This applies even in read-only chat scopes because `sandbox_read` does not require confirmation.
- The shared `write_file` tool has the same lexical check if enabled by CLI chat `--allow-write`.

Recommendation:
- Resolve `realpath` for both the root and target before every read/list/write, and require the resolved target to stay under the resolved root.
- Use `lstat` to reject symlink path components unless there is a deliberate symlink policy.
- Add tests for file, directory, and nested symlink escapes.

### 4. NKlein file tools rely on caller sandboxing instead of enforcing workspace containment

Evidence:
- `write_file`/`write_files` accept absolute paths directly in `src/nklein-sdk/nklein-write-files-tool.ts:46`.
- `edit_file` accepts absolute paths directly in `src/nklein-sdk/nklein-edit-file-tool.ts:85`.
- `read_large_file` accepts absolute paths directly in `src/nklein-sdk/nklein-large-file-workflow.ts:481`.
- The approval resolver uses the same absolute-path rule in `src/nklein-sdk/nklein-runtime-setup.ts:73`.
- These tools are created with the agent-perceived cwd in `src/nklein-sdk/nklein-session-runtime.ts:868`.
- Normal task sessions proxy these tools into Docker when a sandbox exists in `src/nklein-sdk/nklein-task-session-service.ts:2024` and `src/nklein-sdk/nklein-agent-sandbox-extra-tools.ts:46`, but home sessions are explicitly host-cwd sessions in `src/nklein-sdk/nklein-agent-sandbox.ts:917`.

Impact:
- The current task path is protected only if the sandbox proxy is definitely present.
- The tools and approval layer are not themselves a containment boundary. A home-session, restart, future integration, or fallback path using the shared tools directly can read or write outside the workspace via absolute paths or `..` traversal.

Recommendation:
- Enforce workspace containment inside each file tool and inside approval policy before reading or writing.
- For sandboxed tools, translate allowed container paths such as `/workspaces/<taskId>/...` to workspace-relative paths before validation.
- Reject host absolute paths in agent-facing tool schemas unless the session is an explicit, audited host session.
- Add regression tests for host absolute paths, `..` traversal, and symlink traversal in both proxied and direct tool modes.

## Medium

### 5. Chat browser tool can access local and private network resources

Evidence:
- `browse_url` validation only checks that the URL protocol is `http:` or `https:` in `src/chat/chat-browser-tool.ts:49`.
- The default implementation launches Playwright, navigates to the URL, and returns page text in `src/chat/chat-browser-tool.ts:66`.
- The web runtime treats the per-session browser toggle as sufficient confirmation in `src/trpc/runtime-api.ts:488`.
- The UI toggles browser access immediately for can-act scopes in `web-ui/src/components/chat/chat-sidebar.tsx:180`.

Impact:
- A chat session with browser access can fetch `127.0.0.1`, RFC1918 addresses, link-local addresses, local router/admin pages, cloud metadata endpoints, or other intranet services and return their text to the model/session.
- This is SSRF-style access from the user's machine, not just ordinary web browsing.

Recommendation:
- Block loopback, private, link-local, multicast, and metadata IP ranges by default.
- Resolve DNS before navigation and re-check after redirects.
- Use an explicit per-host allowlist or a confirmation that displays the destination host and resolved address class.
- Consider disabling browser access in remote mode unless the user confirms a remote-safe policy.

### 6. Internal runtime bearer token is propagated through process environments

Evidence:
- The internal token is stored in `process.env.NKLEIN_INTERNAL_AUTH_TOKEN` in `src/security/passcode-manager.ts:223`.
- `getRuntimeFetch` automatically attaches that token as a bearer token in `src/core/runtime-endpoint.ts:188`.
- Desktop runtime child spawning forwards all parent env vars in `packages/desktop/src/runtime-child-env.ts:66`.
- Terminal environments merge `process.env` in `src/terminal/session-manager.ts:99` and `src/terminal/pty-session.ts:86`.
- The Python sidecar spawn also forwards `process.env` in `src/server/klein-core-sidecar.ts:104`.

Impact:
- Any child process or terminal spawned by the runtime can read the internal bearer token and authenticate to the remote runtime API.
- This widens the token from "trusted CLI subprocess auth" to "all descendants inherit API credentials".

Recommendation:
- Keep the internal bearer token in memory and pass it only to the specific trusted subprocesses that need runtime API access.
- Scrub `NKLEIN_INTERNAL_AUTH_TOKEN` and the legacy token from terminal sessions, sidecars, sandbox processes, and user-controlled commands.
- Add tests that spawned terminals and sandboxed processes do not receive runtime bearer tokens.

### 7. Remote mode can run over plaintext HTTP, and passcode can be disabled

Evidence:
- HTTPS is optional; `resolveRuntimeTls` falls back to plain HTTP when no TLS options are provided in `src/cli.ts:242`.
- Remote mode generates a passcode by default, but `--no-passcode` disables it in `src/cli.ts:617`.
- Session cookies get the `Secure` attribute only when TLS is configured in `src/security/passcode-manager.ts:134` and `src/server/runtime-server.ts:976`.

Impact:
- On a non-loopback host, passcodes and session cookies can cross the network in cleartext if HTTPS is not enabled.
- With `--no-passcode`, the full runtime API surface, including host actions, is exposed to the network without app-level authentication.

Recommendation:
- Require HTTPS for non-loopback binds by default.
- If insecure remote HTTP must exist, require an explicit flag such as `--insecure-remote-http` and print a stronger warning.
- Rename or further gate `--no-passcode` for remote binds, for example `--dangerously-disable-remote-auth`.

### 8. Project folder picker and add-project APIs expose broad host filesystem control to remote users

Evidence:
- The project API sets `filesystemRoot` to the filesystem root on POSIX with `resolve(deps.serverCwd, "/")` in `src/trpc/projects-api.ts:272`.
- `listDirectoryContents` uses that root and returns absolute paths in `src/trpc/projects-api.ts:1003` and `src/trpc/projects-api.ts:1070`.
- `addProject` can add or create directories and initialize Git for arbitrary resolved paths in `src/trpc/projects-api.ts:283`.
- These project procedures are non-workspace procedures in `src/trpc/app-router.ts:1157`.

Impact:
- In remote mode, an authenticated remote user can enumerate much of the server host's non-hidden directory tree and learn absolute paths.
- The same user can add or create projects at arbitrary accessible locations and potentially initialize Git there.
- This is expected for a local desktop folder picker, but it is too broad for a network-exposed runtime.

Recommendation:
- In remote mode, restrict project browsing and creation to configured roots such as the user's home, a workspace base directory, or explicitly allowed folders.
- Return display paths relative to the allowed root where possible.
- Consider a separate "host administrator" capability for adding arbitrary paths.

### 9. `runtime.openFile` opens arbitrary host paths or URLs

Evidence:
- The schema accepts any `filePath` string in `src/core/api-contract.ts:1817`.
- The endpoint trims and passes the value to `openInBrowser` with no protocol or root validation in `src/trpc/runtime-api.ts:2356`.
- `openInBrowser` delegates to the `open` package in `src/server/browser.ts:11`.

Impact:
- Any authenticated browser client can ask the host OS to open arbitrary files, directories, URLs, or protocol handlers.
- This can produce phishing prompts, launch local applications, trigger custom protocol handlers, or leak local path information.

Recommendation:
- Replace this with typed intents for known artifacts, for example `openRuntimeDataDir`, `openEvidenceBundle`, or `openPlanArtifact`.
- Validate every target against a known workspace/runtime-output root before launching it.
- Disable this endpoint in remote/headless mode unless explicitly allowed.

### 10. Desktop shell trusts an existing runtime based on a spoofable HTML title

Evidence:
- The health check accepts responses containing `<title>!Klein</title>` or `<title>Kanban</title>` in `packages/desktop/src/runtime-orchestrator.ts:33`.
- `checkHealth` only fetches `/` and tests the body for those strings in `packages/desktop/src/runtime-orchestrator.ts:105`.
- If healthy, the desktop attaches to that existing origin in `packages/desktop/src/runtime-orchestrator.ts:144`.
- The preload bridge exposes `window.desktop.openProjectWindow` and `window.desktop.restartRuntime` in `packages/desktop/src/preload.ts:3`.
- The BrowserWindow has good baseline isolation settings in `packages/desktop/src/window-registry.ts:68`, but the page origin still receives the desktop bridge.

Impact:
- A local process that binds the runtime port first and serves a matching title can make the Electron shell load attacker-controlled content with access to the limited desktop bridge.
- The current bridge is small, but this creates a phishing/confused-deputy risk and is fragile if the bridge grows.

Recommendation:
- Replace title matching with an authenticated health endpoint or nonce challenge known only to a child process that the desktop spawned.
- Do not expose the desktop preload bridge to an attached runtime that cannot prove it is the real runtime.
- Consider refusing to attach to pre-existing runtimes in packaged desktop builds unless explicitly enabled.

## Low

### 11. Chat host-action audit log records only tool names, not the sensitive action summary

Evidence:
- The gated executor records `detail: tool.name` for every tool call in `src/chat/chat-tool-executor.ts:69`.
- The audit schema says `detail` should be a short action description such as the command or path in `src/chat/chat-host-action-audit-store.ts:21`.

Impact:
- If a command, browser navigation, or host action causes damage, the audit log may only show `run_command` or `browse_url`, not what actually ran or which URL was fetched.
- This weakens forensic value and makes it harder to review whether auto-approval behaved correctly.

Recommendation:
- Record redacted command strings, URLs, cwd, path, safety classification, and confirmation source.
- Keep existing secret/path redaction discipline before writing audit records.

### 12. Runtime app is served without a Content Security Policy or common hardening headers

Evidence:
- The runtime server asset response sets only `Content-Type` and `Cache-Control` in `src/server/runtime-server.ts:1028`.
- The disconnected Electron fallback does include a CSP meta tag in `packages/desktop/src/disconnected.html:6`, but the main runtime app has no equivalent server header.
- The frontend currently uses `dangerouslySetInnerHTML` only for Prism-highlighted code/diff output in `web-ui/src/components/detail-panels/nklein-markdown-content.tsx:133` and `web-ui/src/components/shared/diff-renderer.tsx:513`; tested Prism payloads escaped raw `<` characters, so I am not listing that as an active XSS bug.

Impact:
- A future XSS regression in markdown, diff, logs, tool output, or model-rendered content would have less containment.
- The Electron shell and remote runtime would both benefit from defense-in-depth headers.

Recommendation:
- Add a CSP header for the runtime app, tuned for the bundled frontend and local API/WebSocket needs.
- Also add `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and `frame-ancestors 'none'`.
- Add tests that verify the headers on `index.html` and static assets.

## Reviewed But Not Listed As Active Issues

- Passcode generation and session cookies use cryptographic randomness, `HttpOnly`, `SameSite=Strict`, and in-memory session storage. The main weakness is transport and environment propagation, covered above.
- The runtime host/origin middleware restricts allowed hosts and origins. That does not mitigate authenticated or same-origin backend endpoints that accept raw host actions.
- `ReactMarkdown` is used without `rehypeRaw`, so ordinary markdown HTML is escaped.
- No committed `.env` file was found; only `web-ui/.env.example` matched the env-file scan.
- Dependency advisories were not checked. Run `npm audit` / `npm audit --prefix web-ui` / `npm audit --prefix packages/desktop` in a connected environment before release.
