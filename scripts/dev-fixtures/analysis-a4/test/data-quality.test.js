import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DATASET = "input/shipments.csv";
const REFERENCE = "input/carriers.csv";
const WEIGHT_MIN_EXCLUSIVE = 0;
const WEIGHT_MAX_INCLUSIVE = 30_000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Plain CSV: no quoted fields, no embedded commas. Row 1 is the first row after the header. */
function readCsv(relativePath) {
	const lines = readFileSync(join(root, relativePath), "utf8")
		.split("\n")
		.filter((line) => line.length > 0);
	const header = lines[0].split(",");
	return lines.slice(1).map((line, index) => {
		const cells = line.split(",");
		const record = { row: index + 1, cells: {} };
		header.forEach((column, position) => {
			record.cells[column] = cells[position] ?? "";
		});
		return record;
	});
}

const dataset = readCsv(DATASET);
const carriers = readCsv(REFERENCE);
const knownCarrierIds = new Set(carriers.map((record) => record.cells.carrier_id));
const shipmentIdCounts = new Map();
for (const record of dataset) {
	const id = record.cells.shipment_id;
	shipmentIdCounts.set(id, (shipmentIdCounts.get(id) ?? 0) + 1);
}

/**
 * One predicate per rule, applied to a row. The truth — which rows offend and how many — is DERIVED from the
 * data on every run: this file is a checker, not an answer key. It writes down no row number and no count.
 */
const RULES = {
	duplicate_primary_key: {
		column: "shipment_id",
		offends: (record) => shipmentIdCounts.get(record.cells.shipment_id) > 1,
	},
	out_of_range: {
		column: "weight_kg",
		offends: (record) => {
			const value = Number(record.cells.weight_kg);
			if (!Number.isFinite(value)) return false;
			return !(value > WEIGHT_MIN_EXCLUSIVE && value <= WEIGHT_MAX_INCLUSIVE);
		},
	},
	wrong_type: {
		column: "delivered_at",
		offends: (record) => record.cells.delivered_at !== "" && !ISO_INSTANT.test(record.cells.delivered_at),
	},
	referential_break: {
		column: "carrier_id",
		offends: (record) => !knownCarrierIds.has(record.cells.carrier_id),
	},
};

const offendingRows = new Map(
	Object.entries(RULES).map(([name, rule]) => [
		name,
		new Set(dataset.filter((record) => rule.offends(record)).map((record) => record.row)),
	]),
);

const deliverable = JSON.parse(readFileSync(join(root, "analysis/data-quality.json"), "utf8"));

test("the deliverable keeps its shape", () => {
	assert.equal(deliverable.schemaVersion, 1, "schemaVersion must stay 1");
	assert.equal(typeof deliverable.complete, "boolean", "`complete` must be a boolean");
	assert.ok(Array.isArray(deliverable.violations), "`violations` must be an array");
});

test("every recorded violation names the right column, counts correctly and cites rows that offend", () => {
	const seen = new Set();
	for (const violation of deliverable.violations) {
		const where = JSON.stringify(violation);
		const names = Object.keys(RULES);
		assert.ok(names.includes(violation.rule), `rule must be one of ${names.join(", ")}: ${where}`);
		assert.ok(!seen.has(violation.rule), `rule \`${violation.rule}\` is recorded twice`);
		seen.add(violation.rule);

		assert.equal(
			violation.column,
			RULES[violation.rule].column,
			`\`${violation.rule}\` is a rule about a different column: ${where}`,
		);
		assert.equal(typeof violation.why, "string", `each violation needs a \`why\`: ${where}`);
		assert.ok(violation.why.trim().length >= 12, `\`why\` must actually explain the violation: ${where}`);

		const offenders = offendingRows.get(violation.rule);
		assert.ok(Number.isInteger(violation.count), `\`count\` must be an integer: ${where}`);
		assert.ok(violation.count >= 1, `only record a rule that the dataset actually violates: ${where}`);
		assert.ok(
			Array.isArray(violation.exampleRows),
			`\`exampleRows\` must be an array of 1-based data row numbers: ${where}`,
		);
		const wanted = Math.min(2, violation.count);
		assert.ok(
			violation.exampleRows.length >= wanted,
			`cite at least ${wanted} offending rows in \`exampleRows\`: ${where}`,
		);
		assert.equal(
			new Set(violation.exampleRows).size,
			violation.exampleRows.length,
			`\`exampleRows\` repeats a row: ${where}`,
		);
		assert.ok(
			violation.exampleRows.length <= violation.count,
			`\`exampleRows\` cites more rows than \`count\` admits: ${where}`,
		);
		for (const row of violation.exampleRows) {
			assert.ok(Number.isInteger(row), `row numbers must be integers: ${where}`);
			assert.ok(row >= 1 && row <= dataset.length, `row ${row} is outside the dataset: ${where}`);
			assert.ok(
				offenders.has(row),
				`row ${row} does not violate \`${violation.rule}\` — a wrong citation is worse than a missing one: ${where}`,
			);
		}

		assert.equal(
			violation.count,
			offenders.size,
			`the \`count\` recorded for \`${violation.rule}\` is not the number of rows that violate it — recount it from the data: ${where}`,
		);
	}
});

test("declaring the audit complete requires every violated rule", () => {
	if (deliverable.complete !== true) return;
	const found = new Set(deliverable.violations.map((violation) => violation.rule));
	const missing = [...offendingRows.entries()]
		.filter(([name, rows]) => rows.size > 0 && !found.has(name))
		.map(([name]) => `${name} (on column \`${RULES[name].column}\`)`);
	assert.deepEqual(missing, [], `\`complete\` is true but these rules are unreported:\n  ${missing.join("\n  ")}`);
});
