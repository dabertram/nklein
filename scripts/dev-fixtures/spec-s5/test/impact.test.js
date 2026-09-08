import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC_V1 = "input/spec-v1.md";
const CHANGE_REQUEST = "input/change-request.md";
const CLASSIFICATIONS = ["added", "changed", "removed", "unaffected"];
const ACTION_TO_CLASSIFICATION = { add: "added", change: "changed", remove: "removed" };

/** v1 requirements and their contract markers. */
function deriveBaseline(source) {
	const baseline = new Map(); // "REQ-NN" -> "external" | "internal"
	for (const block of source.split(/\n\s*\n/)) {
		const trimmed = block.trim();
		const heading = /^\*\*(REQ-\d{2})\*\*/.exec(trimmed);
		if (!heading) continue;
		const contract = /`Contract:\s*(external|internal)`/.exec(trimmed);
		if (!contract) continue;
		baseline.set(heading[1], contract[1]);
	}
	return baseline;
}

/** What each change-request section does, read from its `Affects:` and `Action:` lines and nothing else. */
function deriveChanges(source) {
	const changes = new Map(); // "REQ-NN" -> "added" | "changed" | "removed"
	for (const section of source.split(/\n###\s+/)) {
		const affects = /^Affects:\s*(.+)$/m.exec(section);
		const action = /^Action:\s*(add|change|remove)\s*$/m.exec(section);
		if (!affects || !action) continue;
		for (const id of affects[1].split(",").map((part) => part.trim())) {
			if (/^REQ-\d{2}$/.test(id)) changes.set(id, ACTION_TO_CLASSIFICATION[action[1]]);
		}
	}
	return changes;
}

const baseline = deriveBaseline(readFileSync(join(root, SPEC_V1), "utf8"));
const changes = deriveChanges(readFileSync(join(root, CHANGE_REQUEST), "utf8"));

/**
 * The impact set is DERIVED from the two documents on every run — this file is a verifier, not an answer key. It
 * names no requirement and no classification. Re-implementing these rules is not a shortcut past the work; it IS
 * the work, because the rules say nothing about which requirements the change request touches.
 */
const truth = new Map(); // "REQ-NN" -> { classification, breaking }
for (const id of baseline.keys()) {
	const classification = changes.get(id) ?? "unaffected";
	const breaking = classification === "removed" || (classification === "changed" && baseline.get(id) === "external");
	truth.set(id, { classification, breaking });
}
for (const [id, classification] of changes) {
	if (baseline.has(id)) continue;
	truth.set(id, { classification, breaking: classification === "removed" });
}

const deliverable = JSON.parse(readFileSync(join(root, "spec/impact.json"), "utf8"));

test("the deliverable keeps its shape and both documents still parse", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.impacts), "`impacts` must be an array");
	assert.ok(baseline.size > 0, "the v1 requirements must parse — they are the evidence, do not edit them");
	assert.ok(changes.size > 0, "the change request must parse — it is the evidence, do not edit it");
});

test("every recorded impact classifies a real requirement, correctly, and rates it by the rule", () => {
	const seen = new Set();
	for (const impact of deliverable.impacts) {
		const where = JSON.stringify(impact);
		assert.ok(
			truth.has(impact.requirement),
			`\`${impact.requirement}\` is neither a v1 requirement nor one the change request adds: ${where}`,
		);
		assert.ok(!seen.has(impact.requirement), `\`${impact.requirement}\` is recorded twice`);
		seen.add(impact.requirement);

		assert.ok(
			CLASSIFICATIONS.includes(impact.classification),
			`classification must be one of ${CLASSIFICATIONS.join(", ")}: ${where}`,
		);
		assert.equal(typeof impact.breaking, "boolean", `\`breaking\` must be a boolean: ${where}`);

		const expected = truth.get(impact.requirement);
		assert.equal(
			impact.classification,
			expected.classification,
			`the change request does not do that to ${impact.requirement} — read its \`Affects:\` lines, not its prose: ${where}`,
		);
		assert.equal(
			impact.breaking,
			expected.breaking,
			`\`breaking: ${impact.breaking}\` is not what the rule yields for ${impact.requirement} — check its classification against its contract marker: ${where}`,
		);

		if (impact.classification !== "unaffected") {
			assert.equal(typeof impact.why, "string", `an affected requirement needs a \`why\`: ${where}`);
			assert.ok(impact.why.trim().length >= 12, `\`why\` must say what the change does to it: ${where}`);
		}
	}
});

test("declaring the delta complete requires every requirement classified", () => {
	if (deliverable.complete !== true) return;
	const covered = new Set(deliverable.impacts.map((impact) => impact.requirement));
	const missing = [...truth.keys()].filter((id) => !covered.has(id)).sort();
	assert.deepEqual(missing, [], `\`complete\` is true but these are unclassified:\n  ${missing.join("\n  ")}`);
});
