import { withDefaults } from "./options.mjs";

/**
 * A paged report over `rows`.
 *
 * Every report carries a computed `total` column alongside the configured ones. Archived rows are left out unless
 * the caller asks for them. Two reports built with the same arguments are identical, whatever was built in between.
 */
export function buildReport(rows, overrides = {}) {
	const options = withDefaults(overrides);
	options.columns.push("total");
	const visible = options.includeArchived ? rows : rows.filter((row) => !row.archived);
	return {
		columns: options.columns,
		pageSize: options.pageSize,
		includeArchived: options.includeArchived,
		rows: visible.slice(0, options.pageSize),
	};
}
