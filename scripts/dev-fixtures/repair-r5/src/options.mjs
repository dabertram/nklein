/**
 * The shipped option defaults every view starts from.
 *
 * These are shipped VALUES. A caller's overrides apply to that call and to nothing else: one call must never be
 * able to change what the next call starts from, in this feature or in any other feature that shares them.
 */
const DEFAULTS = {
	includeArchived: false,
	pageSize: 20,
	columns: ["id", "name"],
};

/** The options for one call: the shipped defaults with `overrides` applied on top. */
export function withDefaults(overrides = {}) {
	return Object.assign(DEFAULTS, overrides);
}
