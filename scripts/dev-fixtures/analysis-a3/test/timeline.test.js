import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LOG = "input/incident.jsonl";
const ROLES = ["trigger", "amplification", "failure"];
const CATEGORIES = [
	"capacity_misconfiguration",
	"retry_amplification",
	"dependency_outage",
	"code_defect",
	"credential_expiry",
];

/** The configuration key that was lowered decides the category. Same table as the brief; no line numbers here. */
function categoriseKey(key) {
	if (/pool|capacity|concurrency|max/.test(key)) return "capacity_misconfiguration";
	if (/retry|backoff|attempt/.test(key)) return "retry_amplification";
	if (/credential|token|secret/.test(key)) return "credential_expiry";
	if (/upstream|dependency|endpoint/.test(key)) return "dependency_outage";
	return "code_defect";
}

/**
 * The truth is DERIVED from the log on every run — this file is a verifier, not an answer key. It contains no
 * line numbers and no root cause. Re-implementing these rules is not a shortcut past the work; it IS the work.
 */
function deriveTruth(records) {
	const roleByLine = new Map();
	const triggers = [];

	for (const { line, record } of records) {
		if (
			record.event === "config_applied" &&
			typeof record.from === "number" &&
			typeof record.to === "number" &&
			record.to < record.from
		) {
			roleByLine.set(line, "trigger");
			triggers.push({ line, key: String(record.key ?? "") });
			continue;
		}
		if (record.event === "retry_scheduled" && record.backoff_ms === 0) {
			roleByLine.set(line, "amplification");
			continue;
		}
		if (record.level === "fatal") {
			roleByLine.set(line, "failure");
		}
	}

	triggers.sort((left, right) => left.line - right.line);
	const earliest = triggers[0];
	const rootCause = earliest ? { line: earliest.line, category: categoriseKey(earliest.key) } : null;
	return { roleByLine, rootCause };
}

const rawLines = readFileSync(join(root, LOG), "utf8").split("\n");
const records = [];
rawLines.forEach((text, index) => {
	if (text.trim().length === 0) return;
	records.push({ line: index + 1, record: JSON.parse(text) });
});
const logLineCount = rawLines.length;
const { roleByLine, rootCause } = deriveTruth(records);
const deliverable = JSON.parse(readFileSync(join(root, "analysis/timeline.json"), "utf8"));

test("the deliverable keeps its shape", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.events), "`events` must be an array");
	assert.ok(
		deliverable.rootCause === null || typeof deliverable.rootCause === "object",
		"`rootCause` must be null or an object",
	);
});

test("every recorded event is real, located and correctly classified", () => {
	const seen = new Set();
	let previousLine = 0;
	for (const event of deliverable.events) {
		const where = JSON.stringify(event);
		assert.ok(Number.isInteger(event.line), `line must be an integer: ${where}`);
		assert.ok(event.line >= 1 && event.line <= logLineCount, `line is outside the log: ${where}`);
		assert.ok(ROLES.includes(event.role), `role must be one of ${ROLES.join(", ")}: ${where}`);
		assert.equal(typeof event.why, "string", `each event needs a \`why\`: ${where}`);
		assert.ok(event.why.trim().length >= 12, `\`why\` must actually explain the event: ${where}`);

		assert.ok(!seen.has(event.line), `line ${event.line} is recorded twice`);
		seen.add(event.line);
		assert.ok(
			event.line > previousLine,
			`\`events\` must be ordered by line, ascending — line ${event.line} follows line ${previousLine}`,
		);
		previousLine = event.line;

		assert.ok(
			roleByLine.has(event.line),
			`line ${event.line} plays none of the three roles — a wrong event is worse than a missing one: ${where}`,
		);
		assert.equal(
			roleByLine.get(event.line),
			event.role,
			`line ${event.line} does not play the role \`${event.role}\`: ${where}`,
		);
	}
});

test("a recorded root cause is the one the rubric selects", () => {
	if (deliverable.rootCause === null || deliverable.rootCause === undefined) return;
	const claim = deliverable.rootCause;
	const where = JSON.stringify(claim);
	assert.ok(CATEGORIES.includes(claim.category), `category must be one of ${CATEGORIES.join(", ")}: ${where}`);
	assert.ok(Number.isInteger(claim.line), `the root cause needs the line it happened on: ${where}`);
	assert.equal(typeof claim.why, "string", `the root cause needs a \`why\`: ${where}`);
	assert.ok(claim.why.trim().length >= 12, `\`why\` must actually explain the root cause: ${where}`);

	assert.ok(rootCause !== null, `the log contains no trigger, so it has no root cause: ${where}`);
	assert.equal(
		claim.line,
		rootCause.line,
		`line ${claim.line} is not the event the rubric selects as the root cause: ${where}`,
	);
	assert.equal(
		claim.category,
		rootCause.category,
		`the category does not follow the rubric for the event on line ${rootCause.line}: ${where}`,
	);
});

test("declaring the reconstruction complete requires the whole chain and a root cause", () => {
	if (deliverable.complete !== true) return;
	const found = new Set(deliverable.events.map((event) => event.line));
	const missing = [...roleByLine.entries()]
		.filter(([line]) => !found.has(line))
		.map(([line, role]) => `line ${line} (${role})`);
	assert.deepEqual(missing, [], `\`complete\` is true but these events are unreported:\n  ${missing.join("\n  ")}`);
	assert.ok(
		deliverable.rootCause !== null && deliverable.rootCause !== undefined,
		"`complete` is true but `rootCause` is still null — the chain is not explained until it is named",
	);
});
