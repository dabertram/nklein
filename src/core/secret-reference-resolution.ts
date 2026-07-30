/**
 * P21.13b — SECRETS AS REFERENCES, resolved only at execution. PURE core.
 *
 * ── THE IDEA ──
 * Configuration stores `env://OPENAI_API_KEY`, never the value. The reference is resolved host-side at the moment
 * a process is spawned, so the actual secret exists only in the child's environment — never in a config file,
 * never in a prompt, never in a log line, and never in anything the model can read. Redaction stops being a filter
 * that has to catch every serialisation site and becomes a property of the data: there is no value present to leak.
 *
 * That distinction matters here specifically. A filter is only as good as its pattern, and this codebase has
 * already been bitten from both directions on the same day — a redaction pattern that ate 19 legitimate
 * measurement keys because `token` is a substring of `inputTokens`, and telemetry that looked half-populated as a
 * result. **Not writing the secret down in the first place cannot be defeated by a bad regex.**
 *
 * ── WHAT IT REFUSES TO DO ──
 * An UNRESOLVABLE reference is DROPPED and reported, never passed through as its literal text. Forwarding
 * `env://OPENAI_API_KEY` verbatim would hand the child a string that looks like a credential, and the failure
 * would surface as a puzzling upstream auth rejection rather than as "you have not set that variable". Dropping
 * it makes the variable plainly absent, which is the diagnosable failure.
 *
 * Values are never returned in any summary or diagnostic this module produces — only NAMES. Anything that wants
 * to log what happened gets {@link describeSecretReferenceResolution}, which is value-free by construction rather
 * than by the caller remembering.
 */

/** The scheme marking a value as a reference rather than a literal. */
const SECRET_REFERENCE_PREFIX = "env://";

/** Environment variable names: the portable subset, so a malformed reference cannot smuggle shell syntax. */
const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SecretReferenceResolution {
	/** The environment to hand the child process. Literals pass through; references are replaced by their values. */
	readonly env: Readonly<Record<string, string>>;
	/** Keys whose reference named a variable that is not set in the host environment. Dropped from `env`. */
	readonly unresolvedKeys: readonly string[];
	/** Keys whose reference was malformed (empty or not a valid variable name). Dropped from `env`. */
	readonly malformedKeys: readonly string[];
	/** Keys that carried a reference and were successfully resolved. */
	readonly resolvedKeys: readonly string[];
}

/** Is this configured value a secret REFERENCE rather than a literal? */
export function isSecretReference(value: string): boolean {
	return value.startsWith(SECRET_REFERENCE_PREFIX);
}

/** The variable name a reference points at, or null when the value is not a well-formed reference. */
export function secretReferenceTarget(value: string): string | null {
	if (!isSecretReference(value)) {
		return null;
	}
	const target = value.slice(SECRET_REFERENCE_PREFIX.length).trim();
	return ENV_VAR_NAME_PATTERN.test(target) ? target : null;
}

/**
 * Resolve `env://VAR` references against the host environment.
 *
 * Literal values are passed through untouched — this is deliberately opt-in per value, so adopting references is
 * incremental and an unconverted config keeps working exactly as before.
 */
export function resolveSecretReferences(
	configured: Readonly<Record<string, string>> | undefined,
	hostEnv: Readonly<Record<string, string | undefined>>,
): SecretReferenceResolution {
	const env: Record<string, string> = {};
	const unresolvedKeys: string[] = [];
	const malformedKeys: string[] = [];
	const resolvedKeys: string[] = [];

	for (const [key, value] of Object.entries(configured ?? {})) {
		if (!isSecretReference(value)) {
			env[key] = value;
			continue;
		}
		const target = secretReferenceTarget(value);
		if (target === null) {
			// `env://` with nothing after it, or a name with shell-significant characters. Dropped rather than
			// guessed at — a reference we cannot read is not a value we may invent.
			malformedKeys.push(key);
			continue;
		}
		const resolved = hostEnv[target];
		if (resolved === undefined || resolved === "") {
			// Absent OR empty. An empty string is not a usable credential, and forwarding one produces the same
			// confusing upstream auth failure as forwarding the literal reference would.
			unresolvedKeys.push(key);
			continue;
		}
		env[key] = resolved;
		resolvedKeys.push(key);
	}

	return {
		env,
		unresolvedKeys,
		malformedKeys,
		resolvedKeys,
	};
}

/**
 * A log-safe description of what happened. Names only — NEVER values, and never the host variable names' contents.
 *
 * Value-free by construction: callers cannot accidentally log a secret through this, which is the point. If it
 * returned the resolved map "just for debugging", the first person to log it would undo the whole mechanism.
 */
export function describeSecretReferenceResolution(resolution: SecretReferenceResolution): string {
	const parts: string[] = [];
	if (resolution.resolvedKeys.length > 0) {
		parts.push(
			`resolved ${resolution.resolvedKeys.length} reference(s): ${[...resolution.resolvedKeys].sort().join(", ")}`,
		);
	}
	if (resolution.unresolvedKeys.length > 0) {
		parts.push(
			`DROPPED ${resolution.unresolvedKeys.length} unset reference(s): ${[...resolution.unresolvedKeys].sort().join(", ")} — set the named host variable(s), or the child will see them as absent`,
		);
	}
	if (resolution.malformedKeys.length > 0) {
		parts.push(
			`DROPPED ${resolution.malformedKeys.length} malformed reference(s): ${[...resolution.malformedKeys].sort().join(", ")} — expected env://VARIABLE_NAME`,
		);
	}
	return parts.length === 0 ? "no secret references configured" : parts.join("; ");
}
