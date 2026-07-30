import { describe, expect, it } from "vitest";
import {
	describeSecretReferenceResolution,
	isSecretReference,
	resolveSecretReferences,
	secretReferenceTarget,
} from "../../../src/core/secret-reference-resolution";

/**
 * P21.13b — guards for secrets-as-references.
 *
 * The whole value of this mechanism is that a secret is never written down anywhere !Klein serialises, so the
 * tests are weighted toward the two ways that could quietly stop being true: a value leaking into a diagnostic,
 * and an unresolvable reference being forwarded as text that merely LOOKS like a credential.
 */

const HOST = { REAL_KEY: "sk-live-secret-value", EMPTY: "", OTHER: "another-secret" };

describe("resolveSecretReferences", () => {
	it("replaces a reference with the host value, for the child process only", () => {
		const resolution = resolveSecretReferences({ OPENAI_API_KEY: "env://REAL_KEY" }, HOST);
		expect(resolution.env.OPENAI_API_KEY).toBe("sk-live-secret-value");
		expect(resolution.resolvedKeys).toEqual(["OPENAI_API_KEY"]);
	});

	it("passes LITERAL values through untouched, so adoption is incremental", () => {
		// An unconverted config must keep working exactly as before; otherwise nobody can migrate one server at a
		// time and the mechanism never gets adopted.
		const resolution = resolveSecretReferences({ LOG_LEVEL: "debug", PORT: "8080" }, HOST);
		expect(resolution.env).toEqual({ LOG_LEVEL: "debug", PORT: "8080" });
		expect(resolution.resolvedKeys).toEqual([]);
	});

	it("DROPS an unset reference instead of forwarding its literal text", () => {
		// Forwarding "env://MISSING" hands the child a string shaped like a credential. The failure then surfaces
		// as a puzzling upstream auth rejection rather than as "that variable is not set".
		const resolution = resolveSecretReferences({ OPENAI_API_KEY: "env://MISSING" }, HOST);
		expect(resolution.env.OPENAI_API_KEY).toBeUndefined();
		expect(Object.keys(resolution.env)).toEqual([]);
		expect(resolution.unresolvedKeys).toEqual(["OPENAI_API_KEY"]);
	});

	it("treats an EMPTY host value as unresolved — an empty string is not a credential", () => {
		const resolution = resolveSecretReferences({ KEY: "env://EMPTY" }, HOST);
		expect(resolution.env.KEY).toBeUndefined();
		expect(resolution.unresolvedKeys).toEqual(["KEY"]);
	});

	it("DROPS malformed references rather than guessing what was meant", () => {
		const resolution = resolveSecretReferences(
			{ A: "env://", B: "env://not a name", C: "env://has-dash", D: "env://$(whoami)" },
			HOST,
		);
		expect(Object.keys(resolution.env)).toEqual([]);
		expect([...resolution.malformedKeys].sort()).toEqual(["A", "B", "C", "D"]);
	});

	it("cannot smuggle shell syntax through a reference target", () => {
		// The name pattern is the portable subset, so a reference can never expand into command substitution even
		// if the value later reaches a shell.
		expect(secretReferenceTarget("env://$(rm -rf /)")).toBeNull();
		expect(secretReferenceTarget("env://FOO;BAR")).toBeNull();
		expect(secretReferenceTarget("env://VALID_NAME_1")).toBe("VALID_NAME_1");
	});

	it("handles an absent env map without inventing entries", () => {
		const resolution = resolveSecretReferences(undefined, HOST);
		expect(resolution.env).toEqual({});
		expect(resolution.resolvedKeys).toEqual([]);
	});

	it("recognises references without treating ordinary values as one", () => {
		expect(isSecretReference("env://KEY")).toBe(true);
		expect(isSecretReference("https://example.test")).toBe(false);
		expect(isSecretReference("sk-live-abc")).toBe(false);
	});
});

describe("describeSecretReferenceResolution", () => {
	it("NEVER contains a resolved value — the property the whole mechanism rests on", () => {
		// If a diagnostic ever carried the value, every log line that printed it would undo the design. This is
		// asserted against the summary of a resolution that DID succeed, which is the only case that could leak.
		const resolution = resolveSecretReferences(
			{ OPENAI_API_KEY: "env://REAL_KEY", ANTHROPIC_API_KEY: "env://OTHER" },
			HOST,
		);
		const description = describeSecretReferenceResolution(resolution);
		expect(description).not.toContain("sk-live-secret-value");
		expect(description).not.toContain("another-secret");
		// It names the KEYS, which is what makes it useful at all.
		expect(description).toContain("OPENAI_API_KEY");
		expect(description).toContain("ANTHROPIC_API_KEY");
	});

	it("names what was dropped and why, so a missing variable is diagnosable", () => {
		const resolution = resolveSecretReferences({ A: "env://MISSING", B: "env://" }, HOST);
		const description = describeSecretReferenceResolution(resolution);
		expect(description).toContain("unset reference");
		expect(description).toContain("malformed reference");
		expect(description).toContain("env://VARIABLE_NAME");
	});

	it("says so plainly when nothing was configured", () => {
		expect(describeSecretReferenceResolution(resolveSecretReferences({}, HOST))).toBe(
			"no secret references configured",
		);
	});
});
