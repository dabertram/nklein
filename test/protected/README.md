# Protected Test Suite

Protected tests lock surfaced !Klein behavior that small local models should not casually weaken while editing the codebase.

Run them with:

```sh
npm run test:protected
```

The canonical protected list is `test/protected/protected-tests.json`. Each entry has a short rationale so a contributor can tell which product behavior would be affected by changing it.

Changing protected tests, the protected manifest, or this protected-suite config requires explicit human approval. A valid proposal should state the intent, the diff, why the protected expectation must change, and the expected product effects. Default is deny.

Current protected groups:

- `cline-local-only-policy`: local-only provider policy and cloud hiding boundary.
- `cline-context-window-policy`: effective context-window and overflow guard behavior.
- `cline-timeout-scaling`: slow local model timeout scaling and body-timeout recovery.
- `swarm-guardrails`: swarm stop/resume and autonomous guardrails.
- `workspace-registry`: workspace identity, ownership, and project-health diagnostics.
- `cline-decomposition-tool`: decomposition graph application and Planning artifacts.
