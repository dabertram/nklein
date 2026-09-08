import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BRIEF = "input/brief.md";
const PRIMITIVES = new Set(["string", "integer", "decimal", "boolean", "timestamp", "id"]);
const ENTITY_NAME = /^[A-Z][A-Za-z0-9]*$/;
const MEMBER_NAME = /^[a-z][A-Za-z0-9]*$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * The nouns the API must model and the capabilities it must serve are DERIVED from the brief on every run — this
 * file is a verifier, not an answer key. It names no entity, no operation and no error. Everything else it checks
 * is the specification's consistency with ITSELF, which is the property a specification is for.
 */
function deriveBrief(source) {
	const nouns = new Set();
	const capabilities = new Set();
	for (const match of source.matchAll(/^-\s+\*\*([^*]+)\*\*\s+—/gm)) {
		const name = match[1].trim();
		if (/^CAP-\d+$/.test(name)) {
			capabilities.add(name);
		} else {
			nouns.add(name);
		}
	}
	return { nouns, capabilities };
}

const { nouns, capabilities } = deriveBrief(readFileSync(join(root, BRIEF), "utf8"));
const deliverable = JSON.parse(readFileSync(join(root, "spec/api.json"), "utf8"));
const entities = Array.isArray(deliverable.entities) ? deliverable.entities : [];
const operations = Array.isArray(deliverable.operations) ? deliverable.operations : [];
const definedEntities = new Set(entities.map((entity) => entity?.name).filter((name) => typeof name === "string"));

function resolves(type) {
	if (typeof type !== "string" || type.length === 0) return false;
	const base = type.endsWith("[]") ? type.slice(0, -2) : type;
	return PRIMITIVES.has(base) || definedEntities.has(base);
}

function checkMembers(members, label, where) {
	assert.ok(Array.isArray(members), `${label} must be an array: ${where}`);
	const seen = new Set();
	for (const member of members) {
		const at = `${label} entry ${JSON.stringify(member)}`;
		assert.ok(typeof member?.name === "string" && MEMBER_NAME.test(member.name), `${at}: bad name — ${where}`);
		assert.ok(!seen.has(member.name), `${at}: \`${member.name}\` appears twice — ${where}`);
		seen.add(member.name);
		assert.ok(
			resolves(member.type),
			`${at}: the type \`${member.type}\` is neither a primitive (${[...PRIMITIVES].join(", ")}) nor an entity this specification defines — ${where}`,
		);
	}
	return seen;
}

test("the deliverable keeps its shape and the brief still parses", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.entities), "`entities` must be an array");
	assert.ok(Array.isArray(deliverable.operations), "`operations` must be an array");
	assert.ok(nouns.size > 0, "the domain nouns must parse — they are the evidence, do not edit the brief");
	assert.ok(capabilities.size > 0, "the capabilities must parse — they are the evidence, do not edit the brief");
});

test("every entity is well-formed, identified, and refers only to types this specification defines", () => {
	const seen = new Set();
	for (const entity of entities) {
		const where = `entity \`${entity?.name}\``;
		assert.ok(
			typeof entity?.name === "string" && ENTITY_NAME.test(entity.name),
			`an entity needs a PascalCase \`name\`: ${JSON.stringify(entity)}`,
		);
		assert.ok(!seen.has(entity.name), `${where} is defined twice`);
		seen.add(entity.name);

		const fieldNames = checkMembers(entity.fields, "`fields`", where);
		assert.ok(fieldNames.size > 0, `${where} has no fields — an entity with no fields models nothing`);
		assert.equal(typeof entity.identity, "string", `${where} needs an \`identity\` field name`);
		assert.ok(
			fieldNames.has(entity.identity),
			`${where} names \`${entity.identity}\` as its identity, but has no such field — an entity you cannot address is not an entity`,
		);
	}
});

test("every operation cites a capability, resolves its types, and admits at least one way to fail", () => {
	const seen = new Set();
	for (const operation of operations) {
		const where = `operation \`${operation?.name}\``;
		assert.ok(
			typeof operation?.name === "string" && MEMBER_NAME.test(operation.name),
			`an operation needs a camelCase \`name\`: ${JSON.stringify(operation)}`,
		);
		assert.ok(!seen.has(operation.name), `${where} is defined twice`);
		seen.add(operation.name);

		assert.ok(
			capabilities.has(operation.capability),
			`${where} cites \`${operation.capability}\`, which is not a capability the brief requires`,
		);
		checkMembers(operation.input ?? [], "`input`", where);
		assert.ok(
			operation.output === "void" || resolves(operation.output),
			`${where} returns \`${operation.output}\`, which is neither \`void\`, a primitive, nor an entity this specification defines`,
		);

		assert.ok(Array.isArray(operation.errors), `${where} needs an \`errors\` array`);
		assert.ok(
			operation.errors.length >= 1,
			`${where} declares no error case — every operation in this domain has at least one way to fail`,
		);
		const codes = new Set();
		for (const failure of operation.errors) {
			const at = `${where} error ${JSON.stringify(failure)}`;
			assert.ok(
				typeof failure?.code === "string" && ERROR_CODE.test(failure.code),
				`${at}: \`code\` must be SCREAMING_SNAKE_CASE`,
			);
			assert.ok(!codes.has(failure.code), `${at}: \`${failure.code}\` is declared twice on this operation`);
			codes.add(failure.code);
			assert.equal(typeof failure.when, "string", `${at}: needs a \`when\``);
			assert.ok(
				failure.when.trim().length >= 12,
				`${at}: \`when\` must say the condition that produces the error, not repeat the code`,
			);
		}
	}
});

test("declaring the specification complete requires every noun modelled and every capability served", () => {
	if (deliverable.complete !== true) return;
	const missingEntities = [...nouns].filter((noun) => !definedEntities.has(noun)).sort();
	assert.deepEqual(
		missingEntities,
		[],
		`\`complete\` is true but these domain nouns have no entity:\n  ${missingEntities.join("\n  ")}`,
	);
	const served = new Set(operations.map((operation) => operation.capability));
	const missingCapabilities = [...capabilities].filter((capability) => !served.has(capability)).sort();
	assert.deepEqual(
		missingCapabilities,
		[],
		`\`complete\` is true but no operation serves these capabilities:\n  ${missingCapabilities.join("\n  ")}`,
	);
});
