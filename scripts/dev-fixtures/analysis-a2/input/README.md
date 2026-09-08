Evidence bundle: the `src/` tree of a small internal ESM package, lifted verbatim during a dead-code review.
Every module uses named ESM imports only (`import { name } from "./other.mjs";`) — no default exports, no
namespace imports, no re-exports. `index.mjs` is the package entry point. Read it; do not modify it.
