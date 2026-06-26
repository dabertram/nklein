# Dev-test project registry

This folder is the **registry of !Klein dev-test projects** — the decomposition / agent-stress scenarios the dev
build can scaffold into a throwaway workspace and run. Each project is a **self-contained folder**, so registering
a prepared project is just "add a folder here", with no code change.

The loader that discovers and validates these folders is `src/nklein-agent/dev-test-project-registry.ts`; the
scaffolding/runner that consumes them lives in `src/nklein-agent/nklein-dev-test-project.ts` (+ harness/runner).

## To register a prepared project

Add a folder `dev-test-projects/<id>/` containing:

| File               | Required | Purpose                                                                                        |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `project.json`     | yes      | The validated config (schema below). Its `id` **must equal the folder name**.                  |
| `specification.md` | yes      | The specification the agent reads. The scaffolder frames it with the title + an acceptance section. |
| `user-prompt.txt`  | yes      | The decomposition seed-card prompt (what the seed task is started with).                        |

That is the whole contract: drop those three files in a new folder and the project shows up in the registry.

## `project.json` schema

Validated by `devTestProjectConfigSchema` (zod, `.strict()`). Unknown keys are rejected.

```jsonc
{
  "id": "my_project",            // required — must equal the folder name
  "title": "My Project",         // required — H1 of the scaffolded spec + the seed-card title
  "acceptanceCommand": "npm test", // required — the acceptance command to verify generated work
  "agentId": "nklein",           // optional — agent that runs the seed card (default: native nklein agent)
  "startInPlanMode": true,       // optional — decomposition challenges plan first (default: true)
  "fixtureTemplate": "smoke-ts-cli", // optional — a folder under scripts/dev-fixtures/ copied as the starting code
  "tier": "12/20",               // optional — free-form complexity-tier label from the spec
  "tags": ["domain-a", "domain-b"], // optional — domain tags for grouping/filtering
  "enabled": true,               // optional — set false to keep the folder but exclude it from the listed registry
  "specificationPath": "scripts/dev-fixtures/daw-foundation-spec.md", // optional — repo-relative path to a larger
                                 // spec file used as the spec body instead of specification.md (then specification.md
                                 // just holds a short pointer line)
  "complexity": 74,              // optional — legacy 0-100 numeric estimate (migrated projects only; new ones use `tier`)
  "filesLikelyTouched": ["src/foo.ts"] // optional — UI hint for files the seed card is likely to touch
}
```

## What's in here

- **Migrated legacy scenarios** (the original in-code presets): `small-model-smoke`, `habit-insights-mid`,
  `habit-product-nklein-complex`, `audio-vst-psytrance`, `daw-foundation-platform`, and the parallel-fan-out set
  (`habit-wide-fanout`, `habit-deep-chain`, `habit-mixed-dag`, `habit-many-small`). These carry `complexity` /
  `fixtureTemplate` and back the named scenario constants the runner/UI/tests use.
- **`NN_<name>/` enhanced specs** — a graduated set of domain-heavy decomposition challenges (rising complexity
  tier) used to evaluate how well an agent decomposes a real domain, tracks knowledge debt, and builds a verifiable
  foundation. They all use `acceptanceCommand: npm test` and `startInPlanMode: true`.
- **`_ENHANCEMENT_GUIDELINES.md`** — the authoring guidelines those enhanced specs were written against (reference
  only; not a project).

## Fixtures / starting code

A project that needs starting code references a template folder under `scripts/dev-fixtures/` via
`fixtureTemplate` (e.g. `smoke-ts-cli`, `audio-vst-synth`, `daw-foundation`). The scaffolder copies that template
into the throwaway workspace, then writes `specification.md` on top. Projects without `fixtureTemplate` use the
default smoke template.
