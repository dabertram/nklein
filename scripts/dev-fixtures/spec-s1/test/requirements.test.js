import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIEF = "input/brief.md";
const FIELDS = ["actor", "trigger", "outcome", "acceptance"];
const MIN_LENGTH = { actor: 3, trigger: 12, outcome: 12, acceptance: 20 };

function normalise(text) {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The obligations and the actor glossary are DERIVED from the brief on every run — this file is a verifier, not
 * an answer key. It lists no obligation id, no actor and no requirement text. Re-implementing these rules is not
 * a shortcut past the work; it IS the work.
 */
function deriveBrief(source) {
	const blocks = source.split(/\n\s*\n/);

	const actors = new Set();
	for (const block of blocks) {
		for (const match of block.matchAll(/^-\s+\*\*([^*]+)\*\*\s+—/gm)) {
			actors.add(match[1].trim());
		}
	}

	const obligations = new Map(); // id -> { text, withdrawn }
	for (const block of blocks) {
		const heading = /^\*\*(OB-\d{2})\*\*\s+([\s\S]+)$/.exec(block.trim());
		if (!heading) continue;
		obligations.set(heading[1], { text: normalise(heading[2]), withdrawn: /\bWITHDRAWN\b/.test(block) });
	}

	return { actors, obligations };
}

const { actors, obligations } = deriveBrief(readFileSync(join(root, BRIEF), "utf8"));
const required = [...obligations.entries()]
	.filter(([, obligation]) => !obligation.withdrawn)
	.map(([id]) => id)
	.sort();
const deliverable = JSON.parse(readFileSync(join(root, "spec/requirements.json"), "utf8"));

test("the deliverable keeps its shape and the brief still parses", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.requirements), "`requirements` must be an array");
	assert.ok(actors.size > 0, "the actor glossary must parse — it is the evidence, do not edit it");
	assert.ok(obligations.size > 0, "the obligations must parse — they are the evidence, do not edit them");
});

test("every recorded requirement is anchored to a live obligation and says something", () => {
	const seen = new Set();
	for (const requirement of deliverable.requirements) {
		const where = JSON.stringify(requirement);
		assert.equal(typeof requirement.id, "string", `each requirement needs the obligation's \`id\`: ${where}`);
		const obligation = obligations.get(requirement.id);
		assert.ok(obligation !== undefined, `\`${requirement.id}\` is not an obligation in the brief: ${where}`);
		assert.ok(
			!obligation.withdrawn,
			`\`${requirement.id}\` is withdrawn — the brief keeps it for numbering, not for building: ${where}`,
		);
		assert.ok(!seen.has(requirement.id), `\`${requirement.id}\` is covered twice — cover each obligation once`);
		seen.add(requirement.id);

		for (const field of FIELDS) {
			assert.equal(typeof requirement[field], "string", `\`${field}\` must be a string: ${where}`);
			assert.ok(
				requirement[field].trim().length >= MIN_LENGTH[field],
				`\`${field}\` must carry at least ${MIN_LENGTH[field]} characters of real content: ${where}`,
			);
		}

		assert.ok(
			actors.has(requirement.actor.trim()),
			`\`${requirement.actor}\` is not one of the brief's actors — the glossary is closed: ${where}`,
		);

		const values = FIELDS.map((field) => normalise(requirement[field]));
		assert.equal(new Set(values).size, values.length, `two fields of ${requirement.id} hold the same text: ${where}`);

		assert.ok(
			!obligation.text.includes(normalise(requirement.acceptance)),
			`the acceptance criterion for ${requirement.id} is copied verbatim out of the obligation — a criterion states how it is checked, not what it says: ${where}`,
		);
	}
});

test("declaring the extraction complete requires every live obligation, exactly once", () => {
	if (deliverable.complete !== true) return;
	const covered = new Set(deliverable.requirements.map((requirement) => requirement.id));
	const missing = required.filter((id) => !covered.has(id));
	assert.deepEqual(
		missing,
		[],
		`\`complete\` is true but these obligations have no requirement:\n  ${missing.join("\n  ")}`,
	);
});
