import { withDefaults } from "./options.mjs";

/**
 * A flat export of `rows`, one line per row.
 *
 * It honours the same shipped defaults as the report and takes the same overrides, but it is a different feature:
 * what a caller asked a report for must have no effect here.
 */
export function buildExport(rows, overrides = {}) {
	const options = withDefaults(overrides);
	const visible = options.includeArchived ? rows : rows.filter((row) => !row.archived);
	return {
		pageSize: options.pageSize,
		includeArchived: options.includeArchived,
		lines: visible.slice(0, options.pageSize).map((row) => `${row.id},${row.name}`),
	};
}
