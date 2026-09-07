/**
 * Sandbox-leak gate: a delivery must not couple the repository to the sandbox it was produced in.
 *
 * v31 factory 2026-09-07: while the sandbox had no registry access (the egress-claim 403, fixed 2026-09-06), the
 * s03-prng-tree worker "made the tests pass" by committing a `vitest_node_modules` symlink to `/opt/nklein/node_modules`,
 * a `_run_test.js` that shells out to `/opt/nklein/node_modules/.bin/vitest`, `package.json` scripts pointing at that
 * symlink and at `/usr/local/bin/tsc`, an `install.out` npm error log and a `repository.url` of `/repos/<hash>`. A weak
 * reviewer approved it, the plan integration gate then failed with exit 127 on every host without that symlink, and
 * every later card inherited the broken toolchain. None of that is project work — it is the environment leaking into
 * the artifact. This deterministic pre-review gate bounces such a delivery with a brief that names every leak, so the
 * worker fixes the coupling instead of a reviewer having to notice it. Zero model cost; `NKLEIN_SANDBOX_LEAK_GATE=0`
 * disables it.
 */

export const SANDBOX_LEAK_GATE_ENV = "NKLEIN_SANDBOX_LEAK_GATE";

export type SandboxLeakKind =
	/** A symlink whose target is an absolute path — it points outside the repository, into the sandbox image. */
	| "symlink_outside_repo"
	/** A sandbox-internal path (`/opt/nklein`, `/repos/<hash>`, `/tmp/nklein-…`, `nklein-home-…`) in added content. */
	| "sandbox_path"
	/** A newly added file that is an npm/pip install log. */
	| "install_log"
	/** A manifest script wired to an absolute binary path instead of the project's own toolchain. */
	| "absolute_toolchain_path";

export interface SandboxLeakFinding {
	path: string;
	kind: SandboxLeakKind;
	/** The offending added line (trimmed, clamped). */
	evidence: string;
}

export interface SandboxLeakDecision {
	findings: SandboxLeakFinding[];
	verdict: "pass" | "bounce";
	summary: string;
	feedback: string | null;
}

const SANDBOX_PATH_PATTERN = /\/opt\/nklein\b|\/repos\/[0-9a-f]{6,}\b|\/tmp\/nklein-|nklein-home-\d+/u;
const INSTALL_LOG_PATTERN = /^\+(?:npm (?:error|ERR!)|ERROR: (?:Could not|No matching distribution)|pip\._vendor)/u;
const ABSOLUTE_TOOLCHAIN_PATTERN =
	/(?:^|[\s"'`|&;:(])\/(?:usr\/local\/bin|usr\/bin|opt|root|home\/[^/\s"']+)\/[^\s"'`]+/u;
const MANIFEST_BASENAMES = new Set([
	"package.json",
	"pyproject.toml",
	"cargo.toml",
	"makefile",
	"justfile",
	"taskfile.yml",
]);
const EVIDENCE_MAX_CHARS = 160;
const MAX_FINDINGS = 12;

function basenameOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash >= 0 ? path.slice(slash + 1) : path;
}

function clampEvidence(line: string): string {
	const trimmed = line.trim();
	return trimmed.length > EVIDENCE_MAX_CHARS ? `${trimmed.slice(0, EVIDENCE_MAX_CHARS)}…` : trimmed;
}

/** Scan a unified diff for environment coupling. Pure; tolerant of an empty/null diff (pass). */
export function decideSandboxLeak(diff: string | null | undefined): SandboxLeakDecision {
	const findings: SandboxLeakFinding[] = [];
	const seen = new Set<string>();
	const add = (finding: SandboxLeakFinding): void => {
		const key = `${finding.path}\0${finding.kind}`;
		if (seen.has(key) || findings.length >= MAX_FINDINGS) {
			return;
		}
		seen.add(key);
		findings.push(finding);
	};
	let path = "";
	let newFile = false;
	let symlink = false;
	for (const line of (diff ?? "").split("\n")) {
		if (line.startsWith("diff --git ")) {
			const match = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
			path = match?.[2] ?? "";
			newFile = false;
			symlink = false;
			continue;
		}
		if (line.startsWith("new file mode ")) {
			newFile = true;
			symlink = line.endsWith("120000");
			continue;
		}
		if (line.startsWith("index ") && line.endsWith(" 120000")) {
			symlink = true;
			continue;
		}
		if (line.startsWith("+++ b/")) {
			path = line.slice("+++ b/".length);
			continue;
		}
		if (!line.startsWith("+") || line.startsWith("+++")) {
			continue;
		}
		const added = line.slice(1);
		if (symlink) {
			if (added.startsWith("/")) {
				add({ path, kind: "symlink_outside_repo", evidence: clampEvidence(`symlink -> ${added}`) });
			}
			continue;
		}
		if (SANDBOX_PATH_PATTERN.test(added)) {
			add({ path, kind: "sandbox_path", evidence: clampEvidence(added) });
		}
		if (newFile && INSTALL_LOG_PATTERN.test(line)) {
			add({ path, kind: "install_log", evidence: clampEvidence(added) });
		}
		if (MANIFEST_BASENAMES.has(basenameOf(path).toLowerCase()) && ABSOLUTE_TOOLCHAIN_PATTERN.test(added)) {
			add({ path, kind: "absolute_toolchain_path", evidence: clampEvidence(added) });
		}
	}
	if (findings.length === 0) {
		return { findings, verdict: "pass", summary: "No sandbox coupling in the delivery.", feedback: null };
	}
	const lines = findings.map((finding) => `- ${finding.path} (${describeKind(finding.kind)}): ${finding.evidence}`);
	return {
		findings,
		verdict: "bounce",
		summary: "Sandbox-leak gate: the delivery couples the repository to the sandbox environment",
		feedback:
			"This delivery wires the repository to paths that exist only inside the build sandbox, so it breaks on every " +
			"other machine and cannot be merged:\n" +
			`${lines.join("\n")}\n\n` +
			"Fix it in the repository: delete symlinks and helper scripts that point at sandbox paths, keep package " +
			"scripts on the project's own toolchain (e.g. `vitest run`, `tsc --noEmit`), and never commit install logs, " +
			"prompt dumps or scratch runners. The sandbox already has the project's dependencies installed before your " +
			"first turn — run the project's own commands (`npm test`, `npm run typecheck`) instead of building a workaround.",
	};
}

function describeKind(kind: SandboxLeakKind): string {
	switch (kind) {
		case "symlink_outside_repo":
			return "symlink into the sandbox image";
		case "sandbox_path":
			return "sandbox-internal path";
		case "install_log":
			return "committed install log";
		case "absolute_toolchain_path":
			return "manifest script bound to an absolute binary path";
	}
}
