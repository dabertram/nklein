/**
 * Audit detail builder for the chat host-action log (§5.Y #11). Converts a tool call's name and
 * parsed input arguments into a short, human-readable action summary — the actual command run, URL
 * browsed, or path operated on — instead of the bare tool name.
 *
 * Redaction is mandatory: this text lands in the audit log and must never contain secrets or
 * host-absolute paths. Two layers:
 *  1. Secret-bearing flag/header values are masked (e.g. `--token=abc123` → `--token=…`).
 *  2. Host-absolute paths are not forwarded; workspace tools always provide workspace-relative
 *     paths in their arguments, so if an absolute path ever appears it is dropped in favour of
 *     just the tool name.
 */

/** Maximum length for any detail string written to the audit log. */
const MAX_DETAIL_CHARS = 512;

/**
 * Patterns matching secret-bearing command-line flags, HTTP headers, and common env-var
 * assignments. Each is replaced with `<key>=…` / `<flag>=…` so the flag name is still visible in
 * the log but the value is masked.
 *
 * Ordered from most to least specific. Matched case-insensitively.
 */
const SECRET_FLAG_PATTERNS: RegExp[] = [
	// --token=VALUE  /  --password=VALUE  /  --secret=VALUE  /  --api-key=VALUE  /  --auth=VALUE
	// (double-dash flags)
	/--(?:token|password|secret|api[-_]?key|auth(?:orization)?|credential|private[-_]?key|access[-_]?key)=\S+/giu,
	// -p VALUE (short form: single dash + single letter, captured with a lookahead for a non-flag next token)
	// — too broad to reliably catch, skip; stick to `=VALUE` forms.
	// Authorization: Bearer VALUE  or  Authorization: TOKEN  (HTTP header in curl-style -H "…")
	// Matches everything after the colon up to the end of the token string or a closing quote.
	/(?:Authorization|X-Api-Key|Api-Key)\s*:\s*[^'"}\]]+/giu,
	// ENV=VALUE assignments before a command, e.g. TOKEN=abc123 cmd ...
	// Only mask values for known-secret env var names to avoid false-positives on benign vars.
	/\b(?:TOKEN|PASSWORD|SECRET|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTHORIZATION|CREDENTIAL)=[^\s"']+/giu,
	// Long opaque hex / base64-ish tokens (32+ chars) appearing as standalone flag values or bare tokens.
	// These are not anchored to a flag name — they are high-entropy strings that look like credentials.
	/(?:^|\s)([A-Za-z0-9+/=_-]{32,})(?=\s|$)/gm,
];

/**
 * Mask secret-bearing patterns in a command string. Returns the redacted string.
 * Named flags/headers have their value replaced with `…`; bare high-entropy tokens are replaced
 * with `[redacted]`.
 */
function redactSecrets(value: string): string {
	let result = value;

	// Named flag / header / env patterns: replace the whole match's value portion with `…`.
	// The first three patterns all have the form `KEY=VALUE` or `KEY: VALUE`, so we can replace
	// the value part. We do this by replacing the full match and reconstructing the key part.
	for (const pattern of SECRET_FLAG_PATTERNS.slice(0, 3)) {
		result = result.replace(pattern, (match) => {
			// Find the separator (= or :) and replace everything after it.
			const eqIdx = match.indexOf("=");
			const colonIdx = match.indexOf(":");
			if (eqIdx !== -1 && (colonIdx === -1 || eqIdx < colonIdx)) {
				return `${match.slice(0, eqIdx + 1)}…`;
			}
			if (colonIdx !== -1) {
				return `${match.slice(0, colonIdx + 1)} …`;
			}
			return match;
		});
	}

	// Bare high-entropy token pattern: only mask tokens that are standalone (preceded/followed by
	// whitespace or start/end), and only if they look random enough (no repeating chars, mixed case
	// or digits). A simple heuristic: more than 4 distinct char classes present.
	result = result.replace(SECRET_FLAG_PATTERNS[3], (match, token: string) => {
		if (!token) {
			return match;
		}
		const distinctChars = new Set(token).size;
		// Only mask if the token has high apparent entropy (many distinct chars relative to length).
		if (distinctChars >= token.length * 0.4 && distinctChars >= 8) {
			return match.replace(token, "[redacted]");
		}
		return match;
	});

	return result;
}

/**
 * Return true when a string is a host-absolute path (starts with `/` on POSIX or a drive letter
 * on Windows). Workspace tools always hand workspace-relative paths to the agent, so an absolute
 * path in an argument is an anomaly and should not be logged verbatim.
 */
function isAbsolutePath(value: string): boolean {
	// POSIX absolute
	if (value.startsWith("/")) {
		return true;
	}
	// Windows absolute: C:\ or C:/
	if (/^[A-Za-z]:[/\\]/u.test(value)) {
		return true;
	}
	return false;
}

/** Truncate a string to the audit log character cap and append a note. */
function capDetail(value: string): string {
	if (value.length <= MAX_DETAIL_CHARS) {
		return value;
	}
	return `${value.slice(0, MAX_DETAIL_CHARS)}…`;
}

/**
 * Build the `detail` string for one audit log entry from the tool name and the parsed call
 * arguments. Returns a workspace-relative, redacted summary of what the tool was asked to do.
 *
 * Per-tool rules:
 * - `run_command`  → command string (+ cwd if present), with secrets masked.
 * - `browse_url`   → the URL (always safe; no secrets expected).
 * - `write_file` / `edit_file` / `read_file` / `list_dir` / `read_large_file` → the path arg
 *   (rejected if it is an absolute host path — that should never happen but guards the invariant).
 * - Everything else → falls back to the tool name.
 */
export function buildAuditDetail(toolName: string, args: Record<string, unknown>): string {
	switch (toolName) {
		case "run_command": {
			const command = typeof args.command === "string" ? args.command.trim() : "";
			if (!command) {
				return toolName;
			}
			const redacted = redactSecrets(command);
			const cwd = typeof args.cwd === "string" ? args.cwd.trim() : "";
			const detail = cwd ? `${redacted} (cwd: ${cwd})` : redacted;
			return capDetail(detail);
		}

		case "browse_url": {
			const url = typeof args.url === "string" ? args.url.trim() : "";
			if (!url) {
				return toolName;
			}
			return capDetail(url);
		}

		case "write_file":
		case "edit_file":
		case "read_file":
		case "list_dir":
		case "read_large_file": {
			const path = typeof args.path === "string" ? args.path.trim() : "";
			if (!path) {
				return toolName;
			}
			// Guard: refuse to log host-absolute paths (should not happen — workspace tools always
			// supply relative paths — but if they ever do, fall back to the tool name).
			if (isAbsolutePath(path)) {
				return toolName;
			}
			return capDetail(`${toolName}: ${path}`);
		}

		default:
			return toolName;
	}
}
