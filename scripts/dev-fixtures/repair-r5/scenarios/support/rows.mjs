/**
 * Fixed row data for the frozen scenarios. FROZEN — do not edit.
 *
 * Every scenario compares a later observation against a baseline it takes itself, never against a value written
 * down here, so a scenario means the same thing whatever ran before it.
 */

export function makeRows() {
	const rows = [];
	for (let index = 0; index < 30; index += 1) {
		rows.push({ id: `R${String(index).padStart(2, "0")}`, name: `row ${index}`, archived: index % 4 === 3 });
	}
	return rows;
}

export const liveRows = (rows) => rows.filter((row) => !row.archived);

export const snapshot = (value) => JSON.parse(JSON.stringify(value));
