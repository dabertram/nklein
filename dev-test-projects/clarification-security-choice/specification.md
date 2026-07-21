Add a small authentication-mode configuration to this TypeScript CLI fixture.

Requirements:
- Support one authentication mode selected from `oidc` or `password`.
- Print the selected mode from `src/index.ts`.
- Add a deterministic test for the selected mode.
- Do not add dependencies.

Open product decision:
- The migration choice is intentionally unresolved. OIDC is safer for a new deployment, while password mode preserves
  compatibility with an existing deployment. Whether the target deployment is new or existing is an external fact
  deliberately absent from this repository; it must not be inferred from the fixture. Choosing incorrectly affects
  authentication and migration behavior.
- Planning must record this as an open question. It may carry a temporary working assumption so decomposition can
  proceed, but it must not silently lock the decision as answered or assumed-default.
