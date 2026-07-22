# Desktop release trust and activation

!Klein desktop releases use three independent checks:

1. Every installer is pinned by SHA-256 in `nklein-desktop-release.json` and `SHA256SUMS`.
2. The manifest is signed with an offline Ed25519 release key. Stable/beta clients reject missing, unknown, or invalid
   signatures before trusting any checksum or URL. This is the Linux authenticity boundary as well as protection against
   release-record tampering on macOS and Windows.
3. macOS apps are Developer ID signed, notarized, and stapled; Windows installers are Authenticode signed. The release
   workflow verifies those results before it labels the corresponding manifest assets as signed.

The workflow uses locked dependencies, fixed runner images/Node, deterministic artifact names, and SHA-256/provenance
attestations. This makes the build recipe repeatable and the exact produced bytes independently identifiable. It does not
claim bit-for-bit reproducibility across Apple/Microsoft signatures, timestamps, or electron-builder host tooling.

## One-time credential activation

Generate an Ed25519 keypair offline. Add the public PEM under a stable key id in
`packages/desktop/src/release-trust.ts`; set that same id as the GitHub Actions variable
`NKLEIN_RELEASE_MANIFEST_KEY_ID`; store only the base64-encoded PKCS#8 private PEM as the protected environment secret
`NKLEIN_RELEASE_MANIFEST_PRIVATE_KEY`. Ship overlapping old+new public keys before rotating the signing key.

The protected release environment also needs:

- macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`;
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`.

Create these values in a GitHub environment named `desktop-release`, restrict that environment to release tags, and
require a human reviewer. This prevents a tag alone from granting a workflow access to the signing material.

Stable/beta packaging fails before building when native signing credentials are missing. Release assembly also proves the
private manifest key matches a public key embedded in the packaged client, so merely adding a secret cannot publish an
unreadable update. Dev/nightly builds remain explicitly credential-free and checksum-only.

Push a version tag only after both root and desktop `package.json` versions match it. `vX.Y.Z-beta.N` selects beta;
other `v*` tags select stable. The workflow builds x64/arm64 packages on native fixed runners, verifies signatures,
assembles and signs the manifest, creates GitHub artifact attestations, and publishes the release in one fan-in job.
