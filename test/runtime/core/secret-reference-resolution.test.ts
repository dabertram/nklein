import { readFileSync } from "node:fs";
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

describe("P21.13b — a resolved secret value never reaches a prompt or a log", () => {
	// Adversarial values, each chosen for a way a naive implementation could leak it: one that carries the
	// reference syntax itself, one with regex metacharacters that could break a redactor, one non-ASCII.
	//
	// DELIBERATELY EXCLUDED, and the reason is the point: a secret whose VALUE equals (or is a substring of) a
	// KEY NAME cannot be checked this way at all. The description legitimately prints key names, so
	// `not.toContain(secret)` fails on a value of "ANTHROPIC_API_KEY" even though nothing leaked — the assertion
	// cannot tell a leak from a correct key mention when the two are the same string. Example-based tests are
	// structurally blind to that case, which is exactly why the source-level RATCHET below carries the real
	// weight: it covers every value, including the ones no assertion can distinguish.
	const SECRETS = ["sk-live-51H8xQ2vAbCdEf", "env://NOT_REALLY_A_REFERENCE", "p@ss.*[word]+$", "пароль-٧٨٩"];

	it("keeps every secret value out of the human-facing description", () => {
		for (const secret of SECRETS) {
			const resolution = resolveSecretReferences(
				{ ANTHROPIC_API_KEY: "env://HOST_SECRET", PLAIN: "not-a-secret", MISSING: "env://NOT_SET", BAD: "env://" },
				{ HOST_SECRET: secret },
			);
			const description = describeSecretReferenceResolution(resolution);

			// The value is in `env` — that is the ONLY place it may be, because that map goes to the child process.
			expect(resolution.env.ANTHROPIC_API_KEY).toBe(secret);
			// …and nowhere in the text a caller would log.
			expect(description).not.toContain(secret);
			// The description still has to be USEFUL, or a future author will reach for the env map instead.
			expect(description).toContain("ANTHROPIC_API_KEY");
			expect(description).toContain("MISSING");
			expect(description).toContain("BAD");
		}
	});

	it("keeps a LITERAL configured value out of the description too", () => {
		// Not every credential arrives as a reference — an unconverted config still holds literals, and the whole
		// point of incremental adoption is that those keep working. They must not become the leak.
		const literal = "literal-token-do-not-log";
		const resolution = resolveSecretReferences({ TOKEN: literal }, {});
		expect(resolution.env.TOKEN).toBe(literal);
		expect(describeSecretReferenceResolution(resolution)).not.toContain(literal);
	});

	it("RATCHET: describeSecretReferenceResolution never reads the value-carrying `env` map", () => {
		// The comment above the function claims it is "value-free by construction". This pins that claim
		// mechanically, because the failure mode is a future edit that adds the resolved map "just for debugging"
		// — which is exactly what the comment warns about and what no example-based test would catch for a value
		// it did not happen to try. A source-level ratchet is the only thing that covers all future values.
		const source = readFileSync("src/core/secret-reference-resolution.ts", "utf8");
		const start = source.indexOf("export function describeSecretReferenceResolution");
		expect(start).toBeGreaterThan(-1);
		const body = source.slice(start, source.indexOf("\n}", start));
		expect(body).not.toMatch(/resolution\.env\b/);
		expect(body).not.toMatch(/\benv\[/);
	});
});
