# klein-go-starter

A deliberately small Go module used as a dev-test fixture for multi-language scenarios (F12.90).

It exists to prove the harness works OUTSIDE TypeScript: `detectToolchains` must find `go.mod` and pick
`go build ./...` / `go test ./...`, and `parseCompilerDiagnostics` must read Go's `file:line:col: message`
diagnostic dialect rather than tsc's.

Acceptance: `go test ./...`
