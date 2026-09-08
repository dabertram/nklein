import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const INPUT_DIR = "input";
const ROUTE_TABLE = "routes.mjs";
const KINDS = ["sql_injection", "missing_authorization", "unsafe_deserialization", "hardcoded_secret"];
const LADDER = ["low", "medium", "high", "critical"];
const BASE_SEVERITY = {
	sql_injection: "high",
	missing_authorization: "high",
	unsafe_deserialization: "high",
	hardcoded_secret: "medium",
};

function raise(severity) {
	return LADDER[Math.min(LADDER.indexOf(severity) + 1, LADDER.length - 1)];
}

function readSources() {
	const sources = new Map(); // "input/name.mjs" -> lines
	for (const entry of readdirSync(join(root, INPUT_DIR), { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
		sources.set(`${INPUT_DIR}/${entry.name}`, readFileSync(join(root, INPUT_DIR, entry.name), "utf8").split("\n"));
	}
	return sources;
}

/** The nearest enclosing top-level function of a line, or null when the line sits at module scope. */
function enclosingFunction(lines, lineIndex) {
	for (let cursor = lineIndex; cursor >= 0; cursor -= 1) {
		if (cursor < lineIndex && /^\}/.test(lines[cursor])) return null;
		const declaration = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(lines[cursor]);
		if (declaration) return declaration[1];
	}
	return null;
}

/** The lines of a declared function's body, as [startIndex, endIndexExclusive). */
function functionBody(lines, startIndex) {
	for (let cursor = startIndex + 1; cursor < lines.length; cursor += 1) {
		if (/^\}/.test(lines[cursor])) return [startIndex, cursor + 1];
	}
	return [startIndex, lines.length];
}

/**
 * The truth set is DERIVED from the evidence on every run — this file is a verifier, not an answer key. It names
 * no file, no line and no severity. Re-implementing these rules is not a shortcut past the work; it IS the work.
 */
function deriveTruth(sources, routeAuthByHandler) {
	const truth = new Map(); // "file:line:kind" -> severity

	function record(file, lineNumber, kind, extra = {}) {
		const lines = sources.get(file);
		const owner = enclosingFunction(lines, lineNumber - 1);
		const routeAuth = owner ? routeAuthByHandler.get(owner) : undefined;
		let severity = BASE_SEVERITY[kind];
		if (routeAuth === "public") {
			severity = raise(severity);
		} else if (kind === "hardcoded_secret" && extra.liveKey === true) {
			severity = raise(severity);
		}
		truth.set(`${file}:${lineNumber}:${kind}`, severity);
	}

	for (const [file, lines] of sources) {
		if (file === `${INPUT_DIR}/${ROUTE_TABLE}`) continue;

		lines.forEach((line, index) => {
			// A query built by interpolating into a template literal instead of being parameterised.
			if (/\bdb\.query\(\s*`[^`]*\$\{/.test(line)) {
				record(file, index + 1, "sql_injection");
			}
			// Turning caller-supplied bytes back into live objects through the JavaScript evaluator.
			if (/\b(?:eval|new Function|vm\.runInNewContext)\s*\(/.test(line)) {
				record(file, index + 1, "unsafe_deserialization");
			}
			// A credential written into the source as a literal.
			const secret = /^\s*const\s+[A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*"([^"]{8,})"/.exec(line);
			if (secret) {
				record(file, index + 1, "hardcoded_secret", { liveKey: secret[1].startsWith("sk_live_") });
			}
			// An admin-only handler that never proves the caller is an admin.
			const declaration = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
			if (declaration && routeAuthByHandler.get(declaration[1]) === "admin") {
				const [start, end] = functionBody(lines, index);
				const guarded = lines.slice(start, end).some((bodyLine) => /\brequireAdmin\s*\(/.test(bodyLine));
				if (!guarded) {
					record(file, index + 1, "missing_authorization");
				}
			}
		});
	}

	return truth;
}

const sources = readSources();
const routeSource = sources.get(`${INPUT_DIR}/${ROUTE_TABLE}`).join("\n");
const routeAuthByHandler = new Map(
	[...routeSource.matchAll(/\{\s*path:\s*"[^"]*",\s*handler:\s*"([^"]+)",\s*auth:\s*"([^"]+)"\s*\}/g)].map((match) => [
		match[1],
		match[2],
	]),
);
const truth = deriveTruth(sources, routeAuthByHandler);
const deliverable = JSON.parse(readFileSync(join(root, "analysis/security.json"), "utf8"));

test("the deliverable keeps its shape", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.findings), "`findings` must be an array");
	assert.ok(routeAuthByHandler.size > 0, "the route table must parse — it is the evidence, do not edit it");
});

test("every recorded finding is real, located, classified and rated by the rubric", () => {
	const seen = new Set();
	for (const finding of deliverable.findings) {
		const where = JSON.stringify(finding);
		assert.ok(sources.has(finding.file), `\`${finding.file}\` is not part of the evidence: ${where}`);
		assert.ok(Number.isInteger(finding.line), `line must be an integer: ${where}`);
		assert.ok(
			finding.line >= 1 && finding.line <= sources.get(finding.file).length,
			`line is outside the file: ${where}`,
		);
		assert.ok(KINDS.includes(finding.kind), `kind must be one of ${KINDS.join(", ")}: ${where}`);
		assert.ok(LADDER.includes(finding.severity), `severity must be one of ${LADDER.join(", ")}: ${where}`);
		assert.equal(typeof finding.why, "string", `each finding needs a \`why\`: ${where}`);
		assert.ok(finding.why.trim().length >= 12, `\`why\` must actually explain the exposure: ${where}`);

		const key = `${finding.file}:${finding.line}:${finding.kind}`;
		assert.ok(!seen.has(key), `duplicate finding for ${key}`);
		seen.add(key);
		assert.ok(
			truth.has(key),
			`line ${finding.line} of ${finding.file} does not exhibit \`${finding.kind}\` — a wrong finding is worse than a missing one: ${where}`,
		);
		assert.equal(
			finding.severity,
			truth.get(key),
			`\`${finding.severity}\` is not what the rubric yields for this finding — re-derive its base and its modifier: ${where}`,
		);
	}
});

test("declaring the audit complete requires every finding, correctly rated", () => {
	if (deliverable.complete !== true) return;
	const found = new Set(deliverable.findings.map((finding) => `${finding.file}:${finding.line}:${finding.kind}`));
	const missing = [...truth.keys()].filter((key) => !found.has(key));
	assert.deepEqual(missing, [], `\`complete\` is true but these findings are unreported:\n  ${missing.join("\n  ")}`);
});
