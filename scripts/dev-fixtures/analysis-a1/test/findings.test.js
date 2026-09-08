import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SUBJECT = "input/order-service.mjs";
const KINDS = ["unchecked_find", "floating_promise", "missing_radix", "float_money"];

/**
 * The truth set is DERIVED from the evidence on every run — this file is a verifier, not an answer key. There are
 * no line numbers written down here. Re-implementing these rules is not a shortcut past the work; it IS the work.
 */
function deriveTruth(source) {
	const lines = source.split("\n");
	const truth = new Map(); // "line:kind" -> short why

	// 1. `parseInt(x)` with no radix.
	lines.forEach((line, index) => {
		if (/\bparseInt\(\s*[A-Za-z_$][\w$]*\s*\)/.test(line)) {
			truth.set(`${index + 1}:missing_radix`, "parseInt without an explicit radix");
		}
	});

	// 2. Money held in integer minor units multiplied into a fraction.
	lines.forEach((line, index) => {
		if (/Minor\b/.test(line) && /\/\s*100\b/.test(line)) {
			truth.set(`${index + 1}:float_money`, "minor-unit money forced into floating point");
		}
	});

	// 3. A value bound from `.find(` and dereferenced with no guard in between.
	lines.forEach((line, index) => {
		const bound = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*\.find\(/.exec(line);
		if (!bound) return;
		const name = bound[1];
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const candidate = lines[cursor];
			if (/^}/.test(candidate)) break; // left the function
			const guarded =
				new RegExp(`if\\s*\\(\\s*!\\s*${name}\\b`).test(candidate) ||
				new RegExp(`\\b${name}\\s*\\?\\??`).test(candidate) ||
				new RegExp(`\\b${name}\\s*===?\\s*undefined`).test(candidate);
			if (guarded) break;
			if (new RegExp(`\\b${name}\\.[A-Za-z_$]`).test(candidate)) {
				truth.set(`${cursor + 1}:unchecked_find`, `\`${name}\` from .find() dereferenced without a guard`);
				break;
			}
		}
	});

	// 4. A promise from a locally-declared async function that is never awaited or returned.
	const asyncNames = [...source.matchAll(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
	lines.forEach((line, index) => {
		if (/^\s*(export\s+)?async\s+function/.test(line)) return;
		for (const name of asyncNames) {
			if (!new RegExp(`\\b${name}\\s*\\(`).test(line)) continue;
			if (/\bawait\b/.test(line) || /\breturn\b/.test(line)) continue;
			truth.set(`${index + 1}:floating_promise`, `\`${name}()\` returns a promise nobody awaits`);
		}
	});

	return truth;
}

const source = readFileSync(join(root, SUBJECT), "utf8");
const truth = deriveTruth(source);
const sourceLineCount = source.split("\n").length;
const deliverable = JSON.parse(readFileSync(join(root, "analysis/findings.json"), "utf8"));

test("the deliverable keeps its shape", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.findings), "`findings` must be an array");
});

test("every recorded finding is real, located and correctly classified", () => {
	const seen = new Set();
	for (const finding of deliverable.findings) {
		const where = JSON.stringify(finding);
		assert.equal(finding.file, SUBJECT, `finding must cite ${SUBJECT}: ${where}`);
		assert.ok(Number.isInteger(finding.line), `line must be an integer: ${where}`);
		assert.ok(finding.line >= 1 && finding.line <= sourceLineCount, `line is outside the file: ${where}`);
		assert.ok(KINDS.includes(finding.kind), `kind must be one of ${KINDS.join(", ")}: ${where}`);
		assert.equal(typeof finding.why, "string", `each finding needs a \`why\`: ${where}`);
		assert.ok(finding.why.trim().length >= 12, `\`why\` must actually explain the defect: ${where}`);

		const key = `${finding.line}:${finding.kind}`;
		assert.ok(!seen.has(key), `duplicate finding for ${key}`);
		seen.add(key);
		assert.ok(
			truth.has(key),
			`line ${finding.line} does not exhibit \`${finding.kind}\` — a wrong finding is worse than a missing one: ${where}`,
		);
	}
});

test("declaring the analysis complete requires covering every defect", () => {
	if (deliverable.complete !== true) return;
	const found = new Set(deliverable.findings.map((finding) => `${finding.line}:${finding.kind}`));
	const missing = [...truth.entries()].filter(([key]) => !found.has(key)).map(([key, why]) => `${key} (${why})`);
	assert.deepEqual(missing, [], `\`complete\` is true but these defects are unreported:\n  ${missing.join("\n  ")}`);
});
