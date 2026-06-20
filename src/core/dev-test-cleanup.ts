/**
 * Dev-test cleanup reporting (follow-up-6 §4.3).
 *
 * After autonomous dev-test runs, disk fills with throwaway artifacts of several different kinds — obsolete
 * dev-test project workspaces, Docker sandbox volumes/containers, and editor/cache artifacts that !Klein does
 * not own. The cleanup report must distinguish these, must never propose deleting the *active* run, and must
 * report both reclaimable bytes and the bytes intentionally retained for the active project. This module is the
 * pure summarizer; discovery (marker scan, `du`, `docker volume ls`) is the side-effecting wrapper that feeds
 * it `DevTestCleanupEntry[]`.
 */

export type DevTestCleanupKind =
	/** A scaffolded dev-test project workspace (identified by its `dev-test-project.json` marker). */
	| "dev_test_workspace"
	/** A Docker sandbox named volume / container created for agent isolation. */
	| "sandbox_volume"
	/** Editor/cache artifacts outside !Klein ownership (VS Code chat/session caches, installers). */
	| "editor_cache";

export interface DevTestCleanupEntry {
	path: string;
	kind: DevTestCleanupKind;
	sizeBytes: number;
	/** True when this entry belongs to the currently-active run and must be retained. */
	isActive: boolean;
}

export interface DevTestCleanupCategorySummary {
	kind: DevTestCleanupKind;
	reclaimableBytes: number;
	reclaimableCount: number;
	retainedBytes: number;
	retainedCount: number;
}

export interface DevTestCleanupReport {
	totalReclaimableBytes: number;
	totalRetainedBytes: number;
	reclaimable: DevTestCleanupEntry[];
	retained: DevTestCleanupEntry[];
	categories: DevTestCleanupCategorySummary[];
	summary: string;
}

const ALL_KINDS: DevTestCleanupKind[] = ["dev_test_workspace", "sandbox_volume", "editor_cache"];

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(value >= 10 || Number.isInteger(value) ? 0 : 1)} ${units[unitIndex]}`;
}

export function summarizeDevTestCleanup(entries: readonly DevTestCleanupEntry[]): DevTestCleanupReport {
	// The active run is always retained, regardless of kind.
	const reclaimable = entries.filter((entry) => !entry.isActive);
	const retained = entries.filter((entry) => entry.isActive);

	const categories: DevTestCleanupCategorySummary[] = ALL_KINDS.map((kind) => {
		const reclaimableForKind = reclaimable.filter((entry) => entry.kind === kind);
		const retainedForKind = retained.filter((entry) => entry.kind === kind);
		return {
			kind,
			reclaimableBytes: reclaimableForKind.reduce((total, entry) => total + entry.sizeBytes, 0),
			reclaimableCount: reclaimableForKind.length,
			retainedBytes: retainedForKind.reduce((total, entry) => total + entry.sizeBytes, 0),
			retainedCount: retainedForKind.length,
		};
	}).filter((category) => category.reclaimableCount > 0 || category.retainedCount > 0);

	const totalReclaimableBytes = reclaimable.reduce((total, entry) => total + entry.sizeBytes, 0);
	const totalRetainedBytes = retained.reduce((total, entry) => total + entry.sizeBytes, 0);

	const categoryText = categories
		.map(
			(category) =>
				`${category.kind}: ${formatBytes(category.reclaimableBytes)} reclaimable (${category.reclaimableCount}), ${formatBytes(
					category.retainedBytes,
				)} retained (${category.retainedCount})`,
		)
		.join("; ");

	return {
		totalReclaimableBytes,
		totalRetainedBytes,
		reclaimable,
		retained,
		categories,
		summary: `Reclaimable ${formatBytes(totalReclaimableBytes)} across ${reclaimable.length} item(s); retained ${formatBytes(
			totalRetainedBytes,
		)} for the active project across ${retained.length} item(s).${categoryText ? ` ${categoryText}.` : ""}`,
	};
}
