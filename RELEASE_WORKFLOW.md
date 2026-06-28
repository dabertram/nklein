# !Klein release workflow

> **Status (2026-06-28):** we are on the initial fork-off branch with **no CI and no published release yet**. The
> inherited Cline GitHub Actions workflows were removed; our own CI/publish pipeline is deferred until the product is
> mature (todo.md §5.J "set up our own CI"). Until then, releasing is **fully manual + local**. This doc describes that
> manual process; revisit it when CI lands.

Version naming follows the fork split:

- new fork releases use `!Klein` version headings in `CHANGELOG.md`
- earlier inherited release history stays labeled as `Cline Kanban`
- the repository/package plumbing may still reference `kanban` where compatibility requires it

## Manual release steps

1. **Update `CHANGELOG.md`** — add a section for the new version. The heading format must match what
   `scripts/extract-changelog-entry.mjs` expects (so release notes can be extracted): `## [X.Y.Z] - YYYY-MM-DD`.
2. **Bump `package.json`** version to `X.Y.Z`.
3. **Verify green locally** — `npm run prepublishOnly` (runs build + checks), plus the usual gate
   (`tsc` · `web:typecheck` · `biome`/`lint` · `test:fast` · web vitest). Don't release red.
4. **Commit + push** those changes.
5. **Tag + push** a matching `vX.Y.Z` tag (or a prerelease like `vX.Y.Z-beta.1`):
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
6. **Publish locally** (when actually publishing to npm):
   ```bash
   npm publish --provenance --access public
   ```
   The `prepublishOnly` hook re-runs build + checks first. Confirm `tag == v${package.json version}` before publishing.
7. **Release notes** — extract the version's section for a GitHub Release body:
   ```bash
   node scripts/extract-changelog-entry.mjs <version>
   ```

## Common failure causes

- The tag doesn't match the `package.json` version.
- `CHANGELOG.md` is missing, or its section for that version is missing/empty (breaks `extract-changelog-entry.mjs`).
- Build / tests / checks fail.

## When CI is set up (deferred — todo.md §5.J)

Automate the above: run the full green gate on push/PR, and a manual-dispatch publish that validates the tag, runs the
gate, publishes with provenance, and creates a GitHub Release from the extracted changelog section. The
`scripts/extract-changelog-entry.mjs` helper is written to be reused by that pipeline.
