/**
 * The ONE slug transform (previously copy-pasted ~6× as `slugify` / `slugifyTaskId` / `slugifyPlanTaskId` /
 * `slugifyScenario`). Lowercases, collapses every run of non-alphanumerics to a single `-`, and strips leading/trailing
 * `-`. Returns the RAW slug, which MAY be empty — each caller applies its own empty-handling (a domain fallback like
 * `"task"`, a `.slice(n)` cap, or a throw), so that policy stays at the call site. Pure.
 */
export function toSlug(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
