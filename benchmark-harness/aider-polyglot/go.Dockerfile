FROM golang@sha256:1699c10032ca2582ec89a24a1312d986a3f094aed3d5c1147b19880afe40e052

# Candidate patches are applied inside the sealed grader boundary. The upstream
# Alpine Go image intentionally contains the toolchain only, so make the grader's
# patching dependency explicit and version-pinned instead of assuming `git` exists.
RUN apk add --no-cache git=2.47.3-r0
